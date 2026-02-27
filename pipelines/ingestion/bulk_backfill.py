from __future__ import annotations

import argparse
import json
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path

from pipelines.common.logging_utils import configure_logging, get_logger
from pipelines.ingestion.service import run_backfill

logger = get_logger(__name__)


@dataclass
class BulkRunResult:
    taxonomy: str
    from_date: str
    to_date: str
    status: str
    run_id: str | None
    processed_entries: int
    inserted_versions: int
    updated_versions: int
    raw_records_path: str | None
    error: str | None


def _year_windows(from_year: int, to_year: int) -> list[tuple[datetime, datetime]]:
    windows: list[tuple[datetime, datetime]] = []
    utc = timezone.utc
    now = datetime.now(utc)

    for year in range(from_year, to_year + 1):
        start = datetime(year, 1, 1, tzinfo=utc)
        end = datetime(year, 12, 31, 23, 59, 59, tzinfo=utc)
        if end > now:
            end = now
        windows.append((start, end))

    return windows


def _append_result(path: Path, result: BulkRunResult) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(asdict(result), ensure_ascii=True) + "\n")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run multi-year backfill by taxonomy")
    parser.add_argument("--from-year", type=int, default=2015)
    parser.add_argument("--to-year", type=int, default=datetime.now(timezone.utc).year)
    parser.add_argument("--taxonomy", default="cs,stat,physics")
    parser.add_argument("--log-path", default="logs/bulk_backfill_results.jsonl")
    parser.add_argument("--fail-fast", action="store_true", help="Stop on first failed window")
    return parser.parse_args()


def main() -> None:
    configure_logging()
    args = parse_args()

    taxonomies = [token.strip() for token in args.taxonomy.split(",") if token.strip()]
    windows = _year_windows(args.from_year, args.to_year)
    log_path = Path(args.log_path)

    logger.info("Starting bulk backfill taxonomies=%s years=%s-%s", taxonomies, args.from_year, args.to_year)

    for taxonomy in taxonomies:
        for from_dt, to_dt in windows:
            logger.info("Bulk backfill taxonomy=%s window=%s..%s", taxonomy, from_dt, to_dt)
            try:
                stats = run_backfill(from_date=from_dt, to_date=to_dt, taxonomy=[taxonomy])
                result = BulkRunResult(
                    taxonomy=taxonomy,
                    from_date=from_dt.isoformat(),
                    to_date=to_dt.isoformat(),
                    status="succeeded",
                    run_id=stats.run_id,
                    processed_entries=stats.processed_entries,
                    inserted_versions=stats.inserted_versions,
                    updated_versions=stats.updated_versions,
                    raw_records_path=str(stats.raw_records_path),
                    error=None,
                )
                _append_result(log_path, result)
            except Exception as exc:
                result = BulkRunResult(
                    taxonomy=taxonomy,
                    from_date=from_dt.isoformat(),
                    to_date=to_dt.isoformat(),
                    status="failed",
                    run_id=None,
                    processed_entries=0,
                    inserted_versions=0,
                    updated_versions=0,
                    raw_records_path=None,
                    error=str(exc),
                )
                _append_result(log_path, result)
                logger.exception("Failed taxonomy=%s window=%s..%s", taxonomy, from_dt, to_dt)
                if args.fail_fast:
                    raise


if __name__ == "__main__":
    main()
