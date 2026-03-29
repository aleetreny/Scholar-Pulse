from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

from pipelines.common.hash_utils import deterministic_content_hash
from pipelines.ingestion.types import ArxivRecord, ParsedArxivId

_ARXIV_ID_RE = re.compile(r"(?P<base>[A-Za-z\-\.]+/\d{7}|\d{4}\.\d{4,5})(?:v(?P<version>\d+))?$")


def parse_arxiv_identifier(identifier: str) -> ParsedArxivId:
    clean = identifier.strip().rstrip("/")
    if "/abs/" in clean:
        clean = clean.split("/abs/", maxsplit=1)[1]
    if clean.startswith("arXiv:"):
        clean = clean.replace("arXiv:", "", 1)

    match = _ARXIV_ID_RE.search(clean)
    if not match:
        raise ValueError(f"Unable to parse arXiv identifier: {identifier}")

    base_id = match.group("base")
    version = int(match.group("version") or "1")
    return ParsedArxivId(base_id=base_id, version=version, paper_version_id=f"{base_id}v{version}")


def parse_timestamp(value: str) -> datetime:
    dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return dt.astimezone(timezone.utc)


def normalize_record(entry: dict[str, Any]) -> ArxivRecord:
    parsed_id = parse_arxiv_identifier(str(entry["id"]))
    categories = sorted({str(tag["term"]).strip() for tag in entry.get("tags", []) if "term" in tag})
    primary_category = None
    primary = entry.get("arxiv_primary_category")
    if isinstance(primary, dict):
        primary_value = str(primary.get("term", "")).strip()
        primary_category = primary_value or None
    elif isinstance(primary, str):
        primary_value = primary.strip()
        primary_category = primary_value or None

    author_entries = entry.get("authors", [])
    authors: list[str] = []
    if isinstance(author_entries, list):
        for item in author_entries:
            if isinstance(item, dict):
                name = str(item.get("name", "")).strip()
            else:
                name = str(item).strip()
            if name:
                authors.append(name)
    if not authors:
        fallback_author = str(entry.get("author", "")).strip()
        if fallback_author:
            authors = [fallback_author]

    title = " ".join(str(entry.get("title", "")).split())
    abstract = " ".join(str(entry.get("summary", "")).split())
    submitter = str(entry.get("arxiv_affiliation", "")).strip() or None
    comments = str(entry.get("arxiv_comment", "")).strip() or None
    journal_ref = str(entry.get("arxiv_journal_ref", "")).strip() or None
    doi = str(entry.get("arxiv_doi", "")).strip() or None

    published = parse_timestamp(str(entry["published"]))
    updated = parse_timestamp(str(entry.get("updated", entry["published"])))

    return ArxivRecord(
        paper_id=parsed_id.base_id,
        paper_version_id=parsed_id.paper_version_id,
        version=parsed_id.version,
        title=title,
        abstract=abstract,
        submitted_at=published,
        updated_at=updated,
        categories=categories,
        authors=authors,
        raw=entry,
        submitter=submitter,
        comments=comments,
        journal_ref=journal_ref,
        doi=doi,
        primary_category=primary_category,
    )


def compute_record_hash(record: ArxivRecord) -> str:
    return deterministic_content_hash(record.title, record.abstract, record.categories)


def taxonomy_to_arxiv_query(taxonomy: list[str], from_dt: datetime, to_dt: datetime) -> str:
    category_query = taxonomy_to_category_query(taxonomy)
    from_token = from_dt.strftime("%Y%m%d%H%M%S")
    to_token = to_dt.strftime("%Y%m%d%H%M%S")
    return f"({category_query}) AND submittedDate:[{from_token} TO {to_token}]"


def taxonomy_to_category_query(taxonomy: list[str]) -> str:
    normalized = []
    for token in taxonomy:
        token = token.strip()
        if not token:
            continue
        if "." in token:
            normalized.append(f"cat:{token}")
        else:
            normalized.append(f"cat:{token}.*")

    if not normalized:
        raise ValueError("Empty taxonomy after normalization")

    return " OR ".join(normalized)
