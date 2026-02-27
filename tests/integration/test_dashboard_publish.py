from __future__ import annotations

import numpy as np
import pandas as pd

from apps.dashboard.data_access import load_bundle
from pipelines.common.settings import get_settings
from pipelines.publish.dashboard_feeds import build_dashboard_feeds


def test_dashboard_publish_and_load_bundle() -> None:
    settings = get_settings()
    snapshot_id = "20260227T120000Z__cs-stat-physics__bge-m3"

    export_dir = settings.data_dir / "interim" / "exports" / snapshot_id
    embed_dir = settings.data_dir / "processed" / "embeddings" / snapshot_id
    export_dir.mkdir(parents=True, exist_ok=True)
    embed_dir.mkdir(parents=True, exist_ok=True)

    documents = pd.DataFrame(
        {
            "doc_id": ["a", "b", "c", "d"],
            "paper_id": ["p1", "p2", "p3", "p4"],
            "paper_version_id": ["p1v1", "p2v1", "p3v1", "p4v1"],
            "title": ["t1", "t2", "t3", "t4"],
            "abstract": ["x", "y", "z", "w"],
            "submitted_at": [
                "2020-01-01T00:00:00+00:00",
                "2021-01-01T00:00:00+00:00",
                "2022-01-01T00:00:00+00:00",
                "2023-01-01T00:00:00+00:00",
            ],
            "year": [2020, 2021, 2022, 2023],
            "categories": [["cs.AI"], ["stat.ML"], ["physics.comp-ph"], ["cs.LG"]],
        }
    )
    documents.to_parquet(export_dir / "documents_shard_00000.parquet", index=False)

    vectors = np.array(
        [
            [1.0, 0.0, 0.0],
            [0.0, 1.0, 0.0],
            [0.0, 0.0, 1.0],
            [1.0, 1.0, 0.0],
        ],
        dtype=np.float32,
    )
    vectors /= np.linalg.norm(vectors, axis=1, keepdims=True)
    pd.DataFrame(
        {
            "doc_id": ["a", "b", "c", "d"],
            "embedding": [row.tolist() for row in vectors],
        }
    ).to_parquet(embed_dir / "vectors_shard_00000.parquet", index=False)

    result = build_dashboard_feeds(snapshot_id=snapshot_id, cluster_count=3, max_docs=0, seed=7)
    assert result.records_used == 4
    assert result.clusters >= 1

    bundle = load_bundle(snapshot_id=snapshot_id)
    assert not bundle.map_points.empty
    assert not bundle.metrics.empty
    assert not bundle.frontier.empty
