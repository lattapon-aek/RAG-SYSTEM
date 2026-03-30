"""
Shared StructuredLogger — JSON log output for all services.
Usage:
    from shared.structured_logger import get_logger
    logger = get_logger("rag-service")
    logger.info("query received", request_id="abc", query_length=42)
"""
import json
import logging
import sys
from datetime import datetime, timezone
from typing import Any


class _JSONFormatter(logging.Formatter):
    def __init__(self, service: str):
        super().__init__()
        self._service = service

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "service": self._service,
            "message": record.getMessage(),
        }
        # Merge any extra fields attached via logger.info(..., extra={...})
        for key, value in record.__dict__.items():
            if key not in (
                "name", "msg", "args", "levelname", "levelno", "pathname",
                "filename", "module", "exc_info", "exc_text", "stack_info",
                "lineno", "funcName", "created", "msecs", "relativeCreated",
                "thread", "threadName", "processName", "process", "message",
                "taskName",
            ):
                payload[key] = value
        if record.exc_info:
            payload["exc_info"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


class StructuredLogger:
    """Thin wrapper that injects `service` into every log record."""

    def __init__(self, service: str, level: int = logging.INFO):
        self._service = service
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(_JSONFormatter(service))
        self._logger = logging.getLogger(service)
        self._logger.handlers = [handler]
        self._logger.setLevel(level)
        self._logger.propagate = False

    def _log(self, level: int, message: str, **kwargs: Any) -> None:
        self._logger.log(level, message, extra=kwargs)

    def info(self, message: str, **kwargs: Any) -> None:
        self._log(logging.INFO, message, **kwargs)

    def warning(self, message: str, **kwargs: Any) -> None:
        self._log(logging.WARNING, message, **kwargs)

    def error(self, message: str, **kwargs: Any) -> None:
        self._log(logging.ERROR, message, **kwargs)

    def debug(self, message: str, **kwargs: Any) -> None:
        self._log(logging.DEBUG, message, **kwargs)


def get_logger(service: str, level: int = logging.INFO) -> StructuredLogger:
    return StructuredLogger(service, level)
