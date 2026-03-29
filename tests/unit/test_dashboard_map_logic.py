from __future__ import annotations

import pandas as pd

from apps.dashboard.data_access import DashboardBundle
from apps.dashboard.logic import FOCUS_DETAIL_CAP, build_map_view_model


def test_broad_viewport_keeps_exact_papers_clickable(monkeypatch) -> None:
    sample = pd.DataFrame(
        [
            {
                "doc_id": f"doc-{index}",
                "paper_id": f"paper-{index}",
                "paper_version_id": f"paper-{index}v1",
                "title": f"Paper {index}",
                "abstract_preview": "preview",
                "submitted_at": "2026-03-01T00:00:00+00:00",
                "year": 2026,
                "categories": ["cs.AI"],
                "x": float(index),
                "y": float(index),
            }
            for index in range(20)
        ]
    )
    detail = pd.DataFrame(
        [
            {
                "doc_id": f"detail-{index}",
                "paper_id": f"detail-paper-{index}",
                "paper_version_id": f"detail-paper-{index}v1",
                "title": f"Detail paper {index}",
                "abstract_preview": "exact",
                "submitted_at": "2026-03-01T00:00:00+00:00",
                "year": 2026,
                "categories": ["cs.AI"],
                "x": float(index),
                "y": float(index),
                "bin_x": index,
                "bin_y": index,
            }
            for index in range(FOCUS_DETAIL_CAP + 25)
        ]
    )
    bundle = DashboardBundle(
        snapshot_id="snapshot-1",
        map_density=pd.DataFrame(
            [
                {
                    "bin_x": 0,
                    "bin_y": 0,
                    "doc_count": 100,
                    "x_center": 0.0,
                    "y_center": 0.0,
                }
            ]
        ),
        map_points_sample=sample,
        latest_papers=pd.DataFrame(),
        build_manifest={},
    )

    monkeypatch.setattr(
        "apps.dashboard.logic.query_map_detail",
        lambda **_: detail,
    )

    model = build_map_view_model(
        snapshot_id="snapshot-1",
        bundle=bundle,
        taxonomy_tokens=[],
        year_range=[2026, 2026],
        search_text=None,
        relayout_data={
            "xaxis.range[0]": 0.0,
            "xaxis.range[1]": 10.0,
            "yaxis.range[0]": 0.0,
            "yaxis.range[1]": 10.0,
        },
    )

    assert model.mode_label == "Zoom for focus"
    assert len(model.detail) == FOCUS_DETAIL_CAP
    assert model.visible_metric == "4.0K"
    assert "selectable" in model.mode_note.lower()