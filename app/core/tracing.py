"""Tracing applicatif centralisé pour les étapes importantes du backend."""

from __future__ import annotations

import logging
from typing import Any


TRACING_ENABLED = True

_LOGGER_NAME = "app.trace"
_logger = logging.getLogger(_LOGGER_NAME)


def _configure_logger() -> None:
    try:
        if not _logger.handlers:
            handler = logging.StreamHandler()
            handler.setFormatter(
                logging.Formatter(
                    "[TRACE][%(trace_category)s] %(filename)s:%(lineno)d - %(message)s"
                )
            )
            _logger.addHandler(handler)
        _logger.setLevel(logging.INFO)
        _logger.propagate = False
    except Exception:
        _logger.disabled = True


def _safe_value(value: Any) -> str:
    try:
        return str(value).replace("\r", "\\r").replace("\n", "\\n")
    except Exception:
        return "<unavailable>"


def trace(category: str, message: str, **details: Any) -> None:
    """Émet une trace lisible sans jamais perturber le traitement métier."""
    if not TRACING_ENABLED:
        return

    try:
        suffix = ""
        if details:
            suffix = " | " + " | ".join(
                f"{key}={_safe_value(value)}" for key, value in details.items()
            )

        _logger.info(
            "%s%s",
            message,
            suffix,
            extra={"trace_category": _safe_value(category).upper()},
            stacklevel=2,
        )
    except Exception:
        return


_configure_logger()
