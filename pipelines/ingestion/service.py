from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Iterable
from uuid import uuid4

from sqlalchemy import select

from pipelines.common.logging_utils import get_logger
from pipelines.common.settings import get_settings
from pipelines.db.models import IngestionRun, Paper, PaperCategory, PaperVersion, PipelineState
from pipelines.db.session import session_scope
from pipelines.db.upsert import upsert_row
from pipelines.ingestion.arxiv_utils import compute_record_hash
from pipelines.ingestion.client import ArxivClient
from pipelines.ingestion.storage import write_raw_records_zst
from pipelines.ingestion.types import ArxivRecord

WATERMARK_KEY = "arxiv_incremental_watermark_utc"
logger = get_logger(__name__)


@dataclass(frozen=True)
class IngestionStats:
    run_id: str
    processed_entries: int
    inserted_versions: int
    updated_versions: int
    raw_records_path: Path


def month_windows(start: datetime, end: datetime) -> list[tuple[datetime, datetime]]:
    windows: list[tuple[datetime, datetime]] = []
    cursor = start
    while cursor <= end:
        month_end = (cursor.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(seconds=1)
        window_end = min(month_end, end)
        windows.append((cursor, window_end))
        cursor = window_end + timedelta(seconds=1)
    return windows


def _upsert_record(record: ArxivRecord) -> tuple[bool, bool]:
    content_hash = compute_record_hash(record)
    inserted_version = False
    updated_version = False

    with session_scope() as session:
        upsert_row(
            session=session,
            table=Paper.__table__,
            values={"paper_id": record.paper_id},
            conflict_columns=["paper_id"],
            update_columns=["updated_at"],
        )

        existing = session.execute(
            select(PaperVersion).where(PaperVersion.paper_version_id == record.paper_version_id)
        ).scalar_one_or_none()

        values = {
            "paper_id": record.paper_id,
            "paper_version_id": record.paper_version_id,
            "version": record.version,
            "title": record.title,
            "abstract": record.abstract,
            "submitted_at": record.submitted_at,
            "updated_at": record.updated_at,
            "content_hash": content_hash,
        }

        if existing is None:
            inserted_version = True
        elif existing.content_hash != content_hash:
            updated_version = True

        upsert_row(
            session=session,
            table=PaperVersion.__table__,
            values=values,
            conflict_columns=["paper_version_id"],
            update_columns=["title", "abstract", "updated_at", "content_hash", "submitted_at", "version"],
        )

        for category in record.categories:
            upsert_row(
                session=session,
                table=PaperCategory.__table__,
                values={
                    "paper_id": record.paper_id,
                    "category": category,
                    "latest_submitted_at": record.submitted_at,
                },
                conflict_columns=["paper_id", "category"],
                update_columns=["latest_submitted_at"],
            )

    return inserted_version, updated_version


def _load_watermark() -> datetime | None:
    with session_scope() as session:
        state = session.get(PipelineState, WATERMARK_KEY)
        if state is None:
            return None
        return datetime.fromisoformat(state.state_value)


def _save_watermark(value: datetime) -> None:
    with session_scope() as session:
        upsert_row(
            session=session,
            table=PipelineState.__table__,
            values={"state_key": WATERMARK_KEY, "state_value": value.isoformat()},
            conflict_columns=["state_key"],
            update_columns=["state_value"],
        )


def _create_run(
    mode: str,
    taxonomy: str,
    from_date: datetime | None,
    to_date: datetime | None,
) -> str:
    run_id = uuid4().hex
    with session_scope() as session:
        session.add(
            IngestionRun(
                run_id=run_id,
                mode=mode,
                taxonomy=taxonomy,
                from_date=from_date,
                to_date=to_date,
                status="running",
            )
        )
    return run_id


def _finish_run(run_id: str, stats: IngestionStats | None = None, error: Exception | None = None) -> None:
    with session_scope() as session:
        run = session.get(IngestionRun, run_id)
        if run is None:
            return
        run.finished_at = datetime.now(timezone.utc)
        if error is not None:
            run.status = "failed"
            run.error_message = str(error)
        else:
            run.status = "succeeded"
            if stats is not None:
                run.processed_entries = stats.processed_entries
                run.inserted_versions = stats.inserted_versions
                run.updated_versions = stats.updated_versions
                run.raw_records_path = str(stats.raw_records_path)


def run_backfill(
    from_date: datetime,
    to_date: datetime,
    taxonomy: list[str],
    max_records: int | None = None,
) -> IngestionStats:
    settings = get_settings()
    taxonomy_text = ",".join(taxonomy)
    run_id = _create_run(mode="backfill", taxonomy=taxonomy_text, from_date=from_date, to_date=to_date)

    all_records: list[ArxivRecord] = []
    client = ArxivClient()

    try:
        remaining = max_records
        for window_start, window_end in month_windows(from_date, to_date):
            logger.info("Fetching window %s to %s", window_start, window_end)
            batch = list(client.fetch_records(taxonomy, window_start, window_end, max_records=remaining))
            all_records.extend(batch)
            if remaining is not None:
                remaining -= len(batch)
                if remaining <= 0:
                    break

        processed_entries = len(all_records)
        inserted_versions = 0
        updated_versions = 0
        for record in all_records:
            inserted, updated = _upsert_record(record)
            inserted_versions += int(inserted)
            updated_versions += int(updated)

        run_date = datetime.now(timezone.utc).date().isoformat()
        raw_path = settings.data_dir / "raw" / "arxiv" / run_date / f"{run_id}.records.jsonl.zst"
        write_raw_records_zst(raw_path, all_records)

        stats = IngestionStats(
            run_id=run_id,
            processed_entries=processed_entries,
            inserted_versions=inserted_versions,
            updated_versions=updated_versions,
            raw_records_path=raw_path,
        )
        _finish_run(run_id, stats=stats)
        return stats
    except Exception as exc:
        _finish_run(run_id, error=exc)
        raise


def run_incremental(
    as_of: datetime,
    taxonomy: list[str],
    max_records: int | None = None,
) -> IngestionStats:
    settings = get_settings()
    watermark = _load_watermark()
    if watermark is None:
        from_date = as_of - timedelta(hours=settings.arxiv_overlap_hours)
    else:
        from_date = watermark - timedelta(hours=settings.arxiv_overlap_hours)

    run_id = _create_run(mode="incremental", taxonomy=",".join(taxonomy), from_date=from_date, to_date=as_of)
    client = ArxivClient()

    records = list(client.fetch_records(taxonomy, from_date, as_of, max_records=max_records))
    processed_entries = len(records)
    inserted_versions = 0
    updated_versions = 0

    try:
        for record in records:
            inserted, updated = _upsert_record(record)
            inserted_versions += int(inserted)
            updated_versions += int(updated)

        run_date = datetime.now(timezone.utc).date().isoformat()
        raw_path = settings.data_dir / "raw" / "arxiv" / run_date / f"{run_id}.records.jsonl.zst"
        write_raw_records_zst(raw_path, records)

        _save_watermark(as_of)

        stats = IngestionStats(
            run_id=run_id,
            processed_entries=processed_entries,
            inserted_versions=inserted_versions,
            updated_versions=updated_versions,
            raw_records_path=raw_path,
        )
        _finish_run(run_id, stats=stats)
        return stats
    except Exception as exc:
        _finish_run(run_id, error=exc)
        raise


def run_latest_seed(taxonomy: list[str], max_records: int = 200) -> IngestionStats:
    settings = get_settings()
    now = datetime.now(timezone.utc)
    run_id = _create_run(mode="latest_seed", taxonomy=",".join(taxonomy), from_date=None, to_date=now)
    client = ArxivClient()

    records = list(client.fetch_latest_records(taxonomy=taxonomy, max_records=max_records))
    processed_entries = len(records)
    inserted_versions = 0
    updated_versions = 0

    try:
        for record in records:
            inserted, updated = _upsert_record(record)
            inserted_versions += int(inserted)
            updated_versions += int(updated)

        run_date = datetime.now(timezone.utc).date().isoformat()
        raw_path = settings.data_dir / "raw" / "arxiv" / run_date / f"{run_id}.records.jsonl.zst"
        write_raw_records_zst(raw_path, records)

        stats = IngestionStats(
            run_id=run_id,
            processed_entries=processed_entries,
            inserted_versions=inserted_versions,
            updated_versions=updated_versions,
            raw_records_path=raw_path,
        )
        _finish_run(run_id, stats=stats)
        return stats
    except Exception as exc:
        _finish_run(run_id, error=exc)
        raise
