from __future__ import annotations

from pipelines.common.logging_utils import configure_logging
from pipelines.common.settings import get_settings
from pipelines.db.base import Base
from pipelines.db.session import get_engine


def run() -> None:
    configure_logging()
    get_settings()
    engine = get_engine()
    Base.metadata.create_all(engine)


if __name__ == "__main__":
    run()
