import json
import logging
import multiprocessing as mp
import signal
import time
import traceback
import pika
from config import WORKER_ID, RABBITMQ_URL, RABBITMQ_QUEUE, LOG_LEVEL
from db import close_pool, requeue_job_for_retry, start_job, update_job_status
from jobs.dispatcher import dispatch
from rabbitmq import connect_with_retry

JOB_TIMEOUT = int(__import__('os').environ.get("JOB_TIMEOUT_SECONDS", "3600"))
MAX_RETRIES = int(__import__('os').environ.get("JOB_MAX_RETRIES", "3"))

logging.basicConfig(
    level=getattr(logging, LOG_LEVEL, logging.INFO),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger(__name__)

_shutdown_requested = False


def _handle_sigterm(sig, frame):
    global _shutdown_requested
    _shutdown_requested = True
    log.info("SIGTERM received — will stop after current job")


signal.signal(signal.SIGTERM, _handle_sigterm)


def _run_job_in_child(job: dict, result_queue):
    try:
        dispatch(job)
        result_queue.put({"ok": True})
    except Exception as exc:
        result_queue.put({
            "ok": False,
            "error": str(exc),
            "traceback": traceback.format_exc(),
        })


def run_job_with_timeout(job: dict) -> None:
    ctx = mp.get_context("spawn")
    result_queue = ctx.Queue(maxsize=1)
    proc = ctx.Process(
        target=_run_job_in_child,
        args=(job, result_queue),
        name=f"job-{job['id']}",
    )
    proc.start()
    proc.join(JOB_TIMEOUT)

    if proc.is_alive():
        proc.terminate()
        proc.join(10)
        if proc.is_alive():
            proc.kill()
            proc.join(5)
        raise TimeoutError(f"Timeout after {JOB_TIMEOUT}s")

    try:
        result = result_queue.get_nowait()
    except Exception:
        if proc.exitcode == 0:
            return
        raise RuntimeError(f"Job process exited with code {proc.exitcode}")

    if not result.get("ok"):
        tb = result.get("traceback")
        if tb:
            log.error("Child job traceback:\n%s", tb)
        raise RuntimeError(result.get("error") or "Job failed")


def on_message(channel, method, properties, body):
    try:
        data = json.loads(body)
        job_id = data["job_id"]
    except Exception as exc:
        log.error("Invalid message body: %s", exc)
        channel.basic_nack(delivery_tag=method.delivery_tag, requeue=False)
        return

    retry_count = (properties.headers or {}).get("x-retry-count", 0)
    log.info("Received job %s (attempt %d/%d)", job_id, retry_count + 1, MAX_RETRIES + 1)

    try:
        job = start_job(job_id, WORKER_ID)
    except Exception as exc:
        log.exception("DB error claiming job %s, requeuing: %s", job_id, exc)
        channel.basic_nack(delivery_tag=method.delivery_tag, requeue=True)
        return

    if job is None:
        log.warning(
            "Job %s not queued (already claimed or missing) — skipping",
            job_id,
        )
        channel.basic_ack(delivery_tag=method.delivery_tag)
        return

    log.info(
        "Processing job %s (type=%s, upload=%s)",
        job["id"], job["job_type"], job["upload_id"],
    )
    try:
        run_job_with_timeout(job)
        log.info("Job %s completed successfully.", job["id"])
        channel.basic_ack(delivery_tag=method.delivery_tag)
    except TimeoutError:
        log.error("Job %s timed out after %ds", job["id"], JOB_TIMEOUT)
        try:
            update_job_status(job["id"], "failed", error=f"Timeout after {JOB_TIMEOUT}s")
        except Exception:
            log.exception("Failed to update status for timed-out job %s", job["id"])
        channel.basic_nack(delivery_tag=method.delivery_tag, requeue=False)
    except Exception as exc:
        log.exception("Job %s failed: %s", job["id"], exc)
        if retry_count < MAX_RETRIES:
            delay = 5 * (2 ** retry_count)  # 5s, 10s, 20s
            log.warning(
                "Retrying job %s in %ds (attempt %d/%d)",
                job["id"], delay, retry_count + 1, MAX_RETRIES,
            )
            try:
                time.sleep(delay)
                if not requeue_job_for_retry(job["id"], error=str(exc)):
                    log.warning("Job %s is no longer running — retry skipped", job["id"])
                    channel.basic_ack(delivery_tag=method.delivery_tag)
                    return
                channel.basic_publish(
                    exchange="",
                    routing_key=RABBITMQ_QUEUE,
                    body=body,
                    properties=pika.BasicProperties(
                        headers={"x-retry-count": retry_count + 1},
                        delivery_mode=2,
                    ),
                )
                channel.basic_ack(delivery_tag=method.delivery_tag)
            except Exception:
                log.exception("Failed to schedule retry for job %s", job["id"])
                channel.basic_nack(delivery_tag=method.delivery_tag, requeue=True)
        else:
            try:
                update_job_status(job["id"], "failed", error=str(exc))
            except Exception:
                log.exception("Failed to update status for job %s", job["id"])
            channel.basic_nack(delivery_tag=method.delivery_tag, requeue=False)


def run():
    log.info("Worker %s starting...", WORKER_ID)
    if "guest:guest" in RABBITMQ_URL:
        log.warning("RABBITMQ_URL contains default guest credentials — do NOT use in production")
    try:
        while not _shutdown_requested:
            connection = connect_with_retry(lambda: _shutdown_requested)
            if connection is None:
                break

            conn, channel = connection
            channel.basic_qos(prefetch_count=1)
            channel.basic_consume(
                queue=RABBITMQ_QUEUE, on_message_callback=on_message
            )
            log.info("Waiting for jobs. Press Ctrl+C to stop.")
            try:
                while not _shutdown_requested:
                    conn.process_data_events(time_limit=1)
            except (
                pika.exceptions.AMQPConnectionError,
                pika.exceptions.StreamLostError,
                pika.exceptions.ConnectionClosedByBroker,
                pika.exceptions.ConnectionWrongStateError,
            ) as exc:
                if not _shutdown_requested:
                    log.warning("RabbitMQ connection lost: %s — reconnecting...", exc)
                    time.sleep(5)
            except KeyboardInterrupt:
                log.info("Shutting down worker.")
                _handle_sigterm(None, None)
            except Exception as exc:
                if not _shutdown_requested:
                    log.exception("Unexpected error in consumer loop: %s", exc)
                    time.sleep(5)
            finally:
                try:
                    if channel.is_open:
                        channel.stop_consuming()
                except Exception:
                    pass
                try:
                    if conn.is_open:
                        conn.close()
                except Exception:
                    pass
    finally:
        close_pool()
        log.info("Worker stopped.")


if __name__ == "__main__":
    run()
