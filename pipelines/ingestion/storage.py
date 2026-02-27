from __future__ import annotations

import json
from pathlib import Path
from typing import Iterable

import zstandard as zstd

from pipelines.ingestion.types import ArxivRecord


def write_raw_records_zst(path: Path, records: Iterable[ArxivRecord]) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    count = 0
    compressor = zstd.ZstdCompressor(level=6)
    with path.open("wb") as fh:
        with compressor.stream_writer(fh) as stream:
            for record in records:
                payload = {
                    "paper_id": record.paper_id,
                    "paper_version_id": record.paper_version_id,
                    "version": record.version,
                    "title": record.title,
                    "abstract": record.abstract,
                    "submitted_at": record.submitted_at.isoformat(),
                    "updated_at": record.updated_at.isoformat(),
                    "categories": record.categories,
                    "raw": record.raw,
                }
                stream.write((json.dumps(payload, ensure_ascii=True) + "\n").encode("utf-8"))
                count += 1
    return count
