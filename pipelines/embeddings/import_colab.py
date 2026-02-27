from __future__ import annotations

import argparse
import hashlib
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from pipelines.common.files import sha256_file
from pipelines.common.logging_utils import configure_logging
from pipelines.common.settings import get_settings
from pipelines.db.models import SnapshotManifest
from pipelines.db.session import session_scope
from pipelines.db.upsert import upsert_row
from pipelines.embeddings.manifest import read_manifest


class ManifestValidationError(RuntimeError):
    pass



def _validate_vector_norms(vectors: np.ndarray, tolerance: float = 1e-2) -> bool:
    norms = np.linalg.norm(vectors, axis=1)
    return bool(np.all(np.abs(norms - 1.0) <= tolerance))



def _load_vectors(path: Path) -> np.ndarray:
    frame = pd.read_parquet(path)
    if "embedding" not in frame.columns:
        raise ManifestValidationError(f"Missing embedding column in {path}")
    vectors = np.array(frame["embedding"].tolist(), dtype=np.float32)
    return vectors



def validate_and_register(snapshot_id: str) -> dict[str, Any]:
    settings = get_settings()
    export_manifest_path = settings.data_dir / "interim" / "exports" / snapshot_id / "manifest.json"
    embeddings_dir = settings.data_dir / "processed" / "embeddings" / snapshot_id
    embedding_manifest_path = embeddings_dir / "manifest.json"

    if not export_manifest_path.exists():
        raise FileNotFoundError(f"Missing export manifest: {export_manifest_path}")
    if not embedding_manifest_path.exists():
        raise FileNotFoundError(f"Missing embedding manifest: {embedding_manifest_path}")

    export_manifest = read_manifest(export_manifest_path)
    embedding_manifest = read_manifest(embedding_manifest_path)

    export_shards = export_manifest.get("shards", [])
    embedding_shards = embedding_manifest.get("shards", [])
    if len(export_shards) != len(embedding_shards):
        raise ManifestValidationError("Shard mismatch between export and embedding manifests")

    expected_dim = int(export_manifest["expected_dimension"])
    vector_count = 0

    aggregate = hashlib.sha256()
    for shard in embedding_shards:
        relative_path = shard["relative_path"]
        shard_path = embeddings_dir / relative_path
        if not shard_path.exists():
            raise ManifestValidationError(f"Missing embedding shard file: {shard_path}")

        checksum = sha256_file(shard_path)
        if checksum != shard["sha256"]:
            raise ManifestValidationError(f"Checksum mismatch for {relative_path}")

        vectors = _load_vectors(shard_path)
        if vectors.ndim != 2:
            raise ManifestValidationError(f"Invalid embedding matrix rank for {relative_path}")
        if vectors.shape[1] != expected_dim:
            raise ManifestValidationError(
                f"Embedding dimension mismatch in {relative_path}: {vectors.shape[1]} != {expected_dim}"
            )
        if not _validate_vector_norms(vectors):
            raise ManifestValidationError(f"Detected non-normalized vectors in {relative_path}")

        vector_count += vectors.shape[0]
        aggregate.update(f"{relative_path}:{checksum}:{vectors.shape[0]}".encode("utf-8"))

    if vector_count != int(export_manifest["document_count"]):
        raise ManifestValidationError(
            f"Vector count mismatch {vector_count} != {export_manifest['document_count']}"
        )

    with session_scope() as session:
        upsert_row(
            session=session,
            table=SnapshotManifest.__table__,
            values={
                "snapshot_id": snapshot_id,
                "taxonomy": export_manifest["taxonomy"],
                "model_name": export_manifest["model_name"],
                "model_version": export_manifest["model_version"],
                "expected_dimension": expected_dim,
                "export_manifest_path": str(export_manifest_path),
                "import_manifest_path": str(embedding_manifest_path),
                "status": "imported",
                "document_count": int(export_manifest["document_count"]),
                "vector_count": vector_count,
                "aggregate_checksum": aggregate.hexdigest(),
            },
            conflict_columns=["snapshot_id"],
            update_columns=[
                "taxonomy",
                "model_name",
                "model_version",
                "expected_dimension",
                "import_manifest_path",
                "status",
                "document_count",
                "vector_count",
                "aggregate_checksum",
            ],
        )

    return {
        "snapshot_id": snapshot_id,
        "vector_count": vector_count,
        "expected_dimension": expected_dim,
        "aggregate_checksum": aggregate.hexdigest(),
    }



def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate and register Colab embeddings")
    parser.add_argument("--snapshot-id", required=True)
    return parser.parse_args()



def main() -> None:
    configure_logging()
    args = parse_args()
    result = validate_and_register(snapshot_id=args.snapshot_id)
    print(
        "Embeddings import validated snapshot_id={snapshot_id} vectors={vector_count} dim={expected_dimension}".format(
            **result
        )
    )


if __name__ == "__main__":
    main()
