from __future__ import annotations

from typing import Any

import pandas as pd

from apps.dashboard.taxonomy import topic_labels_for_categories
from apps.dashboard.view_models import ControlViewModel, MapViewModel


def serialize_control_model(model: ControlViewModel) -> dict[str, Any]:
    return {
        "taxonomyOptions": model.taxonomy_options,
        "yearMin": model.year_min,
        "yearMax": model.year_max,
        "yearValue": model.year_value,
        "yearMarks": {str(key): value for key, value in model.year_marks.items()},
        "snapshotPill": model.snapshot_pill,
        "statusChip": model.status_chip,
        "metrics": {
            "corpus": model.metric_corpus,
            "sample": model.metric_sample,
            "latest": model.metric_latest,
            "taxonomy": model.metric_taxonomy,
            "years": model.metric_years,
        },
    }


def _serialize_density(frame: pd.DataFrame) -> list[dict[str, Any]]:
    if frame.empty:
        return []
    rows: list[dict[str, Any]] = []
    for record in frame.to_dict(orient="records"):
        rows.append(
            {
                "binX": int(record["bin_x"]),
                "binY": int(record["bin_y"]),
                "docCount": int(record["doc_count"]),
                "xCenter": float(record["x_center"]),
                "yCenter": float(record["y_center"]),
            }
        )
    return rows


def _serialize_preview_points(frame: pd.DataFrame) -> list[dict[str, Any]]:
    if frame.empty:
        return []

    rows: list[dict[str, Any]] = []
    for record in frame.to_dict(orient="records"):
        rows.append(
            {
                "docId": str(record["doc_id"]),
                "x": float(record["x"]),
                "y": float(record["y"]),
            }
        )
    return rows


def _serialize_detail_points(frame: pd.DataFrame) -> list[dict[str, Any]]:
    if frame.empty:
        return []
    rows: list[dict[str, Any]] = []
    for record in frame.to_dict(orient="records"):
        categories = topic_labels_for_categories(record.get("categories", []) or [])
        rows.append(
            {
                "docId": str(record["doc_id"]),
                "paperId": str(record["paper_id"]),
                "paperVersionId": str(record.get("paper_version_id", "")),
                "title": str(record["title"]),
                "abstractPreview": str(record.get("abstract_preview", "")),
                "submittedAt": str(record.get("submitted_at", "")),
                "year": int(record.get("year", 0)),
                "categories": categories,
                "x": float(record["x"]),
                "y": float(record["y"]),
                "binX": int(record.get("bin_x", 0) or 0),
                "binY": int(record.get("bin_y", 0) or 0),
            }
        )
    return rows


def _serialize_latest(frame: pd.DataFrame) -> list[dict[str, Any]]:
    if frame.empty:
        return []

    rows: list[dict[str, Any]] = []
    for record in frame.to_dict(orient="records"):
        categories = topic_labels_for_categories(record.get("categories", []) or [])
        rows.append(
            {
                "docId": str(record["doc_id"]),
                "paperId": str(record["paper_id"]),
                "paperVersionId": str(record.get("paper_version_id", "")),
                "title": str(record["title"]),
                "submittedAt": str(record["submitted_at"]),
                "year": int(record["year"]),
                "categories": categories,
                "categoriesText": ", ".join(categories),
                "recencyScore": round(float(record["recency_score"]), 4),
                "noveltyScore": round(float(record["novelty_score"]), 4),
                "score": round(float(record["score"]), 4),
            }
        )
    return rows


def serialize_map_model(model: MapViewModel) -> dict[str, Any]:
    return {
        "density": _serialize_density(model.density),
        "sample": _serialize_preview_points(model.sample),
        "detail": _serialize_detail_points(model.detail),
        "scopeHeadline": model.scope_headline,
        "scopeCaption": model.scope_caption,
        "visibleMetric": model.visible_metric,
        "modeLabel": model.mode_label,
        "modeClass": model.mode_class,
        "modeNote": model.mode_note,
    }


def serialize_latest_rows(frame: pd.DataFrame) -> list[dict[str, Any]]:
    return _serialize_latest(frame)


def serialize_paper_sheet(
    detail: dict[str, Any],
    neighbors: list[dict[str, Any]],
    similarity_error: str | None,
) -> dict[str, Any]:
    paper = {
        "docId": str(detail["doc_id"]),
        "paperId": str(detail["paper_id"]),
        "paperVersionId": str(detail["paper_version_id"]),
        "title": str(detail["title"]),
        "abstractPreview": str(detail["abstract_preview"]),
        "submittedAt": str(detail["submitted_at"]),
        "year": int(detail["year"]),
        "categories": topic_labels_for_categories(detail["categories"]),
    }
    neighbor_rows = [
        {
            "docId": str(row["doc_id"]),
            "paperId": str(row.get("paper_id", row["doc_id"])),
            "title": str(row.get("title", row["doc_id"])),
            "cosineSimilarity": round(float(row["cosine_similarity"]), 4),
        }
        for row in neighbors
    ]
    return {
        "paper": paper,
        "neighbors": neighbor_rows,
        "similarityError": similarity_error,
    }