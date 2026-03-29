from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from apps.dashboard.taxonomy import normalize_category_tokens, taxonomy_match
from pipelines.common.settings import get_settings

FEEDS_DIRNAME = "dashboard_feeds"

MAP_SAMPLE_COLUMNS = [
    "doc_id",
    "paper_id",
    "paper_version_id",
    "title",
    "abstract_preview",
    "submitted_at",
    "year",
    "categories",
    "x",
    "y",
]

MAP_DENSITY_COLUMNS = ["bin_x", "bin_y", "doc_count", "x_center", "y_center"]

MAP_DETAIL_COLUMNS = [
    "doc_id",
    "paper_id",
    "paper_version_id",
    "title",
    "abstract_preview",
    "submitted_at",
    "year",
    "categories",
    "x",
    "y",
    "bin_x",
    "bin_y",
]

LATEST_COLUMNS = [
    "doc_id",
    "paper_id",
    "paper_version_id",
    "title",
    "submitted_at",
    "year",
    "categories",
    "recency_score",
    "novelty_score",
    "score",
]

LEGACY_MAP_COLUMNS = [
    "doc_id",
    "paper_id",
    "paper_version_id",
    "title",
    "abstract",
    "submitted_at",
    "year",
    "categories",
    "x",
    "y",
]


@dataclass(frozen=True)
class DashboardBundle:
    snapshot_id: str
    map_density: pd.DataFrame
    map_points_sample: pd.DataFrame
    latest_papers: pd.DataFrame
    build_manifest: dict[str, Any]


def _publish_root() -> Path:
    return get_settings().data_dir / "processed" / "publish"


def available_snapshots() -> list[str]:
    root = _publish_root()
    if not root.exists():
        return []
    return sorted([path.name for path in root.iterdir() if path.is_dir()], reverse=True)


def _feeds_dir(snapshot_id: str) -> Path:
    return _publish_root() / snapshot_id / FEEDS_DIRNAME


def _normalize_categories(value: Any) -> list[str]:
    return normalize_category_tokens(value)


def _read_frame(path: Path, required_columns: list[str]) -> pd.DataFrame:
    if not path.exists():
        return pd.DataFrame(columns=required_columns)
    frame = pd.read_parquet(path)
    for column in required_columns:
        if column not in frame.columns:
            frame[column] = None
    return frame[required_columns]


def _build_density_from_points(frame: pd.DataFrame, bins: int = 120) -> pd.DataFrame:
    if frame.empty:
        return pd.DataFrame(columns=MAP_DENSITY_COLUMNS)

    work = frame[["x", "y"]].copy()
    x = pd.to_numeric(work["x"], errors="coerce").fillna(0.0).to_numpy(dtype=float)
    y = pd.to_numeric(work["y"], errors="coerce").fillna(0.0).to_numpy(dtype=float)

    x_min, x_max = float(np.min(x)), float(np.max(x))
    y_min, y_max = float(np.min(y)), float(np.max(y))
    if x_max <= x_min:
        x_max = x_min + 1e-6
    if y_max <= y_min:
        y_max = y_min + 1e-6

    x_edges = np.linspace(x_min, x_max, num=bins + 1, dtype=np.float32)
    y_edges = np.linspace(y_min, y_max, num=bins + 1, dtype=np.float32)
    x_bin = np.clip(np.searchsorted(x_edges, x, side="right") - 1, 0, bins - 1)
    y_bin = np.clip(np.searchsorted(y_edges, y, side="right") - 1, 0, bins - 1)

    grouped = (
        pd.DataFrame({"bin_x": x_bin.astype(int), "bin_y": y_bin.astype(int)})
        .value_counts()
        .reset_index(name="doc_count")
    )
    grouped["x_center"] = grouped["bin_x"].apply(
        lambda value: float((x_edges[int(value)] + x_edges[int(value) + 1]) * 0.5)
    )
    grouped["y_center"] = grouped["bin_y"].apply(
        lambda value: float((y_edges[int(value)] + y_edges[int(value) + 1]) * 0.5)
    )
    return grouped[MAP_DENSITY_COLUMNS]


def _resolve_detail_path(feeds_dir: Path) -> Path | None:
    detail = feeds_dir / "map_points_detail_index.parquet"
    if detail.exists():
        return detail
    legacy = feeds_dir / "map_points.parquet"
    if legacy.exists():
        return legacy
    return None


def _synthetic_sample_points(size: int = 3000) -> pd.DataFrame:
    rng = np.random.default_rng(42)
    fields = [
        ("cs.AI", 20.0, 20.0),
        ("stat.ML", -18.0, 14.0),
        ("physics.comp-ph", 11.0, -22.0),
        ("cs.LG", -12.0, -18.0),
        ("cs.CV", 2.0, 1.0),
    ]
    rows: list[dict[str, Any]] = []
    for idx in range(size):
        field, cx, cy = fields[idx % len(fields)]
        year = int(rng.integers(2010, 2027))
        x = float(rng.normal(cx, 7.5))
        y = float(rng.normal(cy, 7.5))
        rows.append(
            {
                "doc_id": f"synthetic-{idx:06d}",
                "paper_id": f"synthetic-{idx:06d}",
                "paper_version_id": f"synthetic-{idx:06d}v1",
                "title": f"Synthetic Paper {idx}",
                "abstract_preview": "Synthetic fallback record generated because no publish feeds were found.",
                "submitted_at": f"{year}-01-01T00:00:00+00:00",
                "year": year,
                "categories": [field],
                "x": x,
                "y": y,
            }
        )
    return pd.DataFrame(rows)[MAP_SAMPLE_COLUMNS]


def _synthetic_latest(sample: pd.DataFrame, limit: int = 120) -> pd.DataFrame:
    if sample.empty:
        return pd.DataFrame(columns=LATEST_COLUMNS)
    latest = sample.sort_values(["year", "doc_id"], ascending=[False, True]).head(limit).copy()
    latest["recency_score"] = np.linspace(1.0, 0.2, num=len(latest), dtype=float)
    latest["novelty_score"] = np.linspace(0.8, 0.2, num=len(latest), dtype=float)
    latest["score"] = 0.6 * latest["recency_score"] + 0.4 * latest["novelty_score"]
    return latest[
        [
            "doc_id",
            "paper_id",
            "paper_version_id",
            "title",
            "submitted_at",
            "year",
            "categories",
            "recency_score",
            "novelty_score",
            "score",
        ]
    ].reset_index(drop=True)


@lru_cache(maxsize=8)
def load_bundle(snapshot_id: str) -> DashboardBundle:
    feeds_dir = _feeds_dir(snapshot_id)
    density = _read_frame(feeds_dir / "map_density.parquet", MAP_DENSITY_COLUMNS)
    sample = _read_frame(feeds_dir / "map_points_sample.parquet", MAP_SAMPLE_COLUMNS)
    latest = _read_frame(feeds_dir / "latest_papers.parquet", LATEST_COLUMNS)

    if sample.empty:
        legacy_map = _read_frame(feeds_dir / "map_points.parquet", LEGACY_MAP_COLUMNS)
        if not legacy_map.empty:
            legacy_map["abstract_preview"] = legacy_map["abstract"].fillna("").astype(str).str.slice(0, 480)
            sample = legacy_map[
                [
                    "doc_id",
                    "paper_id",
                    "paper_version_id",
                    "title",
                    "abstract_preview",
                    "submitted_at",
                    "year",
                    "categories",
                    "x",
                    "y",
                ]
            ].copy()

    if latest.empty:
        legacy_latest = pd.DataFrame()
        legacy_weekly = feeds_dir / "weekly_new_papers.parquet"
        if legacy_weekly.exists():
            legacy_latest = pd.read_parquet(legacy_weekly)
            if "paper_score" in legacy_latest.columns and "score" not in legacy_latest.columns:
                legacy_latest["score"] = legacy_latest["paper_score"]
            for column in ("recency_score", "novelty_score"):
                if column not in legacy_latest.columns:
                    legacy_latest[column] = 0.0
            for column in LATEST_COLUMNS:
                if column not in legacy_latest.columns:
                    legacy_latest[column] = None
            latest = legacy_latest[LATEST_COLUMNS].copy()

    if not sample.empty:
        sample["doc_id"] = sample["doc_id"].astype(str)
        sample["paper_id"] = sample["paper_id"].astype(str)
        sample["paper_version_id"] = sample["paper_version_id"].astype(str)
        sample["title"] = sample["title"].fillna("").astype(str)
        sample["abstract_preview"] = sample["abstract_preview"].fillna("").astype(str)
        sample["submitted_at"] = sample["submitted_at"].fillna("").astype(str)
        sample["year"] = pd.to_numeric(sample["year"], errors="coerce").fillna(0).astype(int)
        sample["categories"] = sample["categories"].apply(_normalize_categories)
        sample["x"] = pd.to_numeric(sample["x"], errors="coerce").fillna(0.0).astype(float)
        sample["y"] = pd.to_numeric(sample["y"], errors="coerce").fillna(0.0).astype(float)

    if not density.empty:
        density["bin_x"] = pd.to_numeric(density["bin_x"], errors="coerce").fillna(0).astype(int)
        density["bin_y"] = pd.to_numeric(density["bin_y"], errors="coerce").fillna(0).astype(int)
        density["doc_count"] = pd.to_numeric(density["doc_count"], errors="coerce").fillna(0).astype(int)
        density["x_center"] = pd.to_numeric(density["x_center"], errors="coerce").fillna(0.0).astype(float)
        density["y_center"] = pd.to_numeric(density["y_center"], errors="coerce").fillna(0.0).astype(float)
    elif not sample.empty:
        density = _build_density_from_points(sample, bins=120)

    if not latest.empty:
        latest["doc_id"] = latest["doc_id"].astype(str)
        latest["paper_id"] = latest["paper_id"].astype(str)
        latest["paper_version_id"] = latest["paper_version_id"].astype(str)
        latest["title"] = latest["title"].fillna("").astype(str)
        latest["submitted_at"] = latest["submitted_at"].fillna("").astype(str)
        latest["year"] = pd.to_numeric(latest["year"], errors="coerce").fillna(0).astype(int)
        latest["categories"] = latest["categories"].apply(_normalize_categories)
        latest["score"] = pd.to_numeric(latest["score"], errors="coerce").fillna(0.0).astype(float)
        latest["recency_score"] = (
            pd.to_numeric(latest["recency_score"], errors="coerce").fillna(0.0).astype(float)
        )
        latest["novelty_score"] = (
            pd.to_numeric(latest["novelty_score"], errors="coerce").fillna(0.0).astype(float)
        )
    elif sample.empty:
        sample = _synthetic_sample_points()
        density = _build_density_from_points(sample, bins=100)
        latest = _synthetic_latest(sample, limit=120)

    manifest_path = feeds_dir / "build_manifest.json"
    build_manifest: dict[str, Any] = {}
    if manifest_path.exists():
        build_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if build_manifest.get("profile") is None and sample["doc_id"].astype(str).str.startswith("synthetic-").all():
        build_manifest["profile"] = "synthetic_fallback"
    existing_counts = build_manifest.get("counts", {}) if isinstance(build_manifest.get("counts"), dict) else {}
    build_manifest["counts"] = {
        "map_density": int(existing_counts.get("map_density", len(density))),
        "map_points_sample": int(existing_counts.get("map_points_sample", len(sample))),
        "map_points_detail_index": int(existing_counts.get("map_points_detail_index", len(sample))),
        "latest_papers": int(existing_counts.get("latest_papers", len(latest))),
    }

    return DashboardBundle(
        snapshot_id=snapshot_id,
        map_density=density,
        map_points_sample=sample,
        latest_papers=latest,
        build_manifest=build_manifest,
    )


def _taxonomy_match(categories: list[str], tokens: list[str]) -> bool:
    return taxonomy_match(categories, tokens)


def query_map_detail(
    *,
    snapshot_id: str,
    x_range: tuple[float, float],
    y_range: tuple[float, float],
    year_range: tuple[int, int],
    taxonomy_tokens: list[str],
    limit: int,
) -> pd.DataFrame:
    settings = get_settings()
    feeds_dir = _feeds_dir(snapshot_id)
    detail_path = _resolve_detail_path(feeds_dir)
    if detail_path is None:
        return pd.DataFrame(columns=MAP_DETAIL_COLUMNS)

    try:
        import duckdb  # type: ignore[import-not-found]

        query = """
        SELECT doc_id, paper_id, paper_version_id, title, abstract_preview,
               submitted_at, year, categories, x, y, bin_x, bin_y
        FROM read_parquet(?)
        WHERE x BETWEEN ? AND ?
          AND y BETWEEN ? AND ?
          AND year BETWEEN ? AND ?
        LIMIT ?
        """
        connection = duckdb.connect()
        frame = connection.execute(
            query,
            [
                str(detail_path),
                float(min(x_range)),
                float(max(x_range)),
                float(min(y_range)),
                float(max(y_range)),
                int(min(year_range)),
                int(max(year_range)),
                int(max(limit, 1)),
            ],
        ).fetch_df()
        connection.close()
    except Exception:
        frame = pd.read_parquet(detail_path)
        frame = frame[
            (frame["x"] >= float(min(x_range)))
            & (frame["x"] <= float(max(x_range)))
            & (frame["y"] >= float(min(y_range)))
            & (frame["y"] <= float(max(y_range)))
            & (frame["year"] >= int(min(year_range)))
            & (frame["year"] <= int(max(year_range)))
        ].head(max(limit, 1))

    for column in MAP_DETAIL_COLUMNS:
        if column not in frame.columns:
            frame[column] = None
    if "abstract_preview" in frame.columns and frame["abstract_preview"].isna().all() and "abstract" in frame.columns:
        frame["abstract_preview"] = frame["abstract"].fillna("").astype(str).str.slice(0, 480)

    frame = frame[MAP_DETAIL_COLUMNS]
    frame["doc_id"] = frame["doc_id"].astype(str)
    frame["paper_id"] = frame["paper_id"].astype(str)
    frame["paper_version_id"] = frame["paper_version_id"].astype(str)
    frame["title"] = frame["title"].fillna("").astype(str)
    frame["abstract_preview"] = frame["abstract_preview"].fillna("").astype(str)
    frame["submitted_at"] = frame["submitted_at"].fillna("").astype(str)
    frame["year"] = pd.to_numeric(frame["year"], errors="coerce").fillna(0).astype(int)
    frame["x"] = pd.to_numeric(frame["x"], errors="coerce").fillna(0.0).astype(float)
    frame["y"] = pd.to_numeric(frame["y"], errors="coerce").fillna(0.0).astype(float)
    frame["categories"] = frame["categories"].apply(_normalize_categories)

    if taxonomy_tokens:
        frame = frame[frame["categories"].apply(lambda cats: _taxonomy_match(cats, taxonomy_tokens))]

    cap = max(settings.map_viewport_cap, 1000)
    if len(frame) > cap:
        frame = frame.head(cap)

    return frame.reset_index(drop=True)


def load_doc_detail(snapshot_id: str, doc_id: str) -> dict[str, Any] | None:
    feeds_dir = _feeds_dir(snapshot_id)
    detail_path = _resolve_detail_path(feeds_dir)
    if detail_path is None:
        return None

    row: pd.Series | None = None
    try:
        import duckdb  # type: ignore[import-not-found]

        connection = duckdb.connect()
        frame = connection.execute(
            """
            SELECT doc_id, paper_id, paper_version_id, title, abstract_preview,
                   submitted_at, year, categories
            FROM read_parquet(?)
            WHERE doc_id = ?
            LIMIT 1
            """,
            [str(detail_path), str(doc_id)],
        ).fetch_df()
        connection.close()
        if not frame.empty:
            row = frame.iloc[0]
    except Exception:
        frame = pd.read_parquet(detail_path)
        match = frame[frame["doc_id"].astype(str) == str(doc_id)]
        if not match.empty:
            row = match.iloc[0]

    if row is None:
        return None

    return {
        "doc_id": str(row["doc_id"]),
        "paper_id": str(row["paper_id"]),
        "paper_version_id": str(row["paper_version_id"]),
        "title": str(row["title"]),
        "abstract_preview": str(row["abstract_preview"]),
        "submitted_at": str(row["submitted_at"]),
        "year": int(row["year"]),
        "categories": _normalize_categories(row["categories"]),
    }
