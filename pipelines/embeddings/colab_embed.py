from __future__ import annotations

import argparse
import json
import random
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import torch
from transformers import AutoModel, AutoTokenizer

from pipelines.common.files import write_json
from pipelines.common.settings import get_settings
from pipelines.embeddings.manifest import ShardMeta, aggregate_checksum, shard_metadata



def set_determinism(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)



def mean_pooling(last_hidden_state: torch.Tensor, attention_mask: torch.Tensor) -> torch.Tensor:
    mask = attention_mask.unsqueeze(-1).expand(last_hidden_state.size()).float()
    summed = torch.sum(last_hidden_state * mask, dim=1)
    count = torch.clamp(mask.sum(dim=1), min=1e-9)
    return summed / count



def embed_texts(
    texts: list[str], tokenizer: AutoTokenizer, model: AutoModel, device: torch.device, batch_size: int
) -> np.ndarray:
    all_vectors: list[np.ndarray] = []
    model.eval()

    with torch.no_grad():
        for start in range(0, len(texts), batch_size):
            batch_texts = texts[start : start + batch_size]
            encoded = tokenizer(
                batch_texts,
                padding=True,
                truncation=True,
                max_length=8192,
                return_tensors="pt",
            )
            encoded = {k: v.to(device) for k, v in encoded.items()}
            outputs = model(**encoded)
            pooled = mean_pooling(outputs.last_hidden_state, encoded["attention_mask"])
            normalized = torch.nn.functional.normalize(pooled, p=2, dim=1)
            all_vectors.append(normalized.cpu().numpy().astype(np.float32))

    return np.vstack(all_vectors) if all_vectors else np.empty((0, 0), dtype=np.float32)



def run_embedding(
    snapshot_id: str,
    input_dir: Path,
    output_dir: Path,
    model_name: str,
    batch_size: int,
    seed: int,
    shard_start: int,
    shard_end: int | None,
) -> Path:
    set_determinism(seed)

    manifest_path = input_dir / "manifest.json"
    if not manifest_path.exists():
        raise FileNotFoundError(f"Export manifest not found at {manifest_path}")

    manifest: dict[str, Any] = json.loads(manifest_path.read_text(encoding="utf-8"))
    expected_dim = int(manifest["expected_dimension"])

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    tokenizer = AutoTokenizer.from_pretrained(model_name)
    model = AutoModel.from_pretrained(model_name).to(device)

    output_dir.mkdir(parents=True, exist_ok=True)

    expected_shards = list(manifest["shards"])
    if shard_start < 0:
        raise ValueError("shard_start must be >= 0")
    selected = expected_shards[shard_start : shard_end if shard_end is not None else len(expected_shards)]
    if not selected:
        raise ValueError("No shards selected. Check --shard-start/--shard-end values.")

    for shard in selected:
        input_shard = input_dir / shard["relative_path"]
        frame = pd.read_parquet(input_shard)
        texts = frame["text"].astype(str).tolist()
        doc_ids = frame["doc_id"].astype(str).tolist()

        vectors = embed_texts(texts, tokenizer, model, device=device, batch_size=batch_size)
        if vectors.shape[1] != expected_dim:
            raise RuntimeError(
                f"Embedding dimension mismatch: got {vectors.shape[1]}, expected {expected_dim}"
            )

        vector_frame = pd.DataFrame(
            {
                "doc_id": doc_ids,
                "embedding": [row.tolist() for row in vectors],
            }
        )

        shard_index = shard["name"].replace("documents_", "vectors_")
        output_shard = output_dir / shard_index
        vector_frame.to_parquet(output_shard, index=False)
    complete_shards: list[ShardMeta] = []
    total_vectors = 0
    missing_shards: list[str] = []
    for shard in expected_shards:
        vector_name = shard["name"].replace("documents_", "vectors_")
        output_shard = output_dir / vector_name
        if not output_shard.exists():
            missing_shards.append(vector_name)
            continue

        vector_rows = len(pd.read_parquet(output_shard))
        complete_shards.append(shard_metadata(output_shard, rows=vector_rows))
        total_vectors += vector_rows

    if missing_shards:
        partial_status = {
            "snapshot_id": snapshot_id,
            "status": "partial",
            "processed_shards": len(complete_shards),
            "missing_shards": len(missing_shards),
            "missing_examples": missing_shards[:10],
        }
        partial_status_path = output_dir / "partial_status.json"
        write_json(partial_status_path, partial_status)
        return partial_status_path

    embedding_manifest = {
        "snapshot_id": snapshot_id,
        "model_name": model_name,
        "expected_dimension": expected_dim,
        "vector_count": total_vectors,
        "shards": [
            {
                "name": item.name,
                "relative_path": item.relative_path,
                "rows": item.rows,
                "sha256": item.sha256,
            }
            for item in complete_shards
        ],
        "aggregate_checksum": aggregate_checksum(complete_shards),
        "precision": "float32",
        "normalized": True,
    }
    output_manifest = output_dir / "manifest.json"
    write_json(output_manifest, embedding_manifest)
    return output_manifest



def parse_args() -> argparse.Namespace:
    settings = get_settings()
    parser = argparse.ArgumentParser(description="Generate embeddings in Colab")
    parser.add_argument("--snapshot-id", required=True)
    parser.add_argument("--input-dir", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--model-name", default=settings.embedding_model_name)
    parser.add_argument("--batch-size", type=int, default=24)
    parser.add_argument("--seed", type=int, default=settings.random_seed)
    parser.add_argument("--shard-start", type=int, default=0)
    parser.add_argument(
        "--shard-end",
        type=int,
        default=-1,
        help="Exclusive end index. Use -1 to process until the final shard.",
    )
    return parser.parse_args()



def main() -> None:
    args = parse_args()
    output_manifest = run_embedding(
        snapshot_id=args.snapshot_id,
        input_dir=Path(args.input_dir),
        output_dir=Path(args.output_dir),
        model_name=args.model_name,
        batch_size=args.batch_size,
        seed=args.seed,
        shard_start=args.shard_start,
        shard_end=(None if args.shard_end < 0 else args.shard_end),
    )
    print(f"Embedding manifest created: {output_manifest}")


if __name__ == "__main__":
    main()
