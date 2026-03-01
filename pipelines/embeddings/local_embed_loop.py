from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

from pipelines.common.settings import get_settings


def _expected_vector_shards(input_dir: Path) -> list[str]:
    manifest_path = input_dir / "manifest.json"
    if not manifest_path.exists():
        raise FileNotFoundError(f"Manifest not found: {manifest_path}")

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    return [shard["name"].replace("documents_", "vectors_") for shard in manifest["shards"]]


def _missing_indices(expected: list[str], output_dir: Path, start: int, end: int) -> list[int]:
    return [
        idx
        for idx in range(start, end)
        if idx < len(expected) and not (output_dir / expected[idx]).exists()
    ]


def run_local_embed_loop(
    *,
    snapshot_id: str,
    input_dir: Path,
    output_dir: Path,
    model_name: str,
    batch_size: int,
    seed: int,
    chunk_size: int,
    shard_start: int,
    shard_end: int | None,
) -> Path:
    from pipelines.embeddings.colab_embed import run_embedding

    expected = _expected_vector_shards(input_dir=input_dir)
    total = len(expected)

    start = max(shard_start, 0)
    end = total if shard_end is None else min(max(shard_end, 0), total)
    if start >= end:
        raise ValueError(f"Invalid shard range start={start}, end={end}, total={total}")

    output_dir.mkdir(parents=True, exist_ok=True)

    selected_total = end - start
    t0 = time.time()

    while True:
        missing = _missing_indices(expected=expected, output_dir=output_dir, start=start, end=end)
        done = selected_total - len(missing)
        progress = (100.0 * done / selected_total) if selected_total else 100.0

        if not missing:
            print(f"Embedding completed snapshot={snapshot_id} done={done}/{selected_total} ({progress:.2f}%)")
            break

        s = missing[0]
        e = min(s + max(chunk_size, 1), end)
        print(f"Run [{s},{e}) | done={done}/{selected_total} ({progress:.2f}%)")

        run_embedding(
            snapshot_id=snapshot_id,
            input_dir=input_dir,
            output_dir=output_dir,
            model_name=model_name,
            batch_size=max(batch_size, 1),
            seed=seed,
            shard_start=s,
            shard_end=e,
        )

        missing_after = _missing_indices(expected=expected, output_dir=output_dir, start=start, end=end)
        done_after = selected_total - len(missing_after)
        elapsed = max(time.time() - t0, 1e-6)
        rate = done_after / elapsed
        print(f"Progress rate≈{rate:.2f} shards/sec")

    manifest_path = output_dir / "manifest.json"
    if manifest_path.exists():
        return manifest_path

    partial_status = output_dir / "partial_status.json"
    if partial_status.exists():
        return partial_status

    raise RuntimeError("Embedding run finished without manifest.json or partial_status.json")


def parse_args() -> argparse.Namespace:
    settings = get_settings()
    parser = argparse.ArgumentParser(description="Run resumable local embeddings over export shards")
    parser.add_argument("--snapshot-id", required=True)
    parser.add_argument("--input-dir", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--model-name", default=settings.embedding_model_name)
    parser.add_argument("--batch-size", type=int, default=24)
    parser.add_argument("--seed", type=int, default=settings.random_seed)
    parser.add_argument("--chunk-size", type=int, default=10)
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
    manifest_path = run_local_embed_loop(
        snapshot_id=args.snapshot_id,
        input_dir=Path(args.input_dir),
        output_dir=Path(args.output_dir),
        model_name=args.model_name,
        batch_size=args.batch_size,
        seed=args.seed,
        chunk_size=args.chunk_size,
        shard_start=args.shard_start,
        shard_end=(None if args.shard_end < 0 else args.shard_end),
    )
    print(f"Local embedding output marker: {manifest_path}")


if __name__ == "__main__":
    main()
