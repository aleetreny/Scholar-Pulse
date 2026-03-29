from __future__ import annotations

import argparse
import hashlib
import json
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

import pandas as pd
import requests
from sqlalchemy import and_, func, select

from pipelines.common.logging_utils import configure_logging
from pipelines.common.settings import get_settings
from pipelines.db.models import (
    PaperExternalId,
    PaperMetricEnriched,
    PaperSourceRaw,
    PaperVersion,
)
from pipelines.db.session import session_scope
from pipelines.db.upsert import upsert_row


@dataclass(frozen=True)
class PaperCandidate:
    paper_id: str
    doi: str | None
    submitted_at: datetime


@dataclass(frozen=True)
class SyncResult:
    snapshot_id: str
    selected_papers: int
    processed_papers: int
    updated_records: int
    failed_requests: int


def _load_snapshot_papers(snapshot_id: str) -> list[str]:
    settings = get_settings()
    exports_dir = settings.data_dir / "interim" / "exports" / snapshot_id
    if not exports_dir.exists():
        raise FileNotFoundError(f"Snapshot exports not found: {exports_dir}")

    paper_ids: set[str] = set()
    for shard in sorted(exports_dir.glob("documents_shard_*.parquet")):
        frame = pd.read_parquet(shard, columns=["paper_id"])
        if frame.empty:
            continue
        paper_ids.update(frame["paper_id"].astype(str).tolist())
    return sorted(paper_ids)


def _latest_versions(paper_ids: list[str]) -> list[PaperCandidate]:
    if not paper_ids:
        return []

    chunk_size = 5000
    versions: list[PaperVersion] = []
    with session_scope() as session:
        for start in range(0, len(paper_ids), chunk_size):
            chunk = paper_ids[start : start + chunk_size]
            latest_versions = (
                select(
                    PaperVersion.paper_id.label("paper_id"),
                    func.max(PaperVersion.version).label("max_version"),
                )
                .where(PaperVersion.paper_id.in_(chunk))
                .group_by(PaperVersion.paper_id)
                .subquery()
            )

            statement = (
                select(PaperVersion)
                .join(
                    latest_versions,
                    and_(
                        PaperVersion.paper_id == latest_versions.c.paper_id,
                        PaperVersion.version == latest_versions.c.max_version,
                    ),
                )
                .order_by(PaperVersion.paper_id)
            )
            versions.extend(session.scalars(statement).all())

    return [
        PaperCandidate(
            paper_id=version.paper_id,
            doi=version.doi,
            submitted_at=version.submitted_at,
        )
        for version in versions
    ]


def _latest_versions_recent(limit: int, horizon_days: int = 120) -> list[PaperCandidate]:
    cutoff = datetime.now(timezone.utc) - timedelta(days=max(horizon_days, 1))
    scan_limit = max(limit * 80, 8000)
    statement = (
        select(PaperVersion)
        .where(PaperVersion.submitted_at >= cutoff)
        .order_by(PaperVersion.submitted_at.desc())
        .limit(scan_limit)
    )
    with session_scope() as session:
        versions = session.scalars(statement).all()

    seen: set[str] = set()
    candidates: list[PaperCandidate] = []
    for version in versions:
        if version.paper_id in seen:
            continue
        seen.add(version.paper_id)
        candidates.append(
            PaperCandidate(
                paper_id=version.paper_id,
                doi=version.doi,
                submitted_at=version.submitted_at,
            )
        )
        if len(candidates) >= limit:
            break
    return candidates


def _recently_enriched_papers(source: str, horizon_days: int) -> set[str]:
    cutoff = datetime.now(timezone.utc) - timedelta(days=max(horizon_days, 1))
    with session_scope() as session:
        rows = session.execute(
            select(PaperMetricEnriched.paper_id).where(
                PaperMetricEnriched.source == source,
                PaperMetricEnriched.updated_at >= cutoff,
            )
        ).scalars()
        return {str(value) for value in rows}


def _payload_hash(payload: Any) -> str:
    return hashlib.sha256(json.dumps(payload, ensure_ascii=True, sort_keys=True).encode("utf-8")).hexdigest()


def _store_raw(paper_id: str, source: str, payload: Any, status: str, error_message: str | None) -> None:
    fetched_at = datetime.now(timezone.utc)
    hashed = _payload_hash(payload)
    with session_scope() as session:
        upsert_row(
            session=session,
            table=PaperSourceRaw.__table__,
            values={
                "paper_id": paper_id,
                "source": source,
                "fetched_at": fetched_at,
                "payload_json": payload,
                "payload_hash": hashed,
                "status": status,
                "error_message": error_message,
            },
            conflict_columns=["paper_id", "source", "payload_hash"],
            update_columns=["fetched_at", "payload_json", "status", "error_message"],
        )


def _upsert_external_ids(
    *,
    paper_id: str,
    doi: str | None,
    openalex_id: str | None,
    s2_id: str | None,
    crossref_doi: str | None,
) -> None:
    with session_scope() as session:
        upsert_row(
            session=session,
            table=PaperExternalId.__table__,
            values={
                "paper_id": paper_id,
                "doi": doi,
                "openalex_id": openalex_id,
                "s2_id": s2_id,
                "crossref_doi": crossref_doi,
            },
            conflict_columns=["paper_id"],
            update_columns=["doi", "openalex_id", "s2_id", "crossref_doi"],
        )


def _upsert_metrics(
    *,
    paper_id: str,
    source: str,
    citation_count: int | None,
    reference_count: int | None,
    influential_citation_count: int | None,
    venue: str | None,
    publication_type: str | None,
) -> None:
    with session_scope() as session:
        upsert_row(
            session=session,
            table=PaperMetricEnriched.__table__,
            values={
                "paper_id": paper_id,
                "source": source,
                "citation_count": citation_count,
                "reference_count": reference_count,
                "influential_citation_count": influential_citation_count,
                "venue": venue,
                "publication_type": publication_type,
            },
            conflict_columns=["paper_id", "source"],
            update_columns=[
                "citation_count",
                "reference_count",
                "influential_citation_count",
                "venue",
                "publication_type",
            ],
        )


def _request_json(session: requests.Session, url: str, timeout: int) -> dict[str, Any]:
    response = session.get(url, timeout=timeout)
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, dict):
        raise RuntimeError("Unexpected JSON payload")
    return payload


def _sync_semantic_scholar(http: requests.Session, paper_id: str, timeout: int) -> tuple[bool, str | None]:
    url = (
        f"https://api.semanticscholar.org/graph/v1/paper/ARXIV:{paper_id}"
        "?fields=paperId,citationCount,referenceCount,influentialCitationCount,venue,publicationTypes"
    )
    payload: dict[str, Any] = {}
    try:
        payload = _request_json(http, url, timeout=timeout)
        _store_raw(paper_id, "s2", payload, status="ok", error_message=None)

        s2_id = str(payload.get("paperId", "")).strip() or None
        _upsert_external_ids(
            paper_id=paper_id,
            doi=None,
            openalex_id=None,
            s2_id=s2_id,
            crossref_doi=None,
        )
        pub_types = payload.get("publicationTypes")
        publication_type = None
        if isinstance(pub_types, list) and pub_types:
            publication_type = str(pub_types[0]).strip() or None

        _upsert_metrics(
            paper_id=paper_id,
            source="s2",
            citation_count=(int(payload["citationCount"]) if payload.get("citationCount") is not None else None),
            reference_count=(int(payload["referenceCount"]) if payload.get("referenceCount") is not None else None),
            influential_citation_count=(
                int(payload["influentialCitationCount"])
                if payload.get("influentialCitationCount") is not None
                else None
            ),
            venue=(str(payload.get("venue", "")).strip() or None),
            publication_type=publication_type,
        )
        return True, None
    except Exception as exc:
        _store_raw(paper_id, "s2", payload or {"url": url}, status="error", error_message=str(exc))
        return False, str(exc)


def _sync_openalex(http: requests.Session, paper_id: str, doi: str | None, timeout: int) -> tuple[bool, str | None]:
    if doi:
        normalized_doi = doi.lower().replace("https://doi.org/", "").replace("http://doi.org/", "")
        url = f"https://api.openalex.org/works/https://doi.org/{normalized_doi}"
    else:
        url = f"https://api.openalex.org/works?filter=ids.openalex:ARXIV:{paper_id}"

    payload: dict[str, Any] = {}
    try:
        payload = _request_json(http, url, timeout=timeout)
        work = payload
        if "results" in payload and isinstance(payload["results"], list):
            if not payload["results"]:
                raise RuntimeError("OpenAlex returned no results")
            first = payload["results"][0]
            if not isinstance(first, dict):
                raise RuntimeError("OpenAlex invalid result shape")
            work = first

        _store_raw(paper_id, "openalex", work, status="ok", error_message=None)

        openalex_id = str(work.get("id", "")).strip() or None
        cited_by = work.get("cited_by_count")
        refs = work.get("referenced_works_count")

        _upsert_external_ids(
            paper_id=paper_id,
            doi=doi,
            openalex_id=openalex_id,
            s2_id=None,
            crossref_doi=doi,
        )
        _upsert_metrics(
            paper_id=paper_id,
            source="openalex",
            citation_count=(int(cited_by) if cited_by is not None else None),
            reference_count=(int(refs) if refs is not None else None),
            influential_citation_count=None,
            venue=(str(work.get("primary_location", {}).get("source", {}).get("display_name", "")).strip() or None),
            publication_type=(str(work.get("type", "")).strip() or None),
        )
        return True, None
    except Exception as exc:
        _store_raw(paper_id, "openalex", payload or {"url": url}, status="error", error_message=str(exc))
        return False, str(exc)


def _sync_crossref(http: requests.Session, paper_id: str, doi: str | None, timeout: int) -> tuple[bool, str | None]:
    if not doi:
        return True, None
    normalized_doi = doi.lower().replace("https://doi.org/", "").replace("http://doi.org/", "")
    url = f"https://api.crossref.org/works/{normalized_doi}"

    payload: dict[str, Any] = {}
    try:
        payload = _request_json(http, url, timeout=timeout)
        message = payload.get("message", {})
        if not isinstance(message, dict):
            raise RuntimeError("Crossref invalid payload")

        _store_raw(paper_id, "crossref", message, status="ok", error_message=None)

        refs = message.get("reference-count")
        citations = message.get("is-referenced-by-count")
        container_title = message.get("container-title")
        venue = None
        if isinstance(container_title, list) and container_title:
            venue = str(container_title[0]).strip() or None

        _upsert_external_ids(
            paper_id=paper_id,
            doi=doi,
            openalex_id=None,
            s2_id=None,
            crossref_doi=normalized_doi,
        )
        _upsert_metrics(
            paper_id=paper_id,
            source="crossref",
            citation_count=(int(citations) if citations is not None else None),
            reference_count=(int(refs) if refs is not None else None),
            influential_citation_count=None,
            venue=venue,
            publication_type=(str(message.get("type", "")).strip() or None),
        )
        return True, None
    except Exception as exc:
        _store_raw(paper_id, "crossref", payload or {"url": url}, status="error", error_message=str(exc))
        return False, str(exc)


def run_sync(
    *,
    snapshot_id: str,
    sources: list[str],
    mode: str,
    max_papers: int,
) -> SyncResult:
    settings = get_settings()
    if mode == "incremental" and max_papers > 0:
        prefetch = max(max_papers * 40, 4000)
        candidates = _latest_versions_recent(limit=prefetch)
        papers_in_scope = len(candidates)
    else:
        paper_ids = _load_snapshot_papers(snapshot_id)
        candidates = _latest_versions(paper_ids)
        papers_in_scope = len(paper_ids)
    candidates = sorted(candidates, key=lambda value: value.submitted_at, reverse=True)
    print(
        f"Enrichment candidate pool snapshot={snapshot_id} papers_in_scope={papers_in_scope} latest_candidates={len(candidates)}",
        flush=True,
    )

    if mode == "incremental":
        enriched_by_source = {
            source: _recently_enriched_papers(source=source, horizon_days=7) for source in sources
        }
        filtered: list[PaperCandidate] = []
        for candidate in candidates:
            if any(
                candidate.paper_id not in enriched_by_source.get(source, set())
                for source in sources
            ):
                filtered.append(candidate)
            if max_papers > 0 and len(filtered) >= max_papers:
                break
        candidates = filtered

    if max_papers > 0:
        candidates = candidates[:max_papers]
    print(
        f"Enrichment run scope snapshot={snapshot_id} mode={mode} sources={','.join(sources)} selected={len(candidates)}",
        flush=True,
    )

    headers = {"User-Agent": "ScholarPulse/0.1 enrichment"}
    http = requests.Session()
    http.headers.update(headers)

    processed = 0
    updated = 0
    failed = 0

    for candidate in candidates:
        processed += 1
        for source in sources:
            if source == "s2":
                ok, _ = _sync_semantic_scholar(
                    http=http,
                    paper_id=candidate.paper_id,
                    timeout=settings.enrichment_timeout_seconds,
                )
            elif source == "openalex":
                ok, _ = _sync_openalex(
                    http=http,
                    paper_id=candidate.paper_id,
                    doi=candidate.doi,
                    timeout=settings.enrichment_timeout_seconds,
                )
            elif source == "crossref":
                ok, _ = _sync_crossref(
                    http=http,
                    paper_id=candidate.paper_id,
                    doi=candidate.doi,
                    timeout=settings.enrichment_timeout_seconds,
                )
            else:
                continue

            if ok:
                updated += 1
            else:
                failed += 1

            time.sleep(0.05)

        if processed % 25 == 0 or processed == len(candidates):
            print(
                f"Enrichment progress snapshot={snapshot_id} processed={processed}/{len(candidates)} updated={updated} failed={failed}",
                flush=True,
            )

    return SyncResult(
        snapshot_id=snapshot_id,
        selected_papers=len(candidates),
        processed_papers=processed,
        updated_records=updated,
        failed_requests=failed,
    )


def parse_args() -> argparse.Namespace:
    settings = get_settings()
    parser = argparse.ArgumentParser(description="Sync enrichment signals from external sources")
    parser.add_argument("--snapshot-id", required=True)
    parser.add_argument("--sources", default="openalex,s2,crossref")
    parser.add_argument("--mode", choices=["incremental", "full"], default="incremental")
    parser.add_argument("--max-papers", type=int, default=settings.enrichment_batch_size)
    return parser.parse_args()


def main() -> None:
    configure_logging()
    args = parse_args()
    sources = [token.strip() for token in args.sources.split(",") if token.strip()]
    result = run_sync(
        snapshot_id=args.snapshot_id,
        sources=sources,
        mode=args.mode,
        max_papers=max(args.max_papers, 0),
    )
    print(
        f"Enrichment synced snapshot={result.snapshot_id} selected={result.selected_papers} "
        f"processed={result.processed_papers} updated={result.updated_records} failed={result.failed_requests}"
    )


if __name__ == "__main__":
    main()
