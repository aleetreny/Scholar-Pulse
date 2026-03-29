from __future__ import annotations

import argparse
import hashlib
import heapq
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

from pipelines.common.files import write_json
from pipelines.common.logging_utils import configure_logging
from pipelines.common.settings import get_settings

DETAIL_COLUMNS = [
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

SAMPLE_COLUMNS = [
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


@dataclass(frozen=True)
class SpaceBuildResult:
    snapshot_id: str
    output_dir: Path
    total_docs: int
    sample_docs: int
    density_bins: int


def _normalize_categories(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    text = str(value).strip()
    if not text:
        return []
    return [item.strip() for item in text.replace(";", ",").split(",") if item.strip()]


def _stable_hash64(text: str) -> int:
    return int(hashlib.sha1(text.encode("utf-8")).hexdigest()[:16], 16)


def _load_joined_shard(vectors_path: Path, exports_dir: Path) -> pd.DataFrame:
    docs_name = vectors_path.name.replace("vectors_", "documents_")
    docs_path = exports_dir / docs_name
    if not docs_path.exists():
        raise FileNotFoundError(f"Missing document shard for {vectors_path.name}: {docs_path}")

    docs = pd.read_parquet(
        docs_path,
        columns=[
            "doc_id",
            "paper_id",
            "paper_version_id",
            "title",
            "abstract",
            "submitted_at",
            "year",
            "categories",
        ],
    )
    vectors = pd.read_parquet(vectors_path)
    frame = docs.merge(vectors, on="doc_id", how="inner")

    if frame.empty:
        return frame

    frame["doc_id"] = frame["doc_id"].astype(str)
    frame["paper_id"] = frame["paper_id"].astype(str)
    frame["paper_version_id"] = frame["paper_version_id"].astype(str)
    frame["title"] = frame["title"].fillna("").astype(str)
    frame["abstract"] = frame["abstract"].fillna("").astype(str)
    frame["abstract_preview"] = frame["abstract"].str.slice(0, 480)
    frame["submitted_at"] = frame["submitted_at"].fillna("").astype(str)
    frame["year"] = pd.to_numeric(frame["year"], errors="coerce").fillna(0).astype(int)
    frame["categories"] = frame["categories"].apply(_normalize_categories)
    return frame


def _collect_sample(
    *,
    vectors_dir: Path,
    exports_dir: Path,
    sample_points: int,
) -> tuple[list[dict[str, Any]], np.ndarray, int]:
    heap: list[tuple[int, int, dict[str, Any], np.ndarray]] = []
    counter = 0
    total_docs = 0
    shards = sorted(vectors_dir.glob("vectors_shard_*.parquet"))

    for shard_idx, vectors_path in enumerate(shards, start=1):
        frame = _load_joined_shard(vectors_path=vectors_path, exports_dir=exports_dir)
        if frame.empty:
            continue

        embeddings = np.array(frame["embedding"].tolist(), dtype=np.float32)
        doc_ids = frame["doc_id"].tolist()
        paper_ids = frame["paper_id"].tolist()
        version_ids = frame["paper_version_id"].tolist()
        titles = frame["title"].tolist()
        previews = frame["abstract_preview"].tolist()
        submitted = frame["submitted_at"].tolist()
        years = frame["year"].tolist()
        categories = frame["categories"].tolist()

        for idx, doc_id in enumerate(doc_ids):
            total_docs += 1
            hash_value = _stable_hash64(doc_id)
            meta = {
                "doc_id": doc_id,
                "paper_id": paper_ids[idx],
                "paper_version_id": version_ids[idx],
                "title": titles[idx],
                "abstract_preview": previews[idx],
                "submitted_at": submitted[idx],
                "year": int(years[idx]),
                "categories": categories[idx],
            }
            vector = embeddings[idx]

            if len(heap) < sample_points:
                heapq.heappush(heap, (-hash_value, counter, meta, vector))
            elif hash_value < -heap[0][0]:
                heapq.heapreplace(heap, (-hash_value, counter, meta, vector))
            counter += 1

        if shard_idx % 25 == 0 or shard_idx == len(shards):
            print(
                f"[space] sample collection shard={shard_idx}/{len(shards)} docs_seen={total_docs}",
                flush=True,
            )

    if not heap:
        return [], np.empty((0, 0), dtype=np.float32), total_docs

    ordered = sorted(((-item[0], item[2], item[3]) for item in heap), key=lambda value: value[0])
    metas = [value[1] for value in ordered]
    matrix = np.vstack([value[2] for value in ordered]).astype(np.float32)
    return metas, matrix, total_docs


def _fit_projection(
    sample_matrix: np.ndarray,
    seed: int,
    neighbors: int,
    min_dist: float,
) -> tuple[Any, Any | None, np.ndarray]:
    try:
        from sklearn.decomposition import PCA
    except ImportError as exc:
        raise RuntimeError("Install analytics dependencies: pip install -e '.[analytics]'") from exc

    if sample_matrix.size == 0:
        raise RuntimeError("No vectors available to build space projection")

    rows, cols = sample_matrix.shape
    if rows < 2:
        pca_components = 1
    else:
        pca_components = min(50, cols, rows - 1)

    pca = PCA(n_components=pca_components, random_state=seed, svd_solver="randomized")
    sample_pca = pca.fit_transform(sample_matrix)

    if rows < 3:
        coords = np.zeros((rows, 2), dtype=np.float32)
        coords[:, : min(sample_pca.shape[1], 2)] = sample_pca[:, :2]
        return pca, None, coords

    try:
        import umap  # type: ignore[import-not-found]
    except ImportError:
        coords = np.zeros((rows, 2), dtype=np.float32)
        coords[:, : min(sample_pca.shape[1], 2)] = sample_pca[:, :2]
        return pca, None, coords

    neighbor_count = max(2, min(neighbors, rows - 1))
    reducer = umap.UMAP(
        n_components=2,
        metric="cosine",
        n_neighbors=neighbor_count,
        min_dist=min_dist,
        random_state=seed,
        transform_seed=seed,
    )
    coords = reducer.fit_transform(sample_pca)
    return pca, reducer, coords.astype(np.float32)


def _edges(values: np.ndarray, bins: int) -> np.ndarray:
    low, high = np.quantile(values, [0.005, 0.995]).tolist()
    if not np.isfinite(low):
        low = float(values.min())
    if not np.isfinite(high):
        high = float(values.max())
    if high <= low:
        high = low + 1e-6
    margin = (high - low) * 0.03
    return np.linspace(low - margin, high + margin, num=bins + 1, dtype=np.float32)


def _assign_bins(values: np.ndarray, edges: np.ndarray) -> np.ndarray:
    bins = len(edges) - 1
    indexes = np.searchsorted(edges, values, side="right") - 1
    return np.clip(indexes, 0, bins - 1).astype(np.int16)


def build_space(
    *,
    snapshot_id: str,
    projection: str,
    sample_points: int,
    density_bins: int,
) -> SpaceBuildResult:
    if projection != "pca_umap":
        raise ValueError(f"Unsupported projection '{projection}'. Use 'pca_umap'.")

    settings = get_settings()
    vectors_dir = settings.data_dir / "processed" / "embeddings" / snapshot_id
    exports_dir = settings.data_dir / "interim" / "exports" / snapshot_id
    if not vectors_dir.exists():
        raise FileNotFoundError(f"Embedding snapshot not found: {vectors_dir}")
    if not exports_dir.exists():
        raise FileNotFoundError(f"Export snapshot not found: {exports_dir}")

    output_dir = settings.data_dir / "processed" / "space" / snapshot_id
    output_dir.mkdir(parents=True, exist_ok=True)

    t0 = time.time()
    print(
        f"[space] start snapshot={snapshot_id} projection={projection} sample_points={sample_points} density_bins={density_bins}",
        flush=True,
    )
    sample_metas, sample_matrix, total_docs = _collect_sample(
        vectors_dir=vectors_dir,
        exports_dir=exports_dir,
        sample_points=max(sample_points, 1),
    )
    if sample_matrix.size == 0:
        raise RuntimeError(f"No embeddings/documents found for snapshot {snapshot_id}")

    pca, reducer, sample_coords = _fit_projection(
        sample_matrix=sample_matrix,
        seed=settings.random_seed,
        neighbors=settings.map_umap_neighbors,
        min_dist=settings.map_umap_min_dist,
    )

    try:
        import joblib
    except ImportError as exc:
        raise RuntimeError("Install analytics dependencies: pip install -e '.[analytics]'") from exc

    pca_path = output_dir / "pca_model.joblib"
    joblib.dump(pca, pca_path)

    umap_path = output_dir / "umap_model.joblib"
    if reducer is not None:
        joblib.dump(reducer, umap_path)

    x_edges = _edges(sample_coords[:, 0], bins=max(density_bins, 8))
    y_edges = _edges(sample_coords[:, 1], bins=max(density_bins, 8))

    sample_frame = pd.DataFrame(sample_metas)
    sample_frame["x"] = sample_coords[:, 0].astype(np.float32)
    sample_frame["y"] = sample_coords[:, 1].astype(np.float32)
    sample_frame = sample_frame[SAMPLE_COLUMNS]
    sample_frame.to_parquet(output_dir / "map_points_sample.parquet", index=False)
    print(
        f"[space] sample ready rows={len(sample_frame)} total_docs={total_docs}",
        flush=True,
    )

    bins = len(x_edges) - 1
    density_counts = np.zeros((bins, bins), dtype=np.int64)
    detail_path = output_dir / "map_points_detail_index.parquet"
    writer: pq.ParquetWriter | None = None

    processed_docs = 0
    shards = sorted(vectors_dir.glob("vectors_shard_*.parquet"))
    for shard_idx, vectors_path in enumerate(shards, start=1):
        frame = _load_joined_shard(vectors_path=vectors_path, exports_dir=exports_dir)
        if frame.empty:
            continue

        matrix = np.array(frame["embedding"].tolist(), dtype=np.float32)
        pca_matrix = pca.transform(matrix)
        if reducer is None:
            coords = np.zeros((len(frame), 2), dtype=np.float32)
            coords[:, : min(pca_matrix.shape[1], 2)] = pca_matrix[:, :2]
        else:
            coords = reducer.transform(pca_matrix).astype(np.float32)

        bx = _assign_bins(coords[:, 0], edges=x_edges)
        by = _assign_bins(coords[:, 1], edges=y_edges)
        np.add.at(density_counts, (bx, by), 1)

        detail_chunk = pd.DataFrame(
            {
                "doc_id": frame["doc_id"].astype(str),
                "paper_id": frame["paper_id"].astype(str),
                "paper_version_id": frame["paper_version_id"].astype(str),
                "title": frame["title"].astype(str),
                "abstract_preview": frame["abstract_preview"].astype(str),
                "submitted_at": frame["submitted_at"].astype(str),
                "year": frame["year"].astype(int),
                "categories": frame["categories"],
                "x": coords[:, 0].astype(np.float32),
                "y": coords[:, 1].astype(np.float32),
                "bin_x": bx,
                "bin_y": by,
            }
        )[DETAIL_COLUMNS]

        table = pa.Table.from_pandas(detail_chunk, preserve_index=False)
        if writer is None:
            writer = pq.ParquetWriter(str(detail_path), table.schema, compression="zstd")
        writer.write_table(table)
        processed_docs += len(detail_chunk)
        if shard_idx % 25 == 0 or shard_idx == len(shards):
            print(
                f"[space] detail write shard={shard_idx}/{len(shards)} processed_docs={processed_docs}",
                flush=True,
            )

    if writer is not None:
        writer.close()

    density_rows: list[dict[str, Any]] = []
    for x_bin in range(bins):
        for y_bin in range(bins):
            count = int(density_counts[x_bin, y_bin])
            if count == 0:
                continue
            density_rows.append(
                {
                    "bin_x": x_bin,
                    "bin_y": y_bin,
                    "doc_count": count,
                    "x_center": float((x_edges[x_bin] + x_edges[x_bin + 1]) * 0.5),
                    "y_center": float((y_edges[y_bin] + y_edges[y_bin + 1]) * 0.5),
                }
            )

    density_frame = pd.DataFrame(density_rows)
    density_frame.to_parquet(output_dir / "map_density.parquet", index=False)

    manifest = {
        "snapshot_id": snapshot_id,
        "projection": projection,
        "seed": settings.random_seed,
        "sample_points_requested": int(sample_points),
        "sample_points_actual": int(len(sample_frame)),
        "total_docs": int(total_docs),
        "processed_docs": int(processed_docs),
        "density_bins": int(bins),
        "x_edges_min": float(x_edges[0]),
        "x_edges_max": float(x_edges[-1]),
        "y_edges_min": float(y_edges[0]),
        "y_edges_max": float(y_edges[-1]),
        "pca_model_path": str(pca_path),
        "umap_model_path": (str(umap_path) if reducer is not None else None),
        "elapsed_seconds": float(time.time() - t0),
    }
    write_json(output_dir / "space_manifest.json", manifest)
    print(
        f"[space] done snapshot={snapshot_id} processed_docs={processed_docs} elapsed={manifest['elapsed_seconds']:.1f}s",
        flush=True,
    )

    return SpaceBuildResult(
        snapshot_id=snapshot_id,
        output_dir=output_dir,
        total_docs=total_docs,
        sample_docs=len(sample_frame),
        density_bins=bins,
    )


def parse_args() -> argparse.Namespace:
    settings = get_settings()
    parser = argparse.ArgumentParser(description="Build deterministic projection space for dashboard map")
    parser.add_argument("--snapshot-id", required=True)
    parser.add_argument("--projection", default="pca_umap")
    parser.add_argument("--sample-points", type=int, default=settings.map_sample_points)
    parser.add_argument("--density-bins", type=int, default=settings.map_density_bins)
    return parser.parse_args()


def main() -> None:
    configure_logging()
    args = parse_args()
    result = build_space(
        snapshot_id=args.snapshot_id,
        projection=args.projection,
        sample_points=args.sample_points,
        density_bins=args.density_bins,
    )
    print(
        f"Space built snapshot={result.snapshot_id} docs={result.total_docs} "
        f"sample={result.sample_docs} bins={result.density_bins} output={result.output_dir}"
    )


if __name__ == "__main__":
    main()
