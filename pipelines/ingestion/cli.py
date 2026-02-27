from __future__ import annotations

import argparse
from datetime import datetime, timezone

from pipelines.common.logging_utils import configure_logging
from pipelines.common.settings import get_settings
from pipelines.db.base import Base
from pipelines.db.session import get_engine
from pipelines.ingestion.kaggle_import import _resolve_metadata_path, run_kaggle_bootstrap
from pipelines.ingestion.service import run_backfill, run_incremental, run_latest_seed


def parse_utc_date(value: str) -> datetime:
    dt = datetime.fromisoformat(value)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="ScholarPulse ingestion CLI")
    subparsers = parser.add_subparsers(dest="command", required=True)

    init_db = subparsers.add_parser("init-db", help="Create database schema (bootstrap)")
    init_db.set_defaults(command="init-db")

    backfill = subparsers.add_parser("backfill", help="Run historical backfill")
    backfill.add_argument("--from", dest="from_date", default="2015-01-01T00:00:00+00:00")
    backfill.add_argument("--to", dest="to_date", default=datetime.now(timezone.utc).isoformat())
    backfill.add_argument("--taxonomy", default="")
    backfill.add_argument("--max-records", type=int, default=0)

    incremental = subparsers.add_parser("incremental", help="Run incremental ingestion")
    incremental.add_argument("--as-of", dest="as_of", default=datetime.now(timezone.utc).isoformat())
    incremental.add_argument("--taxonomy", default="")
    incremental.add_argument("--max-records", type=int, default=0)

    latest = subparsers.add_parser("latest", help="Seed latest papers without date window")
    latest.add_argument("--taxonomy", default="")
    latest.add_argument("--max-records", type=int, default=200)

    kaggle = subparsers.add_parser(
        "kaggle-bootstrap",
        help="Bootstrap ingestion from Kaggle arXiv metadata (faster historical load)",
    )
    kaggle.add_argument("--dataset", default="Cornell-University/arxiv")
    kaggle.add_argument(
        "--source-path",
        default="",
        help="Path to local metadata file or directory. If omitted, download via kagglehub.",
    )
    kaggle.add_argument("--taxonomy", default="")
    kaggle.add_argument("--from-year", type=int, default=1991)
    kaggle.add_argument("--to-year", type=int, default=datetime.now(timezone.utc).year)
    kaggle.add_argument("--max-records", type=int, default=0)
    kaggle.add_argument("--commit-every", type=int, default=2000)
    kaggle.add_argument("--show-path-only", action="store_true")

    return parser


def main() -> None:
    configure_logging()
    settings = get_settings()

    parser = _parser()
    args = parser.parse_args()

    if args.command == "init-db":
        Base.metadata.create_all(get_engine())
        print("Database schema initialized.")
        return

    taxonomy = (
        [token.strip() for token in args.taxonomy.split(",") if token.strip()]
        if args.taxonomy
        else settings.taxonomy_tokens
    )

    if args.command == "backfill":
        stats = run_backfill(
            from_date=parse_utc_date(args.from_date),
            to_date=parse_utc_date(args.to_date),
            taxonomy=taxonomy,
            max_records=args.max_records if args.max_records > 0 else None,
        )
        print(
            f"Backfill completed run_id={stats.run_id} processed={stats.processed_entries} "
            f"inserted_versions={stats.inserted_versions} updated_versions={stats.updated_versions}"
        )
        return

    if args.command == "incremental":
        stats = run_incremental(
            as_of=parse_utc_date(args.as_of),
            taxonomy=taxonomy,
            max_records=args.max_records if args.max_records > 0 else None,
        )
        print(
            f"Incremental completed run_id={stats.run_id} processed={stats.processed_entries} "
            f"inserted_versions={stats.inserted_versions} updated_versions={stats.updated_versions}"
        )
        return

    if args.command == "latest":
        stats = run_latest_seed(
            taxonomy=taxonomy,
            max_records=max(args.max_records, 1),
        )
        print(
            f"Latest seed completed run_id={stats.run_id} processed={stats.processed_entries} "
            f"inserted_versions={stats.inserted_versions} updated_versions={stats.updated_versions}"
        )
        return

    if args.command == "kaggle-bootstrap":
        metadata_path = _resolve_metadata_path(args.source_path, args.dataset)
        if args.show_path_only:
            print(f"Resolved metadata path: {metadata_path}")
            return

        stats = run_kaggle_bootstrap(
            metadata_path=metadata_path,
            taxonomy_tokens=taxonomy,
            from_year=args.from_year,
            to_year=args.to_year,
            max_records=(args.max_records if args.max_records > 0 else None),
            commit_every=max(args.commit_every, 100),
        )
        print(
            f"Kaggle bootstrap completed run_id={stats.run_id} processed={stats.processed_entries} "
            f"inserted_versions={stats.inserted_versions} updated_versions={stats.updated_versions} "
            f"source={stats.raw_records_path}"
        )
        return

    parser.error("Unknown command")


if __name__ == "__main__":
    main()
