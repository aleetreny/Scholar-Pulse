from __future__ import annotations

from functools import lru_cache
from typing import Any

from fastapi import HTTPException

from apps.dashboard.data_access import available_snapshots, load_bundle, load_doc_detail
from apps.dashboard.logic import build_control_view_model, build_latest_rows_frame, build_map_view_model
from apps.dashboard_api.serializers import (
    serialize_control_model,
    serialize_latest_rows,
    serialize_map_model,
    serialize_paper_sheet,
)
from pipelines.similarity.query import SimilarityEngine


def parse_taxonomy_query(taxonomy: str | None) -> list[str]:
    if not taxonomy:
        return []
    return [token.strip() for token in taxonomy.split(",") if token.strip()]


def build_relayout_data(
    x_min: float | None,
    x_max: float | None,
    y_min: float | None,
    y_max: float | None,
) -> dict[str, float] | None:
    if None in (x_min, x_max, y_min, y_max):
        return None
    return {
        "xaxis.range[0]": float(x_min),
        "xaxis.range[1]": float(x_max),
        "yaxis.range[0]": float(y_min),
        "yaxis.range[1]": float(y_max),
    }


def ensure_snapshot_exists(snapshot_id: str) -> None:
    if snapshot_id not in available_snapshots():
        raise HTTPException(status_code=404, detail=f"Unknown snapshot: {snapshot_id}")


def snapshots_payload() -> dict[str, Any]:
    snapshots = available_snapshots()
    return {
        "snapshots": snapshots,
        "defaultSnapshotId": snapshots[0] if snapshots else None,
    }


def controls_payload(snapshot_id: str) -> dict[str, Any]:
    ensure_snapshot_exists(snapshot_id)
    bundle = load_bundle(snapshot_id)
    control_model = build_control_view_model(snapshot_id, bundle)
    return serialize_control_model(control_model)


def map_payload(
    *,
    snapshot_id: str,
    taxonomy: str | None,
    year_min: int | None,
    year_max: int | None,
    search: str | None,
    x_min: float | None,
    x_max: float | None,
    y_min: float | None,
    y_max: float | None,
) -> dict[str, Any]:
    ensure_snapshot_exists(snapshot_id)
    bundle = load_bundle(snapshot_id)
    year_range = [year_min, year_max] if year_min is not None and year_max is not None else None
    relayout_data = build_relayout_data(x_min=x_min, x_max=x_max, y_min=y_min, y_max=y_max)
    map_model = build_map_view_model(
        snapshot_id=snapshot_id,
        bundle=bundle,
        taxonomy_tokens=parse_taxonomy_query(taxonomy),
        year_range=year_range,
        search_text=search,
        relayout_data=relayout_data,
    )
    return serialize_map_model(map_model)


def latest_payload(
    *,
    snapshot_id: str,
    taxonomy: str | None,
    year_min: int | None,
    year_max: int | None,
    search: str | None,
) -> list[dict[str, Any]]:
    ensure_snapshot_exists(snapshot_id)
    bundle = load_bundle(snapshot_id)
    year_range = [year_min, year_max] if year_min is not None and year_max is not None else None
    latest_frame = build_latest_rows_frame(
        bundle=bundle,
        taxonomy_tokens=parse_taxonomy_query(taxonomy),
        year_range=year_range,
        search_text=search,
    )
    return serialize_latest_rows(latest_frame)


def workspace_payload(
    *,
    snapshot_id: str,
    taxonomy: str | None,
    year_min: int | None,
    year_max: int | None,
    search: str | None,
    x_min: float | None,
    x_max: float | None,
    y_min: float | None,
    y_max: float | None,
) -> dict[str, Any]:
    ensure_snapshot_exists(snapshot_id)
    bundle = load_bundle(snapshot_id)
    control_model = build_control_view_model(snapshot_id, bundle)
    tokens = parse_taxonomy_query(taxonomy)
    year_range = [year_min, year_max] if year_min is not None and year_max is not None else None
    relayout_data = build_relayout_data(x_min=x_min, x_max=x_max, y_min=y_min, y_max=y_max)
    map_model = build_map_view_model(
        snapshot_id=snapshot_id,
        bundle=bundle,
        taxonomy_tokens=tokens,
        year_range=year_range,
        search_text=search,
        relayout_data=relayout_data,
    )
    return {
        "snapshotId": snapshot_id,
        "controls": serialize_control_model(control_model),
        "map": serialize_map_model(map_model),
        "latest": serialize_latest_rows(
            build_latest_rows_frame(
                bundle=bundle,
                taxonomy_tokens=tokens,
                year_range=year_range,
                search_text=search,
            )
        ),
    }


@lru_cache(maxsize=4)
def _engine(snapshot_id: str) -> SimilarityEngine:
    return SimilarityEngine(snapshot_id)


def paper_sheet_payload(snapshot_id: str, doc_id: str) -> dict[str, Any]:
    ensure_snapshot_exists(snapshot_id)
    detail = load_doc_detail(snapshot_id, doc_id)
    if detail is None:
        raise HTTPException(status_code=404, detail=f"Unknown doc_id: {doc_id}")

    similarity_error: str | None = None
    neighbors: list[dict[str, Any]] = []
    try:
        for row in _engine(snapshot_id).query_neighbors(doc_id=doc_id)[:8]:
            neighbor_detail = load_doc_detail(snapshot_id, row["doc_id"]) or {}
            neighbors.append(
                {
                    "doc_id": row["doc_id"],
                    "paper_id": neighbor_detail.get("paper_id", row["doc_id"]),
                    "title": neighbor_detail.get("title", row["doc_id"]),
                    "cosine_similarity": row["cosine_similarity"],
                }
            )
    except Exception as exc:
        similarity_error = str(exc)

    return serialize_paper_sheet(detail=detail, neighbors=neighbors, similarity_error=similarity_error)