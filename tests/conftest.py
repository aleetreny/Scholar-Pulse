from __future__ import annotations

from pathlib import Path

import pytest

from pipelines.common.settings import get_settings
from pipelines.db.base import Base
from pipelines.db.session import get_engine, reset_engine


@pytest.fixture(autouse=True)
def test_environment(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    db_path = tmp_path / "test.db"
    data_dir = tmp_path / "data"

    monkeypatch.setenv("DATABASE_URL", f"sqlite+pysqlite:///{db_path}")
    monkeypatch.setenv("DATA_DIR", str(data_dir))
    monkeypatch.setenv("EMBEDDING_DIMENSION", "3")
    monkeypatch.setenv("EMBEDDING_SHARD_SIZE", "2")
    monkeypatch.setenv("TAXONOMY_DEFAULT", "cs,stat,physics")

    get_settings.cache_clear()
    reset_engine()
    settings = get_settings()
    Base.metadata.create_all(get_engine())

    yield settings

    get_settings.cache_clear()
    reset_engine()
