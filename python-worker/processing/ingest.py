import logging
import os
import tempfile

import polars as pl

from config import S3_BUCKET
from s3_client import download_to_file, get_client

log = logging.getLogger(__name__)

_CSV_MIMES = {"text/csv", "application/csv"}
_SPREADSHEET_MIMES = {
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
    "application/vnd.oasis.opendocument.spreadsheet",
}

_MAX_FILE_BYTES = int(os.environ.get("MAX_UPLOAD_FILE_BYTES", str(300 * 1024 ** 2)))


def _check_file_size(s3_key: str) -> None:
    head = get_client().head_object(Bucket=S3_BUCKET, Key=s3_key)
    size = head.get("ContentLength", 0)
    if size > _MAX_FILE_BYTES:
        raise ValueError(
            f"File is too large: {size / 1024 ** 2:.0f} MB "
            f"(max {_MAX_FILE_BYTES / 1024 ** 2:.0f} MB)"
        )


_CSV_READ_KWARGS: dict = dict(infer_schema_length=10_000, truncate_ragged_lines=True)


def _read_csv(path: str) -> pl.DataFrame:
    """Read CSV from disk with parser fallbacks without buffering S3 in RAM."""
    try:
        return pl.read_csv(path, **_CSV_READ_KWARGS)
    except pl.exceptions.ComputeError as exc:
        if "malformed" not in str(exc).lower():
            raise
        log.warning("Parallel CSV parse failed (%s), retrying with n_threads=1", exc)

    try:
        return pl.read_csv(path, **_CSV_READ_KWARGS, n_threads=1)
    except pl.exceptions.ComputeError as exc:
        if "malformed" not in str(exc).lower():
            raise
        log.warning("n_threads=1 CSV parse failed (%s), retrying with PyArrow", exc)

    import pyarrow.csv as pa_csv

    table = pa_csv.read_csv(path)
    return pl.from_arrow(table)


def load_dataframe(
    s3_key: str,
    original_filename: str,
    mime_type: str = "",
) -> pl.DataFrame:
    _check_file_size(s3_key)
    ext = (
        original_filename.rsplit(".", 1)[-1].lower()
        if "." in original_filename else ""
    )
    mime = (mime_type or "").lower().split(";")[0].strip()

    is_csv = ext == "csv" or mime in _CSV_MIMES
    is_spreadsheet = ext in ("xlsx", "xls", "ods") or mime in _SPREADSHEET_MIMES

    suffix = f".{ext}" if ext else ""
    fd, path = tempfile.mkstemp(prefix="ingest_", suffix=suffix)
    os.close(fd)
    try:
        download_to_file(s3_key, path)

        if is_csv:
            return _read_csv(path)

        if is_spreadsheet:
            return pl.read_excel(path, engine="calamine")

        try:
            return _read_csv(path)
        except Exception as exc:
            log.warning("Failed to parse %s as CSV (ext=%r): %s", s3_key, ext, exc)
            raise ValueError(f"Unsupported file format: .{ext}") from exc
    finally:
        try:
            os.remove(path)
        except OSError:
            pass
