"""
Structured logging (N4). The spec says: when the pipeline fails, you must be able to
answer "which review, what step, what error" from logs ALONE. Plain text prints can't
be queried; JSON logs can (Render/Logflare/Axiom let you filter by field).

So every log line is a JSON object. Pipeline code attaches context via `extra={...}`:

    logger.info("analysis_done", extra={"review_id": rid, "job_id": jid,
                                         "step": "analyze", "duration_ms": 42})

That becomes one searchable JSON record. Call `configure_logging()` once at startup.
"""
import logging
import sys

try:
    from pythonjsonlogger.json import JsonFormatter  # python-json-logger >= 3.1
except ImportError:  # older versions
    from pythonjsonlogger.jsonlogger import JsonFormatter


def configure_logging(level: int = logging.INFO) -> None:
    handler = logging.StreamHandler(sys.stdout)
    # These fields appear on every line; `extra=` adds per-event fields on top.
    formatter = JsonFormatter(
        "%(asctime)s %(levelname)s %(name)s %(message)s",
        rename_fields={"asctime": "ts", "levelname": "level", "name": "logger"},
    )
    handler.setFormatter(formatter)

    root = logging.getLogger()
    root.handlers.clear()  # drop uvicorn's default text handler so we don't double-log
    root.addHandler(handler)
    root.setLevel(level)


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(name)
