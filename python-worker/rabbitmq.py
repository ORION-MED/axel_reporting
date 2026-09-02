import logging
import time
from collections.abc import Callable
import pika
from config import RABBITMQ_URL, RABBITMQ_QUEUE

log = logging.getLogger(__name__)

_RETRY_DELAY = 5


def _sleep_until_retry(should_stop: Callable[[], bool] | None) -> bool:
    deadline = time.monotonic() + _RETRY_DELAY
    while time.monotonic() < deadline:
        if should_stop and should_stop():
            return False
        time.sleep(0.2)
    return True


def connect_with_retry(
    should_stop: Callable[[], bool] | None = None,
) -> tuple[pika.BlockingConnection, pika.adapters.blocking_connection.BlockingChannel] | None:
    """Connect to RabbitMQ, retrying until connected or shutdown is requested."""
    while not (should_stop and should_stop()):
        try:
            params = pika.URLParameters(RABBITMQ_URL)
            params.heartbeat = 60
            params.blocked_connection_timeout = 300
            conn = pika.BlockingConnection(params)
            channel = conn.channel()
            channel.queue_declare(queue=RABBITMQ_QUEUE, durable=True)
            log.info("Connected to RabbitMQ, queue=%s", RABBITMQ_QUEUE)
            return conn, channel
        except Exception as exc:
            log.warning("RabbitMQ connection failed: %s. Retrying in %ds...", exc, _RETRY_DELAY)
            if not _sleep_until_retry(should_stop):
                return None
    return None
