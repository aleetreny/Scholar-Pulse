from __future__ import annotations

import logging
from typing import Any

from pipelines.common.settings import get_settings


def configure_logging() -> None:
    settings = get_settings()
    logging.basicConfig(
        level=getattr(logging, settings.log_level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    )


def get_logger(name: str, **context: Any) -> logging.Logger:
    logger = logging.getLogger(name)
    if context:
        logger = logging.LoggerAdapter(logger, extra={"context": context})  # type: ignore[assignment]
    return logger  # type: ignore[return-value]
