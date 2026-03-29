from __future__ import annotations

import argparse
import hashlib
import heapq
import time
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd

from pipelines.common.files import write_json
from pipelines.common.logging_utils import configure_logging
from pipelines.common.settings import get_settings


@dataclass(frozen=True)
class SimilarityBuildResult:
    snapshot_id: str
    output_dir: Path
    indexed_docs: int
    pca_dim: int


def _stable_hash64(text: str) -> int:
    return int(hashlib.sha1(text.encode("utf-8")).hexdigest()[:16], 16)


def _collect_sample(vectors_dir: Path, sample_size: int) -> np.ndarray:
    heap: list[tuple[int, int, np.ndarray]] = []
    counter = 0

    shards = sorted(vectors_dir.glob("vectors_shard_*.parquet"))
    for shard_idx, shard in enumerate(shards, start=1):
        frame = pd.read_parquet(shard, columns=["doc_id", "embedding"])
        if frame.empty:
            continue
        doc_ids = frame["doc_id"].astype(str).tolist()
        vectors = np.array(frame["embedding"].tolist(), dtype=np.float32)

        for idx, doc_id in enumerate(doc_ids):
            hash_value = _stable_hash64(doc_id)
            vector = vectors[idx]
            if len(heap) < sample_size:
                heapq.heappush(heap, (-hash_value, counter, vector))
            elif hash_value < -heap[0][0]:
                heapq.heapreplace(heap, (-hash_value, counter, vector))
            counter += 1

        if shard_idx % 25 == 0 or shard_idx == len(shards):
            print(
                f"[similarity] sample collection shard={shard_idx}/{len(shards)}",
                flush=True,
            )

    if not heap:
        return np.empty((0, 0), dtype=np.float32)

    ordered = sorted(((-entry[0], entry[2]) for entry in heap), key=lambda value: value[0])
    return np.vstack([entry[1] for entry in ordered]).astype(np.float32)


def _fit_pca(sample: np.ndarray, requested_dim: int, seed: int):
    try:
        from sklearn.decomposition import PCA
    except ImportError as exc:
        raise RuntimeError("Install similarity dependencies: pip install -e '.[similarity]'") from exc

    if sample.size == 0:
        raise RuntimeError("Cannot build index without vectors")

    rows, cols = sample.shape
    if rows < 2:
        dim = min(requested_dim, cols)
        class Identity:
            def transform(self, matrix: np.ndarray) -> np.ndarray:
                return matrix[:, :dim]

        return Identity(), dim

    dim = min(requested_dim, cols, rows - 1)
    pca = PCA(n_components=dim, random_state=seed, svd_solver="randomized")
    pca.fit(sample)
    return pca, dim


def build_hnsw_index(
    *,
    snapshot_id: str,
    metric: str,
    pca_dim: int,
    ef_construction: int,
    ef_search: int,
    m: int,
    sample_size: int,
) -> SimilarityBuildResult:
    if metric != "cosine":
        raise ValueError("Only cosine metric is supported")

    try:
        import hnswlib
    except ImportError as exc:
        raise RuntimeError("Install similarity dependencies: pip install -e '.[similarity]'") from exc

    try:
        import joblib
    except ImportError as exc:
        raise RuntimeError("Install similarity dependencies: pip install -e '.[similarity]'") from exc

    settings = get_settings()
    vectors_dir = settings.data_dir / "processed" / "embeddings" / snapshot_id
    if not vectors_dir.exists():
        raise FileNotFoundError(f"Embedding snapshot not found: {vectors_dir}")

    output_dir = settings.data_dir / "processed" / "similarity" / snapshot_id
    output_dir.mkdir(parents=True, exist_ok=True)

    t0 = time.time()
    print(
        f"[similarity] start snapshot={snapshot_id} metric={metric} pca_dim={pca_dim}",
        flush=True,
    )
    sample_matrix = _collect_sample(vectors_dir=vectors_dir, sample_size=max(sample_size, 2))
    pca_model, actual_dim = _fit_pca(sample=sample_matrix, requested_dim=max(pca_dim, 2), seed=settings.random_seed)
    pca_path = output_dir / "pca_model.joblib"
    joblib.dump(pca_model, pca_path)

    total_docs = 0
    for shard in sorted(vectors_dir.glob("vectors_shard_*.parquet")):
        frame = pd.read_parquet(shard, columns=["doc_id"])
        total_docs += len(frame)

    index = hnswlib.Index(space="cosine", dim=actual_dim)
    index.init_index(max_elements=max(total_docs, 1), ef_construction=max(ef_construction, 16), M=max(m, 4))
    index.set_ef(max(ef_search, 20))

    labels: list[int] = []
    doc_ids: list[str] = []
    shard_names: list[str] = []
    row_indices: list[int] = []

    current_label = 0
    shards = sorted(vectors_dir.glob("vectors_shard_*.parquet"))
    for shard_idx, shard in enumerate(shards, start=1):
        frame = pd.read_parquet(shard, columns=["doc_id", "embedding"])
        if frame.empty:
            continue

        matrix = np.array(frame["embedding"].tolist(), dtype=np.float32)
        reduced = pca_model.transform(matrix).astype(np.float32)
        norms = np.linalg.norm(reduced, axis=1, keepdims=True)
        reduced = reduced / np.clip(norms, 1e-12, None)

        batch_size = len(frame)
        batch_labels = np.arange(current_label, current_label + batch_size, dtype=np.int64)
        index.add_items(reduced, batch_labels)

        labels.extend(batch_labels.tolist())
        doc_ids.extend(frame["doc_id"].astype(str).tolist())
        shard_names.extend([shard.name] * batch_size)
        row_indices.extend(list(range(batch_size)))
        current_label += batch_size
        if shard_idx % 25 == 0 or shard_idx == len(shards):
            print(
                f"[similarity] index build shard={shard_idx}/{len(shards)} indexed={current_label}",
                flush=True,
            )

    index_path = output_dir / "hnsw.index"
    index.save_index(str(index_path))

    lookup = pd.DataFrame(
        {
            "label": labels,
            "doc_id": doc_ids,
            "shard_name": shard_names,
            "row_in_shard": row_indices,
        }
    ).sort_values("label")
    lookup_path = output_dir / "doc_id_lookup.parquet"
    lookup.to_parquet(lookup_path, index=False)

    manifest = {
        "snapshot_id": snapshot_id,
        "metric": metric,
        "pca_dim_requested": int(pca_dim),
        "pca_dim_actual": int(actual_dim),
        "indexed_docs": int(len(lookup)),
        "m": int(m),
        "ef_construction": int(ef_construction),
        "ef_search": int(ef_search),
        "sample_size": int(sample_size),
        "index_path": str(index_path),
        "lookup_path": str(lookup_path),
        "pca_model_path": str(pca_path),
        "elapsed_seconds": float(time.time() - t0),
    }
    write_json(output_dir / "index_manifest.json", manifest)
    print(
        f"[similarity] done snapshot={snapshot_id} indexed_docs={len(lookup)} elapsed={manifest['elapsed_seconds']:.1f}s",
        flush=True,
    )

    return SimilarityBuildResult(
        snapshot_id=snapshot_id,
        output_dir=output_dir,
        indexed_docs=len(lookup),
        pca_dim=actual_dim,
    )


def parse_args() -> argparse.Namespace:
    settings = get_settings()
    parser = argparse.ArgumentParser(description="Build HNSW index for semantic similarity")
    parser.add_argument("--snapshot-id", required=True)
    parser.add_argument("--index", default="hnsw")
    parser.add_argument("--metric", default="cosine")
    parser.add_argument("--pca-dim", type=int, default=settings.similarity_pca_dim)
    parser.add_argument("--m", type=int, default=settings.similarity_hnsw_m)
    parser.add_argument(
        "--ef-construction",
        type=int,
        default=settings.similarity_hnsw_ef_construction,
    )
    parser.add_argument("--ef-search", type=int, default=settings.similarity_hnsw_ef_search)
    parser.add_argument("--sample-size", type=int, default=max(settings.map_sample_points, 50000))
    return parser.parse_args()


def main() -> None:
    configure_logging()
    args = parse_args()
    if args.index != "hnsw":
        raise ValueError("Only --index hnsw is supported")

    result = build_hnsw_index(
        snapshot_id=args.snapshot_id,
        metric=args.metric,
        pca_dim=args.pca_dim,
        ef_construction=args.ef_construction,
        ef_search=args.ef_search,
        m=args.m,
        sample_size=args.sample_size,
    )
    print(
        f"Similarity index built snapshot={result.snapshot_id} "
        f"docs={result.indexed_docs} pca_dim={result.pca_dim} output={result.output_dir}"
    )


if __name__ == "__main__":
    main()
