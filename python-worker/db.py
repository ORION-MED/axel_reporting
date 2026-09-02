import logging
import signal
import threading
import psycopg2
import psycopg2.extras
import psycopg2.pool
from contextlib import contextmanager
from config import DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD

log = logging.getLogger(__name__)

_pool: psycopg2.pool.ThreadedConnectionPool | None = None
_pool_lock = threading.Lock()


def close_pool() -> None:
    global _pool
    with _pool_lock:
        if _pool is not None:
            try:
                _pool.closeall()
            except Exception:
                pass
            _pool = None


def _shutdown_pool(signum, frame):  # noqa: ARG001
    close_pool()


signal.signal(signal.SIGTERM, _shutdown_pool)


def _get_pool() -> psycopg2.pool.ThreadedConnectionPool:
    global _pool
    if _pool is not None:
        return _pool
    with _pool_lock:
        if _pool is None:
            _pool = psycopg2.pool.ThreadedConnectionPool(
                minconn=1,
                maxconn=5,
                host=DB_HOST,
                port=DB_PORT,
                dbname=DB_NAME,
                user=DB_USER,
                password=DB_PASSWORD,
                cursor_factory=psycopg2.extras.RealDictCursor,
                keepalives=1,
                keepalives_idle=30,
                keepalives_interval=10,
                keepalives_count=5,
                options="-c statement_timeout=30000",  # 30 s per query
            )
    return _pool


@contextmanager
def _get_conn():
    pool = _get_pool()
    conn = pool.getconn()
    close_on_return = False
    try:
        yield conn
        conn.commit()
    except psycopg2.OperationalError:
        # Stale/dead connection — discard from pool so it won't be reused
        close_on_return = True
        try:
            conn.rollback()
        except Exception:
            pass
        raise
    except Exception:
        conn.rollback()
        raise
    finally:
        try:
            pool.putconn(conn, close=close_on_return)
        except Exception:
            log.warning("putconn failed, closing connection directly")
            try:
                conn.close()
            except Exception:
                pass


def start_job(job_id: str, worker_id: str) -> dict | None:
    with _get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE processing_jobs
                SET status = 'running',
                    worker_id = %s,
                    started_at = now()
                WHERE id = %s AND status = 'queued'
                RETURNING id, upload_id, user_id, job_type, pipeline_config
                """,
                (worker_id, job_id),
            )
            row = cur.fetchone()
            return dict(row) if row else None


def update_job_status(
    job_id: str,
    status: str,
    error: str | None = None,
    progress: int | None = None,
):
    with _get_conn() as conn:
        with conn.cursor() as cur:
            if status in ("completed", "failed"):
                cur.execute(
                    """
                    UPDATE processing_jobs
                    SET status = %s,
                        finished_at = now(),
                        error_message = %s,
                        progress_percent = COALESCE(%s, progress_percent)
                    WHERE id = %s AND status != 'cancelled'
                    """,
                    (status, error, progress, job_id),
                )
            else:
                cur.execute(
                    """
                    UPDATE processing_jobs
                    SET status = %s,
                        progress_percent = COALESCE(%s, progress_percent)
                    WHERE id = %s AND status != 'cancelled'
                    """,
                    (status, progress, job_id),
                )


def requeue_job_for_retry(job_id: str, error: str | None = None) -> bool:
    with _get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE processing_jobs
                SET status = 'queued',
                    worker_id = NULL,
                    started_at = NULL,
                    finished_at = NULL,
                    error_message = %s,
                    progress_percent = 0
                WHERE id = %s AND status = 'running'
                RETURNING id
                """,
                (error, job_id),
            )
            return cur.fetchone() is not None


def is_job_cancelled(job_id: str) -> bool:
    with _get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT status = 'cancelled' AS cancelled FROM processing_jobs WHERE id = %s",
                (job_id,),
            )
            row = cur.fetchone()
            return bool(row and row["cancelled"])


def get_upload(upload_id: str) -> dict | None:
    with _get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, user_id, original_filename, mime_type, s3_raw_key
                FROM uploads WHERE id = %s
                """,
                (upload_id,),
            )
            row = cur.fetchone()
            return dict(row) if row else None


def insert_artifact(
    job_id: str,
    artifact_type: str,
    fmt: str,
    s3_key: str,
    size_bytes: int | None,
):
    with _get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO artifacts
                    (id, job_id, artifact_type, format, s3_key, size_bytes)
                SELECT gen_random_uuid(), %s, %s, %s, %s, %s
                WHERE EXISTS (
                    SELECT 1 FROM processing_jobs
                    WHERE id = %s AND status != 'cancelled'
                )
                RETURNING id
                """,
                (job_id, artifact_type, fmt, s3_key, size_bytes, job_id),
            )
            row = cur.fetchone()
            return row["id"] if row else None


def upsert_dataset_profile(
    upload_id: str, status: str, s3_key: str | None = None
):
    with _get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO dataset_profiles
                    (id, upload_id, status, s3_key, updated_at)
                SELECT gen_random_uuid(), %s, %s, %s, now()
                WHERE EXISTS (
                    SELECT 1 FROM processing_jobs
                    WHERE upload_id = %s AND status != 'cancelled'
                )
                ON CONFLICT (upload_id) DO UPDATE
                    SET status = EXCLUDED.status,
                        s3_key = COALESCE(
                            EXCLUDED.s3_key, dataset_profiles.s3_key
                        ),
                        updated_at = now()
                """,
                (upload_id, status, s3_key, upload_id),
            )
