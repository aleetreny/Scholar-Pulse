from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from pipelines.common.files import write_json
from pipelines.common.settings import get_settings

DOCUMENT_COLUMNS = [
    "doc_id",
    "paper_id",
    "paper_version_id",
    "title",
    "abstract",
    "submitted_at",
    "year",
    "categories",
]

VECTOR_COLUMNS = ["doc_id", "embedding"]
WEEKLY_PAPER_COLUMNS = [
    "doc_id",
    "paper_id",
    "paper_version_id",
    "title",
    "submitted_at",
    "year",
    "categories",
    "cluster_id",
    "paper_score",
    "recency_score",
    "frontier_cluster_score",
    "novelty_score",
]


@dataclass(frozen=True)
class PublishResult:
    snapshot_id: str
    records_used: int
    clusters: int
    output_dir: Path


def _read_sharded_parquet(directory: Path, pattern: str, columns: list[str]) -> pd.DataFrame:
    shards = sorted(directory.glob(pattern))
    if not shards:
        return pd.DataFrame(columns=columns)

    frames = [pd.read_parquet(path) for path in shards]
    frame = pd.concat(frames, ignore_index=True)

    for column in columns:
        if column not in frame.columns:
            frame[column] = None

    return frame[columns]


def _load_documents(snapshot_id: str, selected_doc_ids: set[str] | None = None) -> pd.DataFrame:
    settings = get_settings()
    export_dir = settings.data_dir / "interim" / "exports" / snapshot_id
    shards = sorted(export_dir.glob("documents_shard_*.parquet"))
    if not shards:
        raise FileNotFoundError(f"No export document shards found in {export_dir}")

    target_ids = {str(value) for value in selected_doc_ids} if selected_doc_ids else None
    remaining_ids = set(target_ids) if target_ids else None

    frames: list[pd.DataFrame] = []
    for path in shards:
        frame = pd.read_parquet(path)
        for column in DOCUMENT_COLUMNS:
            if column not in frame.columns:
                frame[column] = None
        frame = frame[DOCUMENT_COLUMNS]
        frame["doc_id"] = frame["doc_id"].astype(str)

        if remaining_ids is not None:
            frame = frame[frame["doc_id"].isin(remaining_ids)]
            if frame.empty:
                continue
            remaining_ids.difference_update(frame["doc_id"].tolist())

        frames.append(frame)
        if remaining_ids is not None and not remaining_ids:
            break

    if not frames:
        raise RuntimeError(f"No matching export document rows found for snapshot {snapshot_id}")

    documents = pd.concat(frames, ignore_index=True)
    documents = documents.drop_duplicates(subset=["doc_id"], keep="last").copy()
    documents["year"] = pd.to_numeric(documents["year"], errors="coerce").fillna(0).astype(int)
    documents["title"] = documents["title"].fillna("").astype(str)
    documents["abstract"] = documents["abstract"].fillna("").astype(str)
    return documents


def _load_vectors(snapshot_id: str) -> pd.DataFrame:
    settings = get_settings()
    vectors_dir = settings.data_dir / "processed" / "embeddings" / snapshot_id
    vectors = _read_sharded_parquet(vectors_dir, "vectors_shard_*.parquet", VECTOR_COLUMNS)
    if vectors.empty:
        raise FileNotFoundError(f"No embedding shards found in {vectors_dir}")
    return vectors.drop_duplicates(subset=["doc_id"], keep="last").copy()


def _to_matrix(embeddings: pd.Series) -> np.ndarray:
    if embeddings.empty:
        return np.empty((0, 0), dtype=np.float32)
    matrix = np.array(embeddings.tolist(), dtype=np.float32)
    if matrix.ndim != 2:
        raise ValueError("Invalid embedding payload shape")
    return matrix


def _pca_projection(matrix: np.ndarray, dims: int) -> np.ndarray:
    if matrix.shape[0] == 0:
        return np.zeros((0, dims), dtype=np.float32)

    centered = matrix - matrix.mean(axis=0, keepdims=True)
    if centered.shape[0] < 2:
        return np.zeros((centered.shape[0], dims), dtype=np.float32)

    _, _, vt = np.linalg.svd(centered, full_matrices=False)
    components = min(dims, vt.shape[0])
    projected = centered @ vt[:components].T
    if components < dims:
        padding = np.zeros((projected.shape[0], dims - components), dtype=np.float32)
        projected = np.hstack([projected, padding])
    return projected.astype(np.float32)


def _assign_clusters(first_component: np.ndarray, cluster_count: int) -> np.ndarray:
    if first_component.size == 0:
        return np.zeros((0,), dtype=np.int32)
    if cluster_count <= 1:
        return np.zeros((first_component.size,), dtype=np.int32)

    quantiles = np.quantile(first_component, np.linspace(0.0, 1.0, cluster_count + 1))
    boundaries = np.unique(quantiles)
    if boundaries.size <= 2:
        return np.zeros((first_component.size,), dtype=np.int32)
    return np.digitize(first_component, boundaries[1:-1], right=False).astype(np.int32)


def _normalize_metric(series: pd.Series) -> pd.Series:
    min_value = float(series.min())
    max_value = float(series.max())
    spread = max_value - min_value
    if spread <= 0.0:
        return pd.Series(np.zeros(len(series), dtype=np.float32), index=series.index)
    return ((series - min_value) / spread).astype(np.float32)


def _weekly_ranked_papers(
    map_points: pd.DataFrame,
    frontier: pd.DataFrame,
    lookback_days: int = 7,
) -> pd.DataFrame:
    if map_points.empty:
        return pd.DataFrame(columns=WEEKLY_PAPER_COLUMNS)

    frame = map_points.copy()
    frame["submitted_at_ts"] = pd.to_datetime(frame["submitted_at"], utc=True, errors="coerce")
    frame = frame.dropna(subset=["submitted_at_ts"]).copy()
    if frame.empty:
        return pd.DataFrame(columns=WEEKLY_PAPER_COLUMNS)

    latest_ts = frame["submitted_at_ts"].max()
    cutoff = latest_ts - pd.Timedelta(days=max(lookback_days, 1))
    weekly = frame[frame["submitted_at_ts"] >= cutoff].copy()
    if weekly.empty:
        return pd.DataFrame(columns=WEEKLY_PAPER_COLUMNS)

    centroids = (
        frame.groupby("cluster_id", as_index=False)[["x", "y", "z"]]
        .mean()
        .rename(columns={"x": "cx", "y": "cy", "z": "cz"})
    )
    weekly = weekly.merge(centroids, on="cluster_id", how="left")
    weekly["novelty_raw"] = np.sqrt(
        (weekly["x"] - weekly["cx"]) ** 2
        + (weekly["y"] - weekly["cy"]) ** 2
        + (weekly["z"] - weekly["cz"]) ** 2
    )
    weekly["novelty_score"] = _normalize_metric(weekly["novelty_raw"]).astype(np.float32)

    if frontier.empty:
        frontier_by_cluster = pd.Series(dtype=np.float32)
    else:
        frontier_by_cluster = frontier.groupby("cluster_id")["frontier_score"].max()
    weekly["frontier_cluster_score"] = (
        weekly["cluster_id"].map(frontier_by_cluster).fillna(0.0).astype(np.float32)
    )
    weekly["frontier_score_norm"] = _normalize_metric(weekly["frontier_cluster_score"]).astype(np.float32)

    age_days = (latest_ts - weekly["submitted_at_ts"]).dt.total_seconds() / 86400.0
    weekly["recency_score"] = (
        1.0 - (age_days / float(max(lookback_days, 1)))
    ).clip(lower=0.0, upper=1.0)
    weekly["recency_score"] = weekly["recency_score"].astype(np.float32)

    weekly["paper_score"] = (
        0.45 * weekly["frontier_score_norm"]
        + 0.35 * weekly["recency_score"]
        + 0.20 * weekly["novelty_score"]
    ).astype(np.float32)

    weekly["categories"] = weekly["categories"].apply(
        lambda value: sorted(set(value)) if isinstance(value, list) else []
    )
    weekly = weekly.sort_values(["paper_score", "submitted_at_ts"], ascending=[False, False])
    return weekly[WEEKLY_PAPER_COLUMNS].reset_index(drop=True)


def _metrics_and_frontier(
    merged: pd.DataFrame, matrix: np.ndarray
) -> tuple[pd.DataFrame, pd.DataFrame]:
    if merged.empty:
        metric_frame = pd.DataFrame(columns=["cluster_id", "period", "metric_name", "metric_value"])
        frontier_frame = pd.DataFrame(
            columns=[
                "cluster_id",
                "period",
                "paper_count",
                "frontier_score",
                "paper_id",
                "doc_id",
                "title",
            ]
        )
        return metric_frame, frontier_frame

    group_indices = merged.groupby(["cluster_id", "year"], sort=True).indices
    centroids: dict[tuple[str, int], np.ndarray] = {}
    densities: dict[tuple[str, int], int] = {}
    entropies: dict[tuple[str, int], float] = {}

    for key, indexer in group_indices.items():
        vectors = matrix[indexer]
        centroids[key] = vectors.mean(axis=0)
        densities[key] = int(vectors.shape[0])
        entropies[key] = float(np.var(vectors, axis=0).mean())

    year_centroids: dict[int, list[tuple[str, np.ndarray]]] = {}
    for (cluster_id, year), centroid in centroids.items():
        year_centroids.setdefault(year, []).append((cluster_id, centroid))

    infiltration: dict[tuple[str, int], float] = {}
    for (cluster_id, year), indexer in group_indices.items():
        points = matrix[indexer]
        own = centroids[(cluster_id, year)]
        alternatives = [
            value for other_id, value in year_centroids.get(year, []) if other_id != cluster_id
        ]
        if not alternatives:
            infiltration[(cluster_id, year)] = 0.0
            continue

        other_stack = np.stack(alternatives, axis=0)
        own_dist = np.linalg.norm(points - own, axis=1)
        other_dist = np.linalg.norm(points[:, None, :] - other_stack[None, :, :], axis=2).min(
            axis=1
        )
        boundary_margin = (other_dist - own_dist) / (other_dist + 1e-9)
        infiltration[(cluster_id, year)] = float(1.0 - np.clip(boundary_margin.mean(), 0.0, 1.0))

    summary_rows: list[dict[str, Any]] = []
    for cluster_id in sorted(merged["cluster_id"].unique().tolist()):
        cluster_years = sorted(
            year
            for (cid, year) in densities.keys()
            if cid == cluster_id  # noqa: C416 - clearer split form
        )
        prev_density: float | None = None
        prev_momentum: float | None = None
        prev_centroid: np.ndarray | None = None

        for year in cluster_years:
            key = (cluster_id, year)
            density = float(densities[key])
            momentum = 0.0 if prev_density is None else density - prev_density
            acceleration = 0.0 if prev_momentum is None else momentum - prev_momentum
            drift = (
                0.0
                if prev_centroid is None
                else float(np.linalg.norm(centroids[key] - prev_centroid))
            )

            summary_rows.append(
                {
                    "cluster_id": cluster_id,
                    "period": str(year),
                    "year": int(year),
                    "density": density,
                    "momentum": momentum,
                    "acceleration": acceleration,
                    "drift": drift,
                    "semantic_entropy": float(entropies[key]),
                    "infiltration": float(infiltration[key]),
                }
            )

            prev_density = density
            prev_momentum = momentum
            prev_centroid = centroids[key]

    summary = pd.DataFrame(summary_rows)
    summary["momentum_pos"] = summary["momentum"].clip(lower=0.0)
    summary["acceleration_pos"] = summary["acceleration"].clip(lower=0.0)

    summary["momentum_norm"] = _normalize_metric(summary["momentum_pos"])
    summary["acceleration_norm"] = _normalize_metric(summary["acceleration_pos"])
    summary["drift_norm"] = _normalize_metric(summary["drift"])
    summary["entropy_norm"] = _normalize_metric(summary["semantic_entropy"])
    summary["infiltration_norm"] = _normalize_metric(summary["infiltration"])
    summary["frontier_score"] = (
        0.30 * summary["momentum_norm"]
        + 0.20 * summary["acceleration_norm"]
        + 0.20 * summary["drift_norm"]
        + 0.15 * summary["entropy_norm"]
        + 0.15 * summary["infiltration_norm"]
    ).astype(np.float32)

    metrics_rows: list[dict[str, Any]] = []
    for _, row in summary.iterrows():
        for metric_name in (
            "density",
            "momentum",
            "acceleration",
            "drift",
            "semantic_entropy",
            "infiltration",
        ):
            metrics_rows.append(
                {
                    "cluster_id": row["cluster_id"],
                    "period": row["period"],
                    "metric_name": metric_name,
                    "metric_value": float(row[metric_name]),
                }
            )

    representative_rows: list[dict[str, Any]] = []
    for _, row in summary.iterrows():
        cluster_id = str(row["cluster_id"])
        year = int(row["year"])
        subset = merged[(merged["cluster_id"] == cluster_id) & (merged["year"] == year)]
        if subset.empty:
            continue
        representative = subset.iloc[0]
        representative_rows.append(
            {
                "cluster_id": cluster_id,
                "period": str(year),
                "paper_count": int(len(subset)),
                "frontier_score": float(row["frontier_score"]),
                "paper_id": str(representative["paper_id"]),
                "doc_id": str(representative["doc_id"]),
                "title": str(representative["title"]),
            }
        )

    metrics_frame = pd.DataFrame(metrics_rows).sort_values(["period", "cluster_id", "metric_name"])
    frontier_frame = pd.DataFrame(representative_rows).sort_values(
        ["frontier_score", "period"], ascending=[False, False]
    )
    return metrics_frame, frontier_frame


def build_dashboard_feeds(
    snapshot_id: str,
    cluster_count: int = 12,
    max_docs: int = 120_000,
    seed: int = 42,
) -> PublishResult:
    settings = get_settings()
    vectors = _load_vectors(snapshot_id=snapshot_id)

    vectors = vectors.sort_values("doc_id").reset_index(drop=True)

    # Sample vectors first to avoid a full 1M+ row join on local CPU.
    if max_docs > 0 and len(vectors) > max_docs:
        vectors = (
            vectors.sample(n=max_docs, random_state=seed)
            .sort_values("doc_id")
            .reset_index(drop=True)
        )

    selected_doc_ids = set(vectors["doc_id"].astype(str).tolist())
    documents = _load_documents(snapshot_id=snapshot_id, selected_doc_ids=selected_doc_ids)

    merged = (
        documents.merge(vectors, on="doc_id", how="inner").sort_values("doc_id").reset_index(drop=True)
    )
    if merged.empty:
        raise RuntimeError("No overlapping records between selected documents and vectors")

    matrix = _to_matrix(merged["embedding"])
    coords_3d = _pca_projection(matrix, dims=3)
    clusters = _assign_clusters(coords_3d[:, 0], cluster_count=max(cluster_count, 1))

    map_points = merged[DOCUMENT_COLUMNS].copy()
    map_points["cluster_id"] = [f"c{value:02d}" for value in clusters.tolist()]
    map_points["x"] = coords_3d[:, 0].astype(np.float32)
    map_points["y"] = coords_3d[:, 1].astype(np.float32)
    map_points["z"] = coords_3d[:, 2].astype(np.float32)
    map_points["categories"] = map_points["categories"].apply(
        lambda value: sorted(set(value)) if isinstance(value, list) else []
    )

    metrics, frontier = _metrics_and_frontier(merged=map_points, matrix=matrix)
    weekly_new_papers = _weekly_ranked_papers(
        map_points=map_points,
        frontier=frontier,
        lookback_days=7,
    )

    output_dir = settings.data_dir / "processed" / "publish" / snapshot_id / "dashboard_feeds"
    output_dir.mkdir(parents=True, exist_ok=True)
    map_points.to_parquet(output_dir / "map_points.parquet", index=False)
    metrics.to_parquet(output_dir / "metrics.parquet", index=False)
    frontier.to_parquet(output_dir / "frontier_candidates.parquet", index=False)
    weekly_new_papers.to_parquet(output_dir / "weekly_new_papers.parquet", index=False)

    write_json(
        output_dir / "build_manifest.json",
        {
            "snapshot_id": snapshot_id,
            "records_used": int(len(map_points)),
            "clusters": int(map_points["cluster_id"].nunique()),
            "cluster_count_requested": int(cluster_count),
            "max_docs": int(max_docs),
            "seed": int(seed),
            "weekly_candidates": int(len(weekly_new_papers)),
            "weekly_lookback_days": 7,
        },
    )

    return PublishResult(
        snapshot_id=snapshot_id,
        records_used=int(len(map_points)),
        clusters=int(map_points["cluster_id"].nunique()),
        output_dir=output_dir,
    )


def parse_args() -> argparse.Namespace:
    settings = get_settings()
    parser = argparse.ArgumentParser(description="Build dashboard publish feeds from embeddings")
    parser.add_argument("--snapshot-id", required=True)
    parser.add_argument("--cluster-count", type=int, default=12)
    parser.add_argument("--max-docs", type=int, default=120000)
    parser.add_argument("--seed", type=int, default=settings.random_seed)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    result = build_dashboard_feeds(
        snapshot_id=args.snapshot_id,
        cluster_count=max(args.cluster_count, 1),
        max_docs=max(args.max_docs, 0),
        seed=args.seed,
    )
    print(
        f"Dashboard feeds created snapshot_id={result.snapshot_id} records={result.records_used} "
        f"clusters={result.clusters} output={result.output_dir}"
    )


if __name__ == "__main__":
    main()
