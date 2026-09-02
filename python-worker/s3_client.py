import io
import json
import os
import threading
import boto3
from botocore.config import Config
from boto3.s3.transfer import TransferConfig
from config import (
    S3_BUCKET, S3_REGION, S3_ENDPOINT,
    S3_ACCESS_KEY, S3_SECRET_KEY, S3_FORCE_PATH_STYLE,
)

_S3_CONFIG = Config(
    s3={"addressing_style": "path"} if S3_FORCE_PATH_STYLE else {},
    max_pool_connections=50,
    tcp_keepalive=True,
    connect_timeout=10,
    read_timeout=60,
    retries={"max_attempts": 3, "mode": "adaptive"},
)

# Parallel multipart download: splits large files into 16 MB parts, fetches up to 8 at once
_DOWNLOAD_CONFIG = TransferConfig(
    multipart_threshold=16 * 1024 * 1024,
    multipart_chunksize=16 * 1024 * 1024,
    max_concurrency=8,
    use_threads=True,
)

# Parallel multipart upload: same approach for uploads
_UPLOAD_CONFIG = TransferConfig(
    multipart_threshold=8 * 1024 * 1024,
    multipart_chunksize=8 * 1024 * 1024,
    max_concurrency=8,
    use_threads=True,
)


def _make_client():
    kwargs = dict(region_name=S3_REGION, config=_S3_CONFIG)
    if S3_ENDPOINT:
        kwargs["endpoint_url"] = S3_ENDPOINT
    if S3_ACCESS_KEY and S3_SECRET_KEY:
        kwargs["aws_access_key_id"] = S3_ACCESS_KEY
        kwargs["aws_secret_access_key"] = S3_SECRET_KEY
    return boto3.client("s3", **kwargs)


_tls = threading.local()


def get_client():
    client = getattr(_tls, 'client', None)
    if client is None:
        _tls.client = _make_client()
    return _tls.client


def download_bytes(
    s3_key: str, on_progress=None, total_size: int = 0,
) -> io.BytesIO:
    buf = io.BytesIO()

    if on_progress and total_size > 0:
        transferred = [0]

        def _cb(n: int):
            transferred[0] += n
            on_progress(int(transferred[0] / total_size * 100))

        callback = _cb
    else:
        callback = None

    get_client().download_fileobj(
        S3_BUCKET, s3_key, buf,
        Config=_DOWNLOAD_CONFIG,
        Callback=callback,
    )
    buf.seek(0)
    return buf


def download_to_file(
    s3_key: str,
    path: str,
    on_progress=None,
    total_size: int = 0,
) -> int:
    """Download an object directly to disk instead of buffering it in memory."""
    if on_progress and total_size > 0:
        transferred = [0]

        def _cb(n: int):
            transferred[0] += n
            on_progress(int(transferred[0] / total_size * 100))

        callback = _cb
    else:
        callback = None

    with open(path, "wb") as file_obj:
        get_client().download_fileobj(
            S3_BUCKET, s3_key, file_obj,
            Config=_DOWNLOAD_CONFIG,
            Callback=callback,
        )
    return os.path.getsize(path)


def upload_bytes(
    s3_key: str, data: bytes,
    content_type: str = "application/octet-stream",
) -> int:
    get_client().upload_fileobj(
        io.BytesIO(data), S3_BUCKET, s3_key,
        ExtraArgs={"ContentType": content_type},
        Config=_UPLOAD_CONFIG,
    )
    return len(data)


def get_object_body(s3_key: str):
    """Return raw S3 streaming body — avoids BytesIO for large files."""
    response = get_client().get_object(Bucket=S3_BUCKET, Key=s3_key)
    return response["Body"]


def upload_seekable(
    s3_key: str,
    buf: io.BytesIO,
    content_type: str = "application/octet-stream",
) -> int:
    """Upload a BytesIO buffer without materialising a second copy."""
    size = buf.tell()
    buf.seek(0)
    get_client().upload_fileobj(
        buf, S3_BUCKET, s3_key,
        ExtraArgs={"ContentType": content_type},
        Config=_UPLOAD_CONFIG,
    )
    return size


def upload_file_path(
    s3_key: str,
    path: str,
    content_type: str = "application/octet-stream",
) -> int:
    """Upload a file from disk via multipart upload without a BytesIO copy."""
    size = os.path.getsize(path)
    with open(path, "rb") as file_obj:
        get_client().upload_fileobj(
            file_obj, S3_BUCKET, s3_key,
            ExtraArgs={"ContentType": content_type},
            Config=_UPLOAD_CONFIG,
        )
    return size


def upload_json(s3_key: str, payload: dict) -> int:
    data = json.dumps(
        payload, ensure_ascii=False, default=str,
    ).encode("utf-8")
    return upload_bytes(s3_key, data, content_type="application/json")
