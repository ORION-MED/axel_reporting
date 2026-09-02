import os
import time
import logging
import polars as pl
from concurrent.futures import ThreadPoolExecutor, as_completed
from s3_client import download_to_file
from processing.pipeline import run_pipeline
from processing.export import export_dataframe
from db import insert_artifact, is_job_cancelled, update_job_status

log = logging.getLogger(__name__)

# Directory for caching staging parquet files; avoids re-downloading on repeated jobs
_CACHE_DIR = os.environ.get("PARQUET_CACHE_DIR", os.path.join(os.sep + "tmp", "staging_parquet"))
_CACHE_MAX_AGE_HOURS = int(os.environ.get("PARQUET_CACHE_MAX_AGE_HOURS", "24"))
_ALLOWED_EXPORT_FORMATS = {"csv", "parquet", "xlsx"}


def _cleanup_old_cache() -> None:
    """Remove parquet cache files older than _CACHE_MAX_AGE_HOURS."""
    if not os.path.isdir(_CACHE_DIR):
        return
    cutoff = time.time() - _CACHE_MAX_AGE_HOURS * 3600
    for fname in os.listdir(_CACHE_DIR):
        fpath = os.path.join(_CACHE_DIR, fname)
        try:
            if os.path.isfile(fpath) and os.path.getmtime(fpath) < cutoff:
                os.remove(fpath)
                log.debug("Removed stale parquet cache: %s", fpath)
        except OSError as exc:
            log.warning("Failed to remove cache file %s: %s", fpath, exc)


def _ensure_parquet_cache(user_id: int, upload_id: str) -> str:
    """Download staging parquet to local disk if not already cached; return path."""
    os.makedirs(_CACHE_DIR, exist_ok=True)
    path = os.path.join(_CACHE_DIR, f"{user_id}_{upload_id}.parquet")
    if not os.path.exists(path):
        s3_key = f"staging/{user_id}/{upload_id}/source.parquet"
        log.debug("Cache miss — downloading %s", s3_key)
        tmp_path = f"{path}.tmp"
        download_to_file(s3_key, tmp_path)
        os.replace(tmp_path, path)
    else:
        log.debug("Cache hit — %s", path)
    return path


def _normalize_export_formats(raw_formats: object) -> list[str]:
    if raw_formats is None:
        return ["parquet"]
    if not isinstance(raw_formats, list) or len(raw_formats) == 0:
        raise ValueError("exportFormats must be a non-empty list")

    formats: list[str] = []
    for raw in raw_formats:
        if not isinstance(raw, str):
            raise ValueError("exportFormats must contain strings")
        fmt = raw.strip().lower()
        if fmt not in _ALLOWED_EXPORT_FORMATS:
            raise ValueError(f"Unsupported export format: {raw}")
        if fmt not in formats:
            formats.append(fmt)

    if not formats:
        raise ValueError("exportFormats must be a non-empty list")
    return formats


def handle_process_job(job: dict):
    _cleanup_old_cache()
    job_id    = job["id"]
    upload_id = job["upload_id"]
    user_id   = job["user_id"]
    pipeline_config: dict = job.get("pipeline_config") or {}

    steps:          list[dict] = pipeline_config.get("steps", [])
    export_formats = _normalize_export_formats(pipeline_config.get("exportFormats", ["parquet"]))

    if is_job_cancelled(job_id):
        log.info("Process job %s was cancelled before start", job_id)
        return
    update_job_status(job_id, "running", progress=10)
    if is_job_cancelled(job_id):
        log.info("Process job %s cancelled after start", job_id)
        return

    # Use disk-cached parquet + scan_parquet for lazy reading (avoids loading
    # unused columns and allows the pipeline to stay lazy until collect())
    cache_path = _ensure_parquet_cache(user_id, upload_id)
    if is_job_cancelled(job_id):
        log.info("Process job %s cancelled after staging download", job_id)
        return
    update_job_status(job_id, "running", progress=30)

    lf = pl.scan_parquet(cache_path)
    df = run_pipeline(lf, steps)
    if is_job_cancelled(job_id):
        log.info("Process job %s cancelled after pipeline", job_id)
        return
    update_job_status(job_id, "running", progress=70)

    base_key = f"processed/{user_id}/{upload_id}/{job_id}/result"

    # Export all requested formats in parallel
    with ThreadPoolExecutor(max_workers=len(export_formats)) as ex:
        futures = {
            ex.submit(export_dataframe, df, base_key, fmt): fmt
            for fmt in export_formats
        }
        for fut in as_completed(futures):
            fmt = futures[fut]
            s3_key, size = fut.result()
            if is_job_cancelled(job_id):
                log.info("Process job %s cancelled after export", job_id)
                return
            insert_artifact(job_id, "processed_dataset", fmt, s3_key, size)

    if is_job_cancelled(job_id):
        log.info("Process job %s cancelled before completion", job_id)
        return
    update_job_status(job_id, "completed", progress=100)
