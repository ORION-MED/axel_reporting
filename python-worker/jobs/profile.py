import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from processing.ingest import load_dataframe
from processing.stats import (
    build_dataset_stats,
    build_slow_stats,
    build_pvalue_matrix,
)
from processing.export import export_dataframe
from s3_client import upload_json
from db import (
    get_upload,
    insert_artifact,
    is_job_cancelled,
    upsert_dataset_profile,
    update_job_status,
)

log = logging.getLogger(__name__)


def handle_profile_job(job: dict):
    job_id = job["id"]
    upload_id = job["upload_id"]
    user_id = job["user_id"]

    upload = get_upload(upload_id)
    if not upload:
        raise RuntimeError(f"Upload {upload_id} not found")
    if is_job_cancelled(job_id):
        log.info("Profile job %s was cancelled before start", job_id)
        return

    upsert_dataset_profile(upload_id, "profiling")
    update_job_status(job_id, "running", progress=5)
    if is_job_cancelled(job_id):
        log.info("Profile job %s cancelled after start", job_id)
        return

    # Phase 1 -- download + parse (5 -> 30 %)
    df = load_dataframe(
        upload["s3_raw_key"],
        upload["original_filename"],
        mime_type=upload.get("mime_type", ""),
    )
    if is_job_cancelled(job_id):
        log.info("Profile job %s cancelled after ingest", job_id)
        return
    update_job_status(job_id, "running", progress=30)

    # Phase 2 -- compute stats + derive overview in one pass (30 -> 75 %)
    # Correlation (Pearson/Spearman) is included.
    # cramersV and vif are deferred to background.
    stats, overview = build_dataset_stats(df)
    if is_job_cancelled(job_id):
        log.info("Profile job %s cancelled after stats", job_id)
        return
    update_job_status(job_id, "running", progress=75)

    # Phase 3 -- upload 3 artifacts in parallel (75 -> 100 %)
    overview_key = f"stats/{user_id}/{upload_id}/dataset_overview.json"
    stats_key = f"stats/{user_id}/{upload_id}/dataset_stats.json"
    pvalue_key = f"stats/{user_id}/{upload_id}/pvalue_matrix.json"
    base_key = f"staging/{user_id}/{upload_id}/source"

    upload_tasks = {
        "overview": (upload_json, (overview_key, overview)),
        "stats": (upload_json, (stats_key, stats)),
        "parquet": (export_dataframe, (df, base_key, "parquet")),
    }

    with ThreadPoolExecutor(max_workers=3) as executor:
        futures = {
            executor.submit(fn, *args): name
            for name, (fn, args) in upload_tasks.items()
        }
        results = {}
        for fut in as_completed(futures):
            results[futures[fut]] = fut.result()

    if is_job_cancelled(job_id):
        log.info("Profile job %s cancelled after artifact upload", job_id)
        return

    parquet_key, parquet_size = results["parquet"]

    insert_artifact(
        job_id, "dataset_overview", "json", overview_key, None,
    )
    insert_artifact(job_id, "dataset_stats", "json", stats_key, None)
    insert_artifact(
        job_id, "staging_parquet", "parquet", parquet_key, parquet_size,
    )

    upsert_dataset_profile(
        upload_id, "profile_ready", s3_key=stats_key,
    )
    update_job_status(job_id, "running", progress=85)

    # Phase 4 -- slow stats + pvalue (85 -> 100 %)
    # The worker itself executes every job in a short-lived child process. Running
    # this phase in a daemon thread used to terminate it as soon as the child
    # returned. Keep it in the job lifecycle so artifacts are durable before ACK.
    if is_job_cancelled(job_id):
        log.info("Profile job %s cancelled before slow stats", job_id)
        return
    pvalue_matrix = build_pvalue_matrix(df)
    update_job_status(job_id, "running", progress=90)
    if is_job_cancelled(job_id):
        log.info("Profile job %s cancelled after pvalue matrix", job_id)
        return
    slow = build_slow_stats(df)
    stats_full = {**stats, **slow}

    with ThreadPoolExecutor(max_workers=2) as executor:
        pvalue_future = executor.submit(upload_json, pvalue_key, pvalue_matrix)
        stats_future = executor.submit(upload_json, stats_key, stats_full)
        pvalue_future.result()
        stats_future.result()

    if is_job_cancelled(job_id):
        log.info("Profile job %s cancelled after slow-stat upload", job_id)
        return

    insert_artifact(
        job_id, "pvalue_matrix", "json", pvalue_key, None,
    )
    upsert_dataset_profile(upload_id, "full_stats_ready", s3_key=stats_key)
    update_job_status(job_id, "completed", progress=100)
    log.info("full profile stats done for job %s", job_id)
