from __future__ import annotations

import argparse

import sqlalchemy as sa

from pipelines.common.settings import get_settings


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Quality report for ingestion data")
    parser.add_argument("--top-categories", type=int, default=12)
    parser.add_argument("--year-limit", type=int, default=30)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    settings = get_settings()
    engine = sa.create_engine(settings.database_url)

    with engine.connect() as conn:
        checks: dict[str, str] = {
            "papers": "select count(*) from papers",
            "versions": "select count(*) from paper_versions",
            "categories_rows": "select count(*) from paper_categories",
            "dup_paper_version_id": (
                "select count(*) from ("
                "select paper_version_id from paper_versions "
                "group by paper_version_id having count(*)>1"
                ") t"
            ),
            "null_or_empty_abstract": (
                "select count(*) from paper_versions "
                "where abstract is null or btrim(abstract)=''"
            ),
            "null_or_empty_title": (
                "select count(*) from paper_versions "
                "where title is null or btrim(title)=''"
            ),
            "papers_without_category": (
                "select count(*) from papers p "
                "left join paper_categories pc on p.paper_id=pc.paper_id "
                "where pc.paper_id is null"
            ),
            "multi_version_papers": (
                "select count(*) from ("
                "select paper_id from paper_versions "
                "group by paper_id having count(*)>1"
                ") t"
            ),
        }

        print("=== Core checks ===")
        for name, query in checks.items():
            value = conn.execute(sa.text(query)).scalar_one()
            print(f"{name}: {value}")

        print("\n=== Top categories ===")
        top_categories = conn.execute(
            sa.text(
                """
                select category, count(*) as n
                from paper_categories
                group by category
                order by n desc
                limit :limit
                """
            ),
            {"limit": args.top_categories},
        ).fetchall()
        for row in top_categories:
            print(f"{row.category}: {row.n}")

        print("\n=== Year distribution ===")
        years = conn.execute(
            sa.text(
                """
                select extract(year from submitted_at)::int as year, count(*) as n
                from paper_versions
                group by year
                order by year
                limit :limit
                """
            ),
            {"limit": args.year_limit},
        ).fetchall()
        for row in years:
            print(f"{row.year}: {row.n}")

        print("\n=== Recent runs ===")
        runs = conn.execute(
            sa.text(
                """
                select run_id, mode, taxonomy, status, processed_entries,
                       inserted_versions, updated_versions, started_at, finished_at
                from ingestion_runs
                order by started_at desc
                limit 10
                """
            )
        ).fetchall()
        for row in runs:
            print(
                f"{row.run_id} {row.mode} {row.taxonomy} {row.status} "
                f"processed={row.processed_entries} inserted={row.inserted_versions} "
                f"updated={row.updated_versions} started={row.started_at} finished={row.finished_at}"
            )


if __name__ == "__main__":
    main()
