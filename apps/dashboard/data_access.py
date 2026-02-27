from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pandas as pd

from pipelines.common.settings import get_settings

FEEDS_DIRNAME = "dashboard_feeds"
MAX_POINTS = 60000

MAP_COLUMNS = [
    "doc_id",
    "paper_id",
    "paper_version_id",
    "title",
    "abstract",
    "year",
    "categories",
    "cluster_id",
    "x",
    "y",
    "z",
]
METRIC_COLUMNS = ["cluster_id", "period", "metric_name", "metric_value"]
FRONTIER_COLUMNS = [
    "cluster_id",
    "period",
    "paper_count",
    "frontier_score",
    "paper_id",
    "doc_id",
    "title",
]


@dataclass(frozen=True)
class DashboardBundle:
    snapshot_id: str
    map_points: pd.DataFrame
    metrics: pd.DataFrame
    frontier: pd.DataFrame


def _publish_root() -> Path:
    return get_settings().data_dir / "processed" / "publish"


def _interim_exports_root() -> Path:
    return get_settings().data_dir / "interim" / "exports"


def available_snapshots() -> list[str]:
    candidates: set[str] = set()
    data_root = _publish_root()
    interim_root = _interim_exports_root()

    if data_root.exists():
        for path in data_root.iterdir():
            if path.is_dir():
                candidates.add(path.name)

    if interim_root.exists():
        for path in interim_root.iterdir():
            if path.is_dir():
                candidates.add(path.name)

    return sorted(candidates, reverse=True)


def _feeds_dir(snapshot_id: str) -> Path:
    return _publish_root() / snapshot_id / FEEDS_DIRNAME


def _read_first_existing(
    snapshot_id: str, candidates: list[str], required_columns: list[str]
) -> pd.DataFrame:
    base = _feeds_dir(snapshot_id)
    for name in candidates:
        path = base / name
        if path.exists():
            frame = pd.read_parquet(path)
            for column in required_columns:
                if column not in frame.columns:
                    frame[column] = None
            return frame[required_columns]

    return pd.DataFrame(columns=required_columns)


def _normalize_categories(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return []
        if text.startswith("[") and text.endswith("]"):
            try:
                parsed = json.loads(text)
                if isinstance(parsed, list):
                    return [str(item).strip() for item in parsed if str(item).strip()]
            except json.JSONDecodeError:
                pass
        return [item.strip() for item in text.replace(";", ",").split(",") if item.strip()]
    return []


def _normalize_map(frame: pd.DataFrame) -> pd.DataFrame:
    normalized = frame.copy()

    aliases = {
        "cluster": "cluster_id",
        "cluster_label": "cluster_id",
        "umap_x": "x",
        "umap_y": "y",
        "umap_z": "z",
        "component_1": "x",
        "component_2": "y",
        "component_3": "z",
    }
    for old_name, new_name in aliases.items():
        if old_name in normalized.columns and new_name not in normalized.columns:
            normalized[new_name] = normalized[old_name]

    for column in MAP_COLUMNS:
        if column not in normalized.columns:
            normalized[column] = None

    normalized["title"] = normalized["title"].fillna("").astype(str)
    normalized["abstract"] = normalized["abstract"].fillna("").astype(str)
    normalized["paper_id"] = normalized["paper_id"].fillna("").astype(str)
    normalized["cluster_id"] = normalized["cluster_id"].fillna("unassigned").astype(str)
    normalized["year"] = pd.to_numeric(normalized["year"], errors="coerce").fillna(0).astype(int)
    normalized["x"] = pd.to_numeric(normalized["x"], errors="coerce").fillna(0.0).astype(float)
    normalized["y"] = pd.to_numeric(normalized["y"], errors="coerce").fillna(0.0).astype(float)
    normalized["z"] = pd.to_numeric(normalized["z"], errors="coerce").fillna(0.0).astype(float)
    normalized["categories"] = normalized["categories"].apply(_normalize_categories)

    if len(normalized) > MAX_POINTS:
        normalized = (
            normalized.sample(n=MAX_POINTS, random_state=42)
            .sort_values("doc_id")
            .reset_index(drop=True)
        )

    return normalized[MAP_COLUMNS]


def _normalize_metrics(frame: pd.DataFrame) -> pd.DataFrame:
    normalized = frame.copy()
    aliases = {
        "year": "period",
        "metric": "metric_name",
        "value": "metric_value",
        "cluster": "cluster_id",
    }
    for old_name, new_name in aliases.items():
        if old_name in normalized.columns and new_name not in normalized.columns:
            normalized[new_name] = normalized[old_name]

    for column in METRIC_COLUMNS:
        if column not in normalized.columns:
            normalized[column] = None

    normalized["cluster_id"] = normalized["cluster_id"].fillna("unassigned").astype(str)
    normalized["period"] = normalized["period"].fillna("").astype(str)
    normalized["metric_name"] = normalized["metric_name"].fillna("").astype(str)
    normalized["metric_value"] = (
        pd.to_numeric(normalized["metric_value"], errors="coerce").fillna(0.0).astype(float)
    )
    return normalized[METRIC_COLUMNS]


def _normalize_frontier(frame: pd.DataFrame) -> pd.DataFrame:
    normalized = frame.copy()
    aliases = {"cluster": "cluster_id", "year": "period", "score": "frontier_score"}
    for old_name, new_name in aliases.items():
        if old_name in normalized.columns and new_name not in normalized.columns:
            normalized[new_name] = normalized[old_name]

    for column in FRONTIER_COLUMNS:
        if column not in normalized.columns:
            normalized[column] = None

    normalized["cluster_id"] = normalized["cluster_id"].fillna("unassigned").astype(str)
    normalized["period"] = normalized["period"].fillna("").astype(str)
    normalized["paper_count"] = (
        pd.to_numeric(normalized["paper_count"], errors="coerce").fillna(0).astype(int)
    )
    normalized["frontier_score"] = (
        pd.to_numeric(normalized["frontier_score"], errors="coerce").fillna(0.0).astype(float)
    )
    normalized["paper_id"] = normalized["paper_id"].fillna("").astype(str)
    normalized["doc_id"] = normalized["doc_id"].fillna("").astype(str)
    normalized["title"] = normalized["title"].fillna("").astype(str)
    return normalized[FRONTIER_COLUMNS]


def load_bundle(snapshot_id: str) -> DashboardBundle:
    map_frame = _read_first_existing(
        snapshot_id=snapshot_id,
        candidates=["map_points.parquet", "cluster_assignments.parquet", "embeddings_2d.parquet"],
        required_columns=MAP_COLUMNS,
    )
    metrics_frame = _read_first_existing(
        snapshot_id=snapshot_id,
        candidates=["metrics.parquet", "metrics_time_series.parquet"],
        required_columns=METRIC_COLUMNS,
    )
    frontier_frame = _read_first_existing(
        snapshot_id=snapshot_id,
        candidates=["frontier_candidates.parquet", "frontier.parquet"],
        required_columns=FRONTIER_COLUMNS,
    )

    return DashboardBundle(
        snapshot_id=snapshot_id,
        map_points=_normalize_map(map_frame),
        metrics=_normalize_metrics(metrics_frame),
        frontier=_normalize_frontier(frontier_frame),
    )
