from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from pipelines.common.settings import get_settings
from pipelines.db.models import Paper, PaperCategory, PaperVersion
from pipelines.db.session import session_scope
from pipelines.ingestion import service


def test_incremental_starts_from_latest_known_if_watermark_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = get_settings()
    latest_updated = datetime(2025, 1, 10, 12, 0, tzinfo=timezone.utc)

    with session_scope() as session:
        session.add(Paper(paper_id="2501.00001"))
        session.add(
            PaperVersion(
                paper_id="2501.00001",
                paper_version_id="2501.00001v1",
                version=1,
                title="Known paper",
                abstract="Known abstract",
                submitted_at=latest_updated,
                updated_at=latest_updated,
                content_hash="a" * 64,
            )
        )
        session.add(
            PaperCategory(
                paper_id="2501.00001",
                category="cs.AI",
                latest_submitted_at=latest_updated,
            )
        )

    captured: dict[str, datetime] = {}

    def fake_fetch_records(self, taxonomy, from_dt, to_dt, max_records=None):
        captured["from_dt"] = from_dt
        captured["to_dt"] = to_dt
        return iter([])

    monkeypatch.setattr(service.ArxivClient, "fetch_records", fake_fetch_records)

    as_of = latest_updated + timedelta(days=2)
    stats = service.run_incremental(as_of=as_of, taxonomy=["cs"])

    assert stats.processed_entries == 0
    assert captured["to_dt"] == as_of
    expected_from = latest_updated - timedelta(hours=settings.arxiv_overlap_hours)
    observed_from = captured["from_dt"]
    if observed_from.tzinfo is None:
        observed_from = observed_from.replace(tzinfo=timezone.utc)
    assert observed_from == expected_from
