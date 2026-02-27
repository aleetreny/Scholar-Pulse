from __future__ import annotations

from datetime import datetime

from prefect import flow, task

from pipelines.common.settings import get_settings
from pipelines.embeddings.export_colab import export_snapshot
from pipelines.embeddings.import_colab import validate_and_register
from pipelines.ingestion.service import run_incremental
from pipelines.publish.dashboard_feeds import build_dashboard_feeds


@task(retries=2, retry_delay_seconds=60)
def _run_incremental_task(as_of: datetime, taxonomy: list[str]) -> dict[str, int | str]:
    stats = run_incremental(as_of=as_of, taxonomy=taxonomy)
    return {
        "run_id": stats.run_id,
        "processed_entries": stats.processed_entries,
        "inserted_versions": stats.inserted_versions,
        "updated_versions": stats.updated_versions,
        "raw_records_path": str(stats.raw_records_path),
    }


@task
def _export_snapshot_task(snapshot_id: str, taxonomy: str) -> str:
    manifest_path = export_snapshot(snapshot_id=snapshot_id, taxonomy=taxonomy)
    return str(manifest_path)


@task
def _import_snapshot_task(snapshot_id: str) -> dict[str, int | str]:
    return validate_and_register(snapshot_id=snapshot_id)


@flow(name="daily_ingestion_flow")
def daily_ingestion_flow(
    as_of_iso: str | None = None, taxonomy: str | None = None
) -> dict[str, int | str]:
    settings = get_settings()
    as_of = datetime.fromisoformat(as_of_iso) if as_of_iso else datetime.now(datetime.UTC)
    as_of = as_of.astimezone(datetime.UTC)
    taxonomy_tokens = (
        [token.strip() for token in taxonomy.split(",") if token.strip()]
        if taxonomy
        else settings.taxonomy_tokens
    )
    return _run_incremental_task(as_of=as_of, taxonomy=taxonomy_tokens)


@flow(name="embedding_exchange_flow")
def embedding_exchange_flow(
    snapshot_id: str,
    taxonomy: str | None = None,
    register_import: bool = False,
) -> dict[str, int | str]:
    settings = get_settings()
    selected_taxonomy = taxonomy or settings.taxonomy_default
    _export_snapshot_task(snapshot_id=snapshot_id, taxonomy=selected_taxonomy)

    if register_import:
        return _import_snapshot_task(snapshot_id=snapshot_id)

    return {
        "snapshot_id": snapshot_id,
        "status": "exported_waiting_for_colab",
    }


@flow(name="analytics_publish_flow")
def analytics_publish_flow(snapshot_id: str) -> dict[str, int | str]:
    result = build_dashboard_feeds(snapshot_id=snapshot_id)
    return {
        "snapshot_id": result.snapshot_id,
        "status": "dashboard_feeds_published",
        "records_used": result.records_used,
        "clusters": result.clusters,
        "output_dir": str(result.output_dir),
    }
