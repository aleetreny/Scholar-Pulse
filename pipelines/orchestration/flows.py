from __future__ import annotations

from datetime import datetime

from prefect import flow, task

from pipelines.common.settings import get_settings
from pipelines.embeddings.export_colab import export_snapshot
from pipelines.embeddings.import_colab import validate_and_register
from pipelines.ingestion.service import run_incremental
from pipelines.orchestration.local_refresh import run_weekly_local_refresh
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
    result = build_dashboard_feeds(snapshot_id=snapshot_id, profile="minimal")
    return {
        "snapshot_id": result.snapshot_id,
        "status": "dashboard_feeds_published",
        "records_used": result.records_used,
        "latest_count": result.latest_count,
        "output_dir": str(result.output_dir),
    }


@flow(name="weekly_local_refresh_flow")
def weekly_local_refresh_flow(
    as_of_iso: str | None = None,
    taxonomy: str | None = None,
    since_iso: str | None = None,
    batch_size: int = 16,
    chunk_size: int = 10,
    sample_points: int = 0,
    density_bins: int = 0,
    similarity_pca_dim: int = 0,
    enrichment_sources_csv: str = "openalex,s2,crossref",
    enrichment_max_papers: int = 0,
    skip_space: bool = False,
    skip_similarity: bool = False,
    skip_enrichment: bool = False,
    skip_publish: bool = False,
) -> dict[str, int | str | None]:
    as_of = datetime.fromisoformat(as_of_iso) if as_of_iso else None
    since = datetime.fromisoformat(since_iso) if since_iso else None
    result = run_weekly_local_refresh(
        as_of=as_of,
        taxonomy=taxonomy,
        since=since,
        batch_size=batch_size,
        chunk_size=chunk_size,
        sample_points=(sample_points if sample_points > 0 else None),
        density_bins=(density_bins if density_bins > 0 else None),
        similarity_pca_dim=(similarity_pca_dim if similarity_pca_dim > 0 else None),
        enrichment_sources=[
            token.strip() for token in enrichment_sources_csv.split(",") if token.strip()
        ],
        enrichment_max_papers=(enrichment_max_papers if enrichment_max_papers > 0 else None),
        skip_space=skip_space,
        skip_similarity=skip_similarity,
        skip_enrichment=skip_enrichment,
        skip_publish=skip_publish,
    )
    return {
        "snapshot_id": str(result["snapshot_id"]),
        "status": str(result["status"]),
        "document_count": int(result["document_count"]),
        "vector_count": int(result.get("vector_count", 0)),
        "ingestion_processed": int(result["ingestion_processed"]),
        "export_since": (str(result["export_since"]) if result["export_since"] is not None else None),
    }
