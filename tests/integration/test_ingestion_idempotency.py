from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import func, select

from pipelines.db.models import PaperVersion
from pipelines.db.session import session_scope
from pipelines.ingestion.service import _upsert_record
from pipelines.ingestion.types import ArxivRecord



def _record(abstract: str) -> ArxivRecord:
    now = datetime(2025, 1, 1, tzinfo=timezone.utc)
    return ArxivRecord(
        paper_id="2401.12345",
        paper_version_id="2401.12345v1",
        version=1,
        title="Test Title",
        abstract=abstract,
        submitted_at=now,
        updated_at=now,
        categories=["cs.AI", "stat.ML"],
        raw={"source": "test"},
    )



def test_upsert_record_is_idempotent() -> None:
    with session_scope() as session:
        inserted, updated = _upsert_record(session, _record("alpha"))
        assert inserted is True
        assert updated is False

    with session_scope() as session:
        inserted2, updated2 = _upsert_record(session, _record("alpha"))
        assert inserted2 is False
        assert updated2 is False

    with session_scope() as session:
        inserted3, updated3 = _upsert_record(session, _record("beta"))
        assert inserted3 is False
        assert updated3 is True

    with session_scope() as session:
        count = session.scalar(select(func.count(PaperVersion.id)))
        assert count == 1
