from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from pipelines.common.files import sha256_file
from pipelines.common.settings import get_settings
from pipelines.embeddings.export_colab import export_snapshot
from pipelines.embeddings.import_colab import validate_and_register
from pipelines.ingestion.service import run_backfill
from pipelines.ingestion.types import ArxivRecord



def _fixture_records() -> list[ArxivRecord]:
    now = datetime(2025, 1, 1, tzinfo=timezone.utc)
    return [
        ArxivRecord(
            paper_id="2401.00001",
            paper_version_id="2401.00001v1",
            version=1,
            title="Paper A",
            abstract="Abstract A",
            submitted_at=now,
            updated_at=now,
            categories=["cs.AI"],
            raw={"id": "a"},
        ),
        ArxivRecord(
            paper_id="2401.00002",
            paper_version_id="2401.00002v1",
            version=1,
            title="Paper B",
            abstract="Abstract B",
            submitted_at=now,
            updated_at=now,
            categories=["stat.ML"],
            raw={"id": "b"},
        ),
    ]


@pytest.mark.parametrize("snapshot_id", ["20260227T120000Z__cs-stat-physics__bge-m3"])
def test_e2e_smoke(monkeypatch: pytest.MonkeyPatch, snapshot_id: str) -> None:
    from pipelines.ingestion import service

    records = _fixture_records()

    def fake_fetch_records(*args, **kwargs):
        return iter(records)

    monkeypatch.setattr(service.ArxivClient, "fetch_records", fake_fetch_records)

    stats = run_backfill(
        from_date=datetime(2025, 1, 1, tzinfo=timezone.utc),
        to_date=datetime(2025, 1, 2, tzinfo=timezone.utc),
        taxonomy=["cs", "stat"],
    )
    assert stats.processed_entries == 2

    manifest_path = export_snapshot(snapshot_id=snapshot_id, taxonomy="cs,stat")
    assert manifest_path.exists()

    settings = get_settings()
    export_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    embed_dir = settings.data_dir / "processed" / "embeddings" / snapshot_id
    embed_dir.mkdir(parents=True, exist_ok=True)

    shard_metas = []
    for shard in export_manifest["shards"]:
        docs = pd.read_parquet(Path(manifest_path.parent) / shard["relative_path"])
        rng = np.random.RandomState(7)
        vectors = rng.randn(len(docs), 3).astype(np.float32)
        vectors /= np.linalg.norm(vectors, axis=1, keepdims=True)

        vector_name = shard["name"].replace("documents_", "vectors_")
        vector_path = embed_dir / vector_name
        pd.DataFrame(
            {
                "doc_id": docs["doc_id"].tolist(),
                "embedding": [row.tolist() for row in vectors],
            }
        ).to_parquet(vector_path, index=False)

        shard_metas.append(
            {
                "name": vector_name,
                "relative_path": vector_name,
                "rows": len(docs),
                "sha256": sha256_file(vector_path),
            }
        )

    (embed_dir / "manifest.json").write_text(
        json.dumps(
            {
                "snapshot_id": snapshot_id,
                "model_name": "BAAI/bge-m3",
                "expected_dimension": 3,
                "vector_count": export_manifest["document_count"],
                "shards": shard_metas,
            }
        ),
        encoding="utf-8",
    )

    result = validate_and_register(snapshot_id=snapshot_id)
    assert result["vector_count"] == export_manifest["document_count"]
