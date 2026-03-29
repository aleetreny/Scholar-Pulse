from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from pipelines.common.settings import get_settings


class SimilarityEngine:
    def __init__(self, snapshot_id: str) -> None:
        self.snapshot_id = snapshot_id
        settings = get_settings()
        self.settings = settings

        self.index_dir = settings.data_dir / "processed" / "similarity" / snapshot_id
        self.vectors_dir = settings.data_dir / "processed" / "embeddings" / snapshot_id

        manifest_path = self.index_dir / "index_manifest.json"
        if not manifest_path.exists():
            raise FileNotFoundError(f"Missing similarity index manifest: {manifest_path}")
        self.manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

        lookup_path = Path(self.manifest["lookup_path"])
        if not lookup_path.exists():
            lookup_path = self.index_dir / "doc_id_lookup.parquet"
        lookup = pd.read_parquet(lookup_path).sort_values("label").reset_index(drop=True)

        self.labels = lookup["label"].to_numpy(dtype=np.int64)
        self.doc_ids = lookup["doc_id"].astype(str).to_numpy()
        self.shard_names = lookup["shard_name"].astype(str).to_numpy()
        self.row_in_shard = lookup["row_in_shard"].to_numpy(dtype=np.int64)
        self.doc_to_label = {
            doc_id: int(label) for label, doc_id in zip(self.labels, self.doc_ids, strict=False)
        }

        self.label_to_pos = {int(label): idx for idx, label in enumerate(self.labels.tolist())}
        self._shard_cache: dict[str, pd.DataFrame] = {}

        try:
            import hnswlib
        except ImportError as exc:
            raise RuntimeError("Install similarity dependencies: pip install -e '.[similarity]'") from exc

        self._hnswlib = hnswlib
        dim = int(self.manifest["pca_dim_actual"])
        self.index = hnswlib.Index(space="cosine", dim=dim)

        index_path = Path(self.manifest["index_path"])
        if not index_path.exists():
            index_path = self.index_dir / "hnsw.index"
        self.index.load_index(str(index_path))
        self.index.set_ef(int(self.manifest.get("ef_search", settings.similarity_hnsw_ef_search)))

        try:
            import joblib
        except ImportError as exc:
            raise RuntimeError("Install similarity dependencies: pip install -e '.[similarity]'") from exc

        pca_path = Path(self.manifest["pca_model_path"])
        if not pca_path.exists():
            pca_path = self.index_dir / "pca_model.joblib"
        self.pca = joblib.load(pca_path)

    def _load_shard(self, shard_name: str) -> pd.DataFrame:
        cached = self._shard_cache.get(shard_name)
        if cached is not None:
            return cached

        path = self.vectors_dir / shard_name
        if not path.exists():
            raise FileNotFoundError(f"Missing embedding shard: {path}")
        frame = pd.read_parquet(path)
        frame["doc_id"] = frame["doc_id"].astype(str)
        if len(self._shard_cache) >= 24:
            self._shard_cache.pop(next(iter(self._shard_cache)))
        self._shard_cache[shard_name] = frame
        return frame

    def _exact_vector_by_doc_id(self, doc_id: str) -> np.ndarray:
        label = self.doc_to_label.get(doc_id)
        if label is None:
            raise KeyError(f"Unknown doc_id: {doc_id}")

        pos = self.label_to_pos[label]
        shard_name = self.shard_names[pos]
        row_idx = int(self.row_in_shard[pos])

        shard = self._load_shard(shard_name)
        if row_idx >= len(shard):
            match = shard[shard["doc_id"] == doc_id]
            if match.empty:
                raise KeyError(f"doc_id {doc_id} missing from shard {shard_name}")
            vector = np.array(match.iloc[0]["embedding"], dtype=np.float32)
        else:
            row = shard.iloc[row_idx]
            if str(row["doc_id"]) != doc_id:
                match = shard[shard["doc_id"] == doc_id]
                if match.empty:
                    raise KeyError(f"doc_id {doc_id} missing from shard {shard_name}")
                vector = np.array(match.iloc[0]["embedding"], dtype=np.float32)
            else:
                vector = np.array(row["embedding"], dtype=np.float32)

        norm = np.linalg.norm(vector)
        if norm > 0:
            vector = vector / norm
        return vector

    def _reduced_vector(self, exact_vector: np.ndarray) -> np.ndarray:
        reduced = self.pca.transform(exact_vector.reshape(1, -1)).astype(np.float32)
        norm = np.linalg.norm(reduced, axis=1, keepdims=True)
        reduced = reduced / np.clip(norm, 1e-12, None)
        return reduced

    def query_neighbors(
        self,
        *,
        doc_id: str,
        top_k: int | None = None,
        candidate_k: int | None = None,
    ) -> list[dict[str, Any]]:
        k = int(top_k or self.settings.similarity_top_k)
        c = int(candidate_k or self.settings.similarity_candidate_k)
        k = max(k, 1)
        c = max(c, k + 1)

        query_exact = self._exact_vector_by_doc_id(doc_id)
        query_reduced = self._reduced_vector(query_exact)

        labels, _ = self.index.knn_query(query_reduced, k=min(c, len(self.labels)))
        candidate_labels = [int(value) for value in labels[0].tolist()]

        candidate_rows: list[tuple[int, str, str, int]] = []
        for label in candidate_labels:
            pos = self.label_to_pos.get(label)
            if pos is None:
                continue
            candidate_doc = str(self.doc_ids[pos])
            if candidate_doc == doc_id:
                continue
            candidate_rows.append((label, candidate_doc, str(self.shard_names[pos]), int(self.row_in_shard[pos])))

        if not candidate_rows:
            return []

        vectors: dict[str, np.ndarray] = {}
        grouped: dict[str, list[tuple[str, int]]] = {}
        for _, candidate_doc, shard_name, row_idx in candidate_rows:
            grouped.setdefault(shard_name, []).append((candidate_doc, row_idx))

        for shard_name, docs in grouped.items():
            shard = self._load_shard(shard_name)
            row_indexes = [row_idx for _, row_idx in docs]
            valid_indexes = [idx for idx in row_indexes if 0 <= idx < len(shard)]
            if valid_indexes:
                subset = shard.iloc[valid_indexes]
                for _, row in subset.iterrows():
                    vectors[str(row["doc_id"])] = np.array(row["embedding"], dtype=np.float32)
            missing_docs = [doc for doc, row_idx in docs if row_idx < 0 or row_idx >= len(shard) or doc not in vectors]
            if missing_docs:
                fallback = shard[shard["doc_id"].isin(missing_docs)]
                for _, row in fallback.iterrows():
                    vectors[str(row["doc_id"])] = np.array(row["embedding"], dtype=np.float32)

        scored: list[dict[str, Any]] = []
        for label, candidate_doc, _, _ in candidate_rows:
            vector = vectors.get(candidate_doc)
            if vector is None:
                continue
            norm = np.linalg.norm(vector)
            if norm > 0:
                vector = vector / norm
            similarity = float(np.dot(query_exact, vector))
            scored.append(
                {
                    "label": int(label),
                    "doc_id": candidate_doc,
                    "cosine_similarity": similarity,
                }
            )

        scored.sort(key=lambda row: row["cosine_similarity"], reverse=True)
        return scored[:k]
