from __future__ import annotations

import argparse
import json
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select

from pipelines.common.settings import get_settings
from pipelines.common.snapshot import build_snapshot_id
from pipelines.db.models import PipelineState, SnapshotManifest
from pipelines.db.session import session_scope
from pipelines.db.upsert import upsert_row
from pipelines.embeddings.export_colab import export_snapshot
from pipelines.embeddings.import_colab import validate_and_register
from pipelines.embeddings.local_embed_loop import run_local_embed_loop
from pipelines.ingestion.service import IngestionStats, run_incremental
from pipelines.publish.dashboard_feeds import PublishResult, build_dashboard_feeds

EMBEDDING_WATERMARK_KEY = "embedding_incremental_watermark_utc"


def _parse_utc_datetime(value: str) -> datetime:
    dt = datetime.fromisoformat(value)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _snapshot_timestamp(snapshot_id: str) -> datetime | None:
    prefix = snapshot_id.split("__", maxsplit=1)[0]
    try:
        return datetime.strptime(prefix, "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _load_state_timestamp(state_key: str) -> datetime | None:
    with session_scope() as session:
        state = session.get(PipelineState, state_key)
        if state is None:
            return None
        return _parse_utc_datetime(state.state_value)


def _save_state_timestamp(state_key: str, value: datetime) -> None:
    with session_scope() as session:
        upsert_row(
            session=session,
            table=PipelineState.__table__,
            values={"state_key": state_key, "state_value": value.isoformat()},
            conflict_columns=["state_key"],
            update_columns=["state_value"],
        )


def _latest_imported_snapshot_timestamp() -> datetime | None:
    with session_scope() as session:
        rows = session.scalars(
            select(SnapshotManifest)
            .where(SnapshotManifest.status == "imported")
            .order_by(SnapshotManifest.updated_at.desc())
            .limit(20)
        ).all()

    timestamps = [ts for ts in (_snapshot_timestamp(row.snapshot_id) for row in rows) if ts is not None]
    return max(timestamps) if timestamps else None


def _resolve_export_since(
    explicit_since: datetime | None,
    overlap_hours: int,
) -> datetime | None:
    if explicit_since is not None:
        return explicit_since

    watermark = _load_state_timestamp(EMBEDDING_WATERMARK_KEY)
    if watermark is not None:
        return watermark - timedelta(hours=overlap_hours)

    imported_snapshot_ts = _latest_imported_snapshot_timestamp()
    if imported_snapshot_ts is not None:
        return imported_snapshot_ts - timedelta(hours=overlap_hours)

    return None


def _run_ingestion(as_of: datetime, taxonomy_tokens: list[str]) -> IngestionStats:
    return run_incremental(as_of=as_of, taxonomy=taxonomy_tokens)


def run_weekly_local_refresh(
    *,
    as_of: datetime | None = None,
    taxonomy: str | None = None,
    since: datetime | None = None,
    batch_size: int = 16,
    chunk_size: int = 10,
    cluster_count: int = 16,
    max_docs: int = 10_000,
    skip_publish: bool = False,
) -> dict[str, Any]:
    settings = get_settings()
    run_ts = (as_of or datetime.now(timezone.utc)).astimezone(timezone.utc)
    taxonomy_value = taxonomy or settings.taxonomy_default
    taxonomy_tokens = [token.strip() for token in taxonomy_value.split(",") if token.strip()]

    incremental_stats = _run_ingestion(as_of=run_ts, taxonomy_tokens=taxonomy_tokens)

    export_since = _resolve_export_since(
        explicit_since=since,
        overlap_hours=settings.arxiv_overlap_hours,
    )

    snapshot_id = build_snapshot_id(
        taxonomy=taxonomy_value,
        model_version=settings.embedding_model_version,
        now=run_ts,
    )

    export_manifest_path = export_snapshot(
        snapshot_id=snapshot_id,
        taxonomy=taxonomy_value,
        updated_since=export_since,
    )

    export_manifest = json.loads(export_manifest_path.read_text(encoding="utf-8"))
    document_count = int(export_manifest.get("document_count", 0))

    result: dict[str, Any] = {
        "snapshot_id": snapshot_id,
        "taxonomy": taxonomy_value,
        "as_of": run_ts.isoformat(),
        "export_since": (export_since.isoformat() if export_since is not None else None),
        "document_count": document_count,
        "ingestion_run_id": incremental_stats.run_id,
        "ingestion_processed": incremental_stats.processed_entries,
        "ingestion_inserted_versions": incremental_stats.inserted_versions,
        "ingestion_updated_versions": incremental_stats.updated_versions,
        "export_manifest_path": str(export_manifest_path),
    }

    if document_count == 0:
        _save_state_timestamp(EMBEDDING_WATERMARK_KEY, run_ts)
        result["status"] = "no_new_documents"
        return result

    input_dir = export_manifest_path.parent
    output_dir = settings.data_dir / "processed" / "embeddings" / snapshot_id

    local_embed_marker = run_local_embed_loop(
        snapshot_id=snapshot_id,
        input_dir=input_dir,
        output_dir=output_dir,
        model_name=settings.embedding_model_name,
        batch_size=batch_size,
        seed=settings.random_seed,
        chunk_size=chunk_size,
        shard_start=0,
        shard_end=None,
    )
    result["embedding_marker"] = str(local_embed_marker)

    import_result = validate_and_register(snapshot_id=snapshot_id)
    result["vector_count"] = int(import_result["vector_count"])
    result["expected_dimension"] = int(import_result["expected_dimension"])

    if not skip_publish:
        publish_result: PublishResult = build_dashboard_feeds(
            snapshot_id=snapshot_id,
            cluster_count=max(cluster_count, 1),
            max_docs=max(max_docs, 0),
            seed=settings.random_seed,
        )
        result["publish_output"] = str(publish_result.output_dir)
        result["publish_records_used"] = int(publish_result.records_used)
        result["publish_clusters"] = int(publish_result.clusters)

    _save_state_timestamp(EMBEDDING_WATERMARK_KEY, run_ts)
    result["status"] = "completed"
    return result


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Weekly local refresh: incremental ingest -> export -> local embeddings -> import -> publish"
    )
    parser.add_argument("--as-of", default="", help="UTC ISO datetime (default: now)")
    parser.add_argument("--taxonomy", default="")
    parser.add_argument("--since", default="", help="UTC ISO datetime override for export lower-bound")
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--chunk-size", type=int, default=10)
    parser.add_argument("--cluster-count", type=int, default=16)
    parser.add_argument("--max-docs", type=int, default=10000)
    parser.add_argument("--skip-publish", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    result = run_weekly_local_refresh(
        as_of=(_parse_utc_datetime(args.as_of) if args.as_of else None),
        taxonomy=(args.taxonomy or None),
        since=(_parse_utc_datetime(args.since) if args.since else None),
        batch_size=args.batch_size,
        chunk_size=args.chunk_size,
        cluster_count=args.cluster_count,
        max_docs=args.max_docs,
        skip_publish=args.skip_publish,
    )
    print(json.dumps(result, ensure_ascii=True, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
