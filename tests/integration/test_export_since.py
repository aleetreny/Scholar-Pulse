from __future__ import annotations

import json
from datetime import datetime, timezone

import pandas as pd

from pipelines.db.models import Paper, PaperCategory, PaperVersion
from pipelines.db.session import session_scope
from pipelines.embeddings.export_colab import export_snapshot


def _seed_paper(paper_id: str, version_id: str, dt: datetime, category: str) -> None:
    with session_scope() as session:
        session.add(Paper(paper_id=paper_id))
        session.add(
            PaperVersion(
                paper_id=paper_id,
                paper_version_id=version_id,
                version=1,
                title=f"Title {paper_id}",
                abstract=f"Abstract {paper_id}",
                submitted_at=dt,
                updated_at=dt,
                content_hash=(paper_id.replace(".", "") + "x" * 64)[:64],
            )
        )
        session.add(
            PaperCategory(
                paper_id=paper_id,
                category=category,
                latest_submitted_at=dt,
            )
        )


def test_export_snapshot_since_filters_latest_versions() -> None:
    old_dt = datetime(2020, 1, 1, tzinfo=timezone.utc)
    new_dt = datetime(2026, 2, 28, 12, 0, tzinfo=timezone.utc)

    _seed_paper("2001.00001", "2001.00001v1", old_dt, "cs.AI")
    _seed_paper("2602.00001", "2602.00001v1", new_dt, "cs.LG")

    snapshot_id = "20260301T120000Z__cs__bge-m3"
    manifest_path = export_snapshot(
        snapshot_id=snapshot_id,
        taxonomy="cs",
        updated_since=datetime(2026, 2, 1, tzinfo=timezone.utc),
    )

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert manifest["document_count"] == 1
    assert len(manifest["shards"]) == 1

    shard_path = manifest_path.parent / manifest["shards"][0]["relative_path"]
    frame = pd.read_parquet(shard_path)
    assert frame["doc_id"].tolist() == ["2602.00001v1"]
