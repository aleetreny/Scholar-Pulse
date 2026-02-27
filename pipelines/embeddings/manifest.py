from __future__ import annotations

import hashlib
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from pipelines.common.files import read_json, sha256_file, write_json


@dataclass(frozen=True)
class ShardMeta:
    name: str
    relative_path: str
    rows: int
    sha256: str


@dataclass(frozen=True)
class SnapshotManifestPayload:
    snapshot_id: str
    taxonomy: str
    model_name: str
    model_version: str
    expected_dimension: int
    document_count: int
    shard_size: int
    shards: list[ShardMeta]

    def to_dict(self) -> dict[str, Any]:
        return {
            "snapshot_id": self.snapshot_id,
            "taxonomy": self.taxonomy,
            "model_name": self.model_name,
            "model_version": self.model_version,
            "expected_dimension": self.expected_dimension,
            "document_count": self.document_count,
            "shard_size": self.shard_size,
            "shards": [
                {
                    "name": shard.name,
                    "relative_path": shard.relative_path,
                    "rows": shard.rows,
                    "sha256": shard.sha256,
                }
                for shard in self.shards
            ],
            "aggregate_checksum": aggregate_checksum(self.shards),
        }



def aggregate_checksum(shards: list[ShardMeta]) -> str:
    digest = hashlib.sha256()
    for shard in sorted(shards, key=lambda s: s.relative_path):
        digest.update(f"{shard.relative_path}:{shard.sha256}:{shard.rows}".encode("utf-8"))
    return digest.hexdigest()


def write_manifest(path: Path, payload: SnapshotManifestPayload) -> None:
    write_json(path, payload.to_dict())


def read_manifest(path: Path) -> dict[str, Any]:
    return read_json(path)


def shard_metadata(path: Path, rows: int) -> ShardMeta:
    return ShardMeta(name=path.name, relative_path=path.name, rows=rows, sha256=sha256_file(path))
