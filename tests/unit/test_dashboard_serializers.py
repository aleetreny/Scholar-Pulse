from __future__ import annotations

import pandas as pd

from apps.dashboard.view_models import MapViewModel
from apps.dashboard_api.serializers import serialize_map_model


def test_serialize_map_model_keeps_preview_payload_lightweight() -> None:
    model = MapViewModel(
        density=pd.DataFrame(
            [
                {
                    "bin_x": 1,
                    "bin_y": 2,
                    "doc_count": 4,
                    "x_center": 1.25,
                    "y_center": -2.5,
                }
            ]
        ),
        sample=pd.DataFrame(
            [
                {
                    "doc_id": "doc-1",
                    "paper_id": "paper-1",
                    "paper_version_id": "paper-1v1",
                    "title": "Preview title should not be sent",
                    "abstract_preview": "Preview abstract should not be sent",
                    "submitted_at": "2026-03-01T00:00:00+00:00",
                    "year": 2026,
                    "categories": ["cs.AI"],
                    "x": 3.5,
                    "y": -1.5,
                }
            ]
        ),
        detail=pd.DataFrame(
            [
                {
                    "doc_id": "doc-2",
                    "paper_id": "paper-2",
                    "paper_version_id": "paper-2v1",
                    "title": "Exact detail title",
                    "abstract_preview": "Exact detail abstract",
                    "submitted_at": "2026-03-02T00:00:00+00:00",
                    "year": 2026,
                    "categories": ["cs.AI"],
                    "x": 4.5,
                    "y": -0.5,
                    "bin_x": 3,
                    "bin_y": 1,
                }
            ]
        ),
        latest_rows_frame=pd.DataFrame(),
        scope_headline="Whole-corpus map surface",
        scope_caption="Preview scope",
        visible_metric="1",
        mode_label="Global preview",
        mode_class="mode-chip mode-preview",
        mode_note="Global preview active.",
    )

    payload = serialize_map_model(model)

    assert payload["sample"] == [{"docId": "doc-1", "x": 3.5, "y": -1.5}]
    assert "title" not in payload["sample"][0]
    assert "paperId" not in payload["sample"][0]
    assert payload["detail"][0]["docId"] == "doc-2"
    assert payload["detail"][0]["categories"] == ["AI & Machine Learning"]