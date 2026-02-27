from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

from pipelines.common.files import sha256_file
from pipelines.common.settings import get_settings
from pipelines.embeddings.import_colab import validate_and_register



def _normed_vectors(rows: int, dim: int) -> np.ndarray:
    raw = np.random.RandomState(42).randn(rows, dim).astype(np.float32)
    norms = np.linalg.norm(raw, axis=1, keepdims=True)
    return raw / norms



def test_manifest_validation_and_registration() -> None:
    settings = get_settings()
    snapshot_id = "20260227T120000Z__cs-stat-physics__bge-m3"

    export_dir = settings.data_dir / "interim" / "exports" / snapshot_id
    embed_dir = settings.data_dir / "processed" / "embeddings" / snapshot_id
    export_dir.mkdir(parents=True, exist_ok=True)
    embed_dir.mkdir(parents=True, exist_ok=True)

    docs = pd.DataFrame({"doc_id": ["a", "b"], "text": ["x", "y"]})
    doc_shard = export_dir / "documents_shard_00000.parquet"
    docs.to_parquet(doc_shard, index=False)

    export_manifest = {
        "snapshot_id": snapshot_id,
        "taxonomy": "cs,stat,physics",
        "model_name": "BAAI/bge-m3",
        "model_version": "bge-m3",
        "expected_dimension": 3,
        "document_count": 2,
        "shards": [
            {
                "name": doc_shard.name,
                "relative_path": doc_shard.name,
                "rows": 2,
                "sha256": sha256_file(doc_shard),
            }
        ],
    }
    (export_dir / "manifest.json").write_text(json.dumps(export_manifest), encoding="utf-8")

    vectors = _normed_vectors(rows=2, dim=3)
    vector_shard = embed_dir / "vectors_shard_00000.parquet"
    pd.DataFrame({"doc_id": ["a", "b"], "embedding": [vectors[0].tolist(), vectors[1].tolist()]}).to_parquet(
        vector_shard,
        index=False,
    )

    embedding_manifest = {
        "snapshot_id": snapshot_id,
        "model_name": "BAAI/bge-m3",
        "expected_dimension": 3,
        "vector_count": 2,
        "shards": [
            {
                "name": vector_shard.name,
                "relative_path": vector_shard.name,
                "rows": 2,
                "sha256": sha256_file(vector_shard),
            }
        ],
    }
    (embed_dir / "manifest.json").write_text(json.dumps(embedding_manifest), encoding="utf-8")

    result = validate_and_register(snapshot_id=snapshot_id)
    assert result["vector_count"] == 2
    assert result["expected_dimension"] == 3
