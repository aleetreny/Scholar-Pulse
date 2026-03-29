from __future__ import annotations

import argparse
import gzip
import json
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any, Iterator
from uuid import uuid4

from sqlalchemy.orm import Session

from pipelines.common.logging_utils import configure_logging, get_logger
from pipelines.db.models import IngestionRun
from pipelines.db.session import get_session_factory, session_scope
from pipelines.ingestion.service import IngestionStats, _upsert_record
from pipelines.ingestion.types import ArxivRecord

logger = get_logger(__name__)


def _create_run(taxonomy_text: str, from_year: int, to_year: int, source_path: Path) -> str:
    run_id = uuid4().hex
    from_date = datetime(from_year, 1, 1, tzinfo=timezone.utc)
    to_date = datetime(to_year, 12, 31, 23, 59, 59, tzinfo=timezone.utc)

    with session_scope() as session:
        session.add(
            IngestionRun(
                run_id=run_id,
                mode="kaggle_bootstrap",
                taxonomy=taxonomy_text,
                from_date=from_date,
                to_date=to_date,
                status="running",
                raw_records_path=str(source_path),
            )
        )
    return run_id


def _heartbeat_run(run_id: str, processed_entries: int, inserted_versions: int, updated_versions: int) -> None:
    with session_scope() as session:
        run = session.get(IngestionRun, run_id)
        if run is None:
            return
        run.processed_entries = processed_entries
        run.inserted_versions = inserted_versions
        run.updated_versions = updated_versions


def _finish_run(run_id: str, stats: IngestionStats | None = None, error: BaseException | None = None) -> None:
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



def _normalize_paper_id(raw_id: str) -> str:
    clean = raw_id.strip()
    if clean.startswith("arXiv:"):
        clean = clean.replace("arXiv:", "", 1)
    if "v" in clean and clean.rsplit("v", 1)[-1].isdigit():
        return clean.rsplit("v", 1)[0]
    return clean



def _parse_version_number(version_text: str) -> int:
    text = version_text.strip().lower()
    if text.startswith("v") and text[1:].isdigit():
        return int(text[1:])
    if text.isdigit():
        return int(text)
    raise ValueError(f"Invalid version marker: {version_text}")



def _parse_dt(value: str) -> datetime | None:
    value = value.strip()
    if not value:
        return None

    try:
        dt = parsedate_to_datetime(value)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        pass

    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        return None



def _taxonomy_match(categories: list[str], taxonomy_tokens: list[str]) -> bool:
    if not taxonomy_tokens:
        return True
    for token in taxonomy_tokens:
        if any(cat == token or cat.startswith(f"{token}.") for cat in categories):
            return True
    return False


def _parse_authors(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]

    text = str(value).strip()
    if not text:
        return []

    if text.startswith("[") and text.endswith("]"):
        try:
            parsed = json.loads(text)
            if isinstance(parsed, list):
                return [str(item).strip() for item in parsed if str(item).strip()]
        except json.JSONDecodeError:
            pass

    return [item.strip() for item in text.split(",") if item.strip()]


def _iter_json_lines(path: Path) -> Iterator[dict[str, Any]]:
    opener = gzip.open if path.suffix == ".gz" else open
    with opener(path, "rt", encoding="utf-8", errors="replace") as handle:
        for line in handle:
            text = line.strip()
            if not text or text in {"[", "]"}:
                continue
            if text.endswith(","):
                text = text[:-1]
            if not text:
                continue
            yield json.loads(text)



def _resolve_metadata_path(source_path: str, dataset_slug: str) -> Path:
    if source_path:
        path = Path(source_path)
        if path.is_dir():
            candidates = _discover_metadata_files(path)
            if not candidates:
                raise FileNotFoundError(f"No metadata json file found in {path}")
            return candidates[0]
        if not path.exists():
            raise FileNotFoundError(f"Path does not exist: {path}")
        return path

    try:
        import kagglehub  # type: ignore[import-not-found]
    except ImportError as exc:
        raise RuntimeError(
            "kagglehub is not installed. Run: python3 -m pip install 'kagglehub[pandas-datasets]'"
        ) from exc

    download_dir = Path(kagglehub.dataset_download(dataset_slug))
    candidates = _discover_metadata_files(download_dir)
    if not candidates:
        raise FileNotFoundError(f"No metadata json file found under downloaded path: {download_dir}")
    return candidates[0]



def _discover_metadata_files(root: Path) -> list[Path]:
    priority_names = [
        "arxiv-metadata-oai-snapshot.json",
        "arxiv-metadata-oai-snapshot.jsonl",
        "arxiv-metadata-oai-snapshot.json.gz",
        "arxiv-metadata-oai-snapshot.jsonl.gz",
    ]

    found: list[Path] = []
    for name in priority_names:
        candidate = root / name
        if candidate.exists() and candidate.is_file():
            found.append(candidate)

    if found:
        return found

    patterns = ["*.json", "*.jsonl", "*.json.gz", "*.jsonl.gz"]
    for pattern in patterns:
        for candidate in root.rglob(pattern):
            lower = candidate.name.lower()
            if "arxiv" in lower and "metadata" in lower:
                found.append(candidate)

    return sorted(found)



def run_kaggle_bootstrap(
    metadata_path: Path,
    taxonomy_tokens: list[str],
    from_year: int,
    to_year: int,
    max_records: int | None,
    commit_every: int,
) -> IngestionStats:
    taxonomy_text = ",".join(taxonomy_tokens) if taxonomy_tokens else "all"
    run_id = _create_run(taxonomy_text=taxonomy_text, from_year=from_year, to_year=to_year, source_path=metadata_path)

    processed_entries = 0
    inserted_versions = 0
    updated_versions = 0
    seen_papers = 0
    accepted_papers = 0

    session_factory = get_session_factory()
    session: Session = session_factory()

    try:
        for paper in _iter_json_lines(metadata_path):
            seen_papers += 1
            raw_id = str(paper.get("id", "")).strip()
            if not raw_id:
                continue

            paper_id = _normalize_paper_id(raw_id)
            title = " ".join(str(paper.get("title", "")).split())
            abstract = " ".join(str(paper.get("abstract", "")).split())
            if not title or not abstract:
                continue

            categories_text = str(paper.get("categories", "")).strip()
            categories = sorted({item.strip() for item in categories_text.split() if item.strip()})
            if not categories:
                continue
            if not _taxonomy_match(categories, taxonomy_tokens):
                continue
            primary_category = categories[0]

            authors = _parse_authors(paper.get("authors", ""))
            submitter = str(paper.get("submitter", "")).strip() or None
            comments = str(paper.get("comments", "")).strip() or None
            journal_ref = str(paper.get("journal-ref", "")).strip() or None
            doi = str(paper.get("doi", "")).strip() or None

            versions_raw = paper.get("versions", [])
            parsed_versions: list[tuple[int, str, datetime]] = []
            if isinstance(versions_raw, list):
                for item in versions_raw:
                    if not isinstance(item, dict):
                        continue
                    marker = str(item.get("version", "")).strip()
                    created = _parse_dt(str(item.get("created", "")).strip())
                    if not marker or created is None:
                        continue
                    try:
                        number = _parse_version_number(marker)
                    except ValueError:
                        continue
                    parsed_versions.append((number, marker, created))

            if not parsed_versions:
                continue

            parsed_versions.sort(key=lambda tup: tup[0])
            first_year = parsed_versions[0][2].year
            if first_year < from_year or first_year > to_year:
                continue

            accepted_papers += 1
            for version_number, version_marker, version_dt in parsed_versions:
                record = ArxivRecord(
                    paper_id=paper_id,
                    paper_version_id=f"{paper_id}{version_marker}",
                    version=version_number,
                    title=title,
                    abstract=abstract,
                    submitted_at=version_dt,
                    updated_at=version_dt,
                    categories=categories,
                    authors=authors,
                    raw=paper,
                    submitter=submitter,
                    comments=comments,
                    journal_ref=journal_ref,
                    doi=doi,
                    primary_category=primary_category,
                )
                inserted, updated = _upsert_record(session, record)
                processed_entries += 1
                inserted_versions += int(inserted)
                updated_versions += int(updated)

                if processed_entries % commit_every == 0:
                    session.commit()
                    _heartbeat_run(run_id, processed_entries, inserted_versions, updated_versions)
                    logger.info(
                        "Kaggle bootstrap progress run_id=%s papers_seen=%s papers_accepted=%s versions_processed=%s inserted=%s updated=%s",
                        run_id,
                        seen_papers,
                        accepted_papers,
                        processed_entries,
                        inserted_versions,
                        updated_versions,
                    )

                if max_records is not None and processed_entries >= max_records:
                    break

            if max_records is not None and processed_entries >= max_records:
                break

        session.commit()

        stats = IngestionStats(
            run_id=run_id,
            processed_entries=processed_entries,
            inserted_versions=inserted_versions,
            updated_versions=updated_versions,
            raw_records_path=metadata_path,
        )
        _finish_run(run_id, stats=stats)
        return stats
    except BaseException as exc:
        session.rollback()
        _finish_run(run_id, error=exc)
        raise
    finally:
        session.close()



def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Kaggle arXiv metadata bootstrap importer")
    parser.add_argument("--dataset", default="Cornell-University/arxiv")
    parser.add_argument(
        "--source-path",
        default="",
        help="Path to metadata json/jsonl(.gz). If omitted, it downloads from KaggleHub dataset.",
    )
    parser.add_argument("--taxonomy", default="cs,stat,physics")
    parser.add_argument("--from-year", type=int, default=1991)
    parser.add_argument("--to-year", type=int, default=datetime.now(timezone.utc).year)
    parser.add_argument("--max-records", type=int, default=0)
    parser.add_argument("--commit-every", type=int, default=2000)
    parser.add_argument(
        "--show-path-only",
        action="store_true",
        help="Only resolve and print the metadata path (no import).",
    )
    return parser.parse_args()



def main() -> None:
    configure_logging()
    args = parse_args()

    taxonomy_tokens = [token.strip() for token in args.taxonomy.split(",") if token.strip()]
    metadata_path = _resolve_metadata_path(args.source_path, args.dataset)

    if args.show_path_only:
        print(f"Resolved metadata path: {metadata_path}")
        return

    stats = run_kaggle_bootstrap(
        metadata_path=metadata_path,
        taxonomy_tokens=taxonomy_tokens,
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


if __name__ == "__main__":
    main()
