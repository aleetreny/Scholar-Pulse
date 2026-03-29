from __future__ import annotations

import pandas as pd

from apps.dashboard.data_access import DashboardBundle
from apps.dashboard.logic import build_latest_rows_frame


def test_build_latest_rows_frame_filters_without_viewport() -> None:
    bundle = DashboardBundle(
        snapshot_id="snapshot-1",
        map_density=pd.DataFrame(),
        map_points_sample=pd.DataFrame(
            [
                {"doc_id": "doc-1", "year": 2024},
                {"doc_id": "doc-2", "year": 2025},
            ]
        ),
        latest_papers=pd.DataFrame(
            [
                {
                    "doc_id": "doc-1",
                    "paper_id": "paper-1",
                    "paper_version_id": "paper-1v1",
                    "title": "Transformer planning for robots",
                    "submitted_at": "2024-01-01T00:00:00+00:00",
                    "year": 2024,
                    "categories": ["cs.RO", "cs.LG"],
                    "recency_score": 0.7,
                    "novelty_score": 0.4,
                    "score": 0.58,
                },
                {
                    "doc_id": "doc-2",
                    "paper_id": "paper-2",
                    "paper_version_id": "paper-2v1",
                    "title": "Quantum materials overview",
                    "submitted_at": "2025-01-01T00:00:00+00:00",
                    "year": 2025,
                    "categories": ["quant-ph"],
                    "recency_score": 0.8,
                    "novelty_score": 0.6,
                    "score": 0.72,
                },
            ]
        ),
        build_manifest={},
    )

    filtered = build_latest_rows_frame(
        bundle=bundle,
        taxonomy_tokens=["robotics-control"],
        year_range=[2024, 2024],
        search_text="planning",
    )

    assert filtered["doc_id"].tolist() == ["doc-1"]