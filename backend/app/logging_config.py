"""Structured JSON logging helpers for API and worker processes."""
import logging
import sys

try:
    from pythonjsonlogger.json import JsonFormatter
except ImportError:
    from pythonjsonlogger.jsonlogger import JsonFormatter


def configure_logging(level: int = logging.INFO) -> None:
    """Configure root logger to emit JSON lines to stdout."""
    handler = logging.StreamHandler(sys.stdout)
    formatter = JsonFormatter(
        "%(asctime)s %(levelname)s %(name)s %(message)s",
        rename_fields={"asctime": "ts", "levelname": "level", "name": "logger"},
    )
    handler.setFormatter(formatter)

    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(level)


def get_logger(name: str) -> logging.Logger:
    """Return named logger configured by `configure_logging`."""
    return logging.getLogger(name)
