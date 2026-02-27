from __future__ import annotations

import argparse
import time
from datetime import datetime, timezone

import sqlalchemy as sa

from pipelines.common.settings import get_settings


# Rough upper-bound estimate used only for a ballpark % readout.
ARXIV_TOTALS_ESTIMATE = {
    "cs": 755_710,
    "stat": 112_859,
    "physics": 214_433,
}


def _print_snapshot(engine: sa.Engine, baseline_count: int, baseline_ts: datetime) -> tuple[int, datetime]:
    now = datetime.now(timezone.utc)
    with engine.connect() as conn:
        papers = int(conn.execute(sa.text("select count(*) from papers")).scalar_one())
        running = conn.execute(
            sa.text(
                """
                select run_id, mode, taxonomy, from_date, to_date, started_at
                from ingestion_runs
                where status='running'
                order by started_at desc
                limit 1
                """
            )
        ).fetchone()
        recent = conn.execute(
            sa.text(
                """
                select taxonomy, from_date, to_date, processed_entries, inserted_versions, finished_at
                from ingestion_runs
                where status='succeeded' and mode in ('backfill', 'kaggle_bootstrap')
                order by finished_at desc
                limit 3
                """
            )
        ).fetchall()

    elapsed = max((now - baseline_ts).total_seconds(), 1.0)
    delta = papers - baseline_count
    rate = delta / elapsed

    est_total = sum(ARXIV_TOTALS_ESTIMATE.values())
    pct = (papers / est_total) * 100 if est_total > 0 else 0.0

    print("=" * 72)
    print(f"UTC: {now.isoformat()}")
    print(f"papers={papers:,}  est_total_rough={est_total:,}  progress~={pct:.2f}%")
    print(f"rate_since_start~={rate:.2f} papers/sec")

    if running:
        print(
            "running:",
            f"run_id={running.run_id}",
            f"mode={running.mode}",
            f"taxonomy={running.taxonomy}",
            f"window={running.from_date}..{running.to_date}",
            f"started_at={running.started_at}",
        )
    else:
        print("running: none")

    if recent:
        print("recent succeeded windows:")
        for row in recent:
            print(
                f"  - {row.taxonomy} {row.from_date}..{row.to_date} "
                f"processed={row.processed_entries} inserted={row.inserted_versions} finished={row.finished_at}"
            )

    return papers, now


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Live progress monitor for ScholarPulse ingestion")
    parser.add_argument("--watch", action="store_true", help="Refresh continuously")
    parser.add_argument("--interval", type=int, default=20, help="Refresh interval in seconds")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    settings = get_settings()
    engine = sa.create_engine(settings.database_url)

    baseline_ts = datetime.now(timezone.utc)
    with engine.connect() as conn:
        baseline_count = int(conn.execute(sa.text("select count(*) from papers")).scalar_one())

    if not args.watch:
        _print_snapshot(engine, baseline_count, baseline_ts)
        return

    while True:
        _print_snapshot(engine, baseline_count, baseline_ts)
        time.sleep(args.interval)


if __name__ == "__main__":
    main()
