import os
import socket
from dotenv import load_dotenv

load_dotenv()

DB_HOST = os.environ.get("AUTH_DB_HOST", "localhost")
DB_PORT = int(os.environ.get("AUTH_DB_PORT", "5432"))
DB_NAME = os.environ.get("AUTH_DB_NAME", "postgres")
DB_USER = os.environ.get("AUTH_DB_USER", "postgres")
DB_PASSWORD = os.environ.get("AUTH_DB_PASSWORD", "postgres")

S3_BUCKET = os.environ.get("S3_BUCKET", "")
S3_REGION = os.environ.get("S3_REGION", "us-east-1")
S3_ENDPOINT = os.environ.get("S3_ENDPOINT")
S3_ACCESS_KEY = os.environ.get("S3_ACCESS_KEY")
S3_SECRET_KEY = os.environ.get("S3_SECRET_KEY")
S3_FORCE_PATH_STYLE = (
    os.environ.get("S3_FORCE_PATH_STYLE", "false").lower() == "true"
)

WORKER_ID = os.environ.get("WORKER_ID") or socket.gethostname() or "worker-1"

RABBITMQ_URL = os.environ.get(
    "RABBITMQ_URL", "amqp://guest:guest@localhost:5672"
)
RABBITMQ_QUEUE = os.environ.get("RABBITMQ_QUEUE", "jobs")

LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO").upper()
