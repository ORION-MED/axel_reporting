import os
import tempfile
import polars as pl
from s3_client import upload_file_path

_XLSX_MIME = (
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
)


def export_dataframe(
    df: pl.DataFrame, s3_key_base: str, fmt: str,
) -> tuple[str, int]:
    """Export DataFrame to S3; returns (s3_key, size_bytes)."""
    suffix = f".{fmt}"
    if fmt == "xlsx":
        suffix = ".xlsx"

    fd, path = tempfile.mkstemp(prefix="export_", suffix=suffix)
    os.close(fd)
    try:
        if fmt == "csv":
            df.write_csv(path)
            s3_key = f"{s3_key_base}.csv"
            size = upload_file_path(s3_key, path, content_type="text/csv")

        elif fmt == "parquet":
            df.write_parquet(path, compression="zstd", compression_level=3)
            s3_key = f"{s3_key_base}.parquet"
            size = upload_file_path(
                s3_key, path,
                content_type="application/octet-stream",
            )

        elif fmt == "xlsx":
            df.write_excel(path)
            s3_key = f"{s3_key_base}.xlsx"
            size = upload_file_path(s3_key, path, content_type=_XLSX_MIME)

        else:
            raise ValueError(f"Unsupported export format: {fmt}")
    finally:
        try:
            os.remove(path)
        except OSError:
            pass

    return s3_key, size
