from __future__ import annotations

import argparse
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd
from sqlalchemy import and_, func, select

from pipelines.common.logging_utils import configure_logging
from pipelines.common.settings import get_settings
from pipelines.common.snapshot import build_snapshot_id
from pipelines.db.models import PaperCategory, PaperVersion, SnapshotManifest
from pipelines.db.session import session_scope
from pipelines.db.upsert import upsert_row
from pipelines.embeddings.manifest import SnapshotManifestPayload, shard_metadata, write_manifest


def _latest_versions(updated_since: datetime | None = None) -> list[PaperVersion]:
    latest_versions = (
        select(
            PaperVersion.paper_id.label("paper_id"),
            func.max(PaperVersion.version).label("max_version"),
        )
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
    if updated_since is not None:
        statement = statement.where(PaperVersion.updated_at >= updated_since)

    with session_scope() as session:
        return session.scalars(statement).all()


def _categories_by_paper(paper_ids: set[str] | None = None) -> dict[str, list[str]]:
    if paper_ids is not None and not paper_ids:
        return {}

    with session_scope() as session:
        statement = select(PaperCategory)
        if paper_ids is not None:
            statement = statement.where(PaperCategory.paper_id.in_(sorted(paper_ids)))
        categories = session.scalars(statement).all()

    mapped: dict[str, list[str]] = {}
    for category in categories:
        mapped.setdefault(category.paper_id, []).append(category.category)

    for paper_id, values in mapped.items():
        mapped[paper_id] = sorted(set(values))
    return mapped


def _taxonomy_filter(categories: list[str], tokens: list[str]) -> bool:
    for token in tokens:
        if any(value == token or value.startswith(f"{token}.") for value in categories):
            return True
    return False


def build_documents(
    taxonomy_tokens: list[str],
    updated_since: datetime | None = None,
) -> pd.DataFrame:
    versions = _latest_versions(updated_since=updated_since)
    categories_map = _categories_by_paper(
        paper_ids=({version.paper_id for version in versions} if updated_since is not None else None)
    )

    rows: list[dict[str, Any]] = []
    for version in versions:
        categories = categories_map.get(version.paper_id, [])
        if not _taxonomy_filter(categories, taxonomy_tokens):
            continue
        rows.append(
            {
                "doc_id": version.paper_version_id,
                "paper_id": version.paper_id,
                "paper_version_id": version.paper_version_id,
                "title": version.title,
                "abstract": version.abstract,
                "text": f"{version.title}\n\n{version.abstract}",
                "submitted_at": version.submitted_at.isoformat(),
                "year": version.submitted_at.year,
                "categories": categories,
            }
        )

    if not rows:
        return pd.DataFrame(
            columns=[
                "doc_id",
                "paper_id",
                "paper_version_id",
                "title",
                "abstract",
                "text",
                "submitted_at",
                "year",
                "categories",
            ]
        )

    return pd.DataFrame(rows).sort_values(["year", "doc_id"]).reset_index(drop=True)


def export_snapshot(
    snapshot_id: str,
    taxonomy: str,
    updated_since: datetime | None = None,
) -> Path:
    settings = get_settings()
    taxonomy_tokens = [token.strip() for token in taxonomy.split(",") if token.strip()]

    frame = build_documents(taxonomy_tokens, updated_since=updated_since)
    export_dir = settings.data_dir / "interim" / "exports" / snapshot_id
    export_dir.mkdir(parents=True, exist_ok=True)

    shards = []
    shard_size = settings.embedding_shard_size
    for idx in range(0, len(frame), shard_size):
        shard = frame.iloc[idx : idx + shard_size].copy()
        shard_name = f"documents_shard_{idx // shard_size:05d}.parquet"
        shard_path = export_dir / shard_name
        shard.to_parquet(shard_path, index=False)
        shards.append(shard_metadata(shard_path, rows=len(shard)))

    manifest = SnapshotManifestPayload(
        snapshot_id=snapshot_id,
        taxonomy=taxonomy,
        model_name=settings.embedding_model_name,
        model_version=settings.embedding_model_version,
        expected_dimension=settings.embedding_dimension,
        document_count=int(len(frame)),
        shard_size=shard_size,
        shards=shards,
    )

    manifest_path = export_dir / "manifest.json"
    write_manifest(manifest_path, manifest)

    with session_scope() as session:
        upsert_row(
            session=session,
            table=SnapshotManifest.__table__,
            values={
                "snapshot_id": snapshot_id,
                "taxonomy": taxonomy,
                "model_name": settings.embedding_model_name,
                "model_version": settings.embedding_model_version,
                "expected_dimension": settings.embedding_dimension,
                "export_manifest_path": str(manifest_path),
                "status": ("exported_empty" if len(frame) == 0 else "exported"),
                "document_count": int(len(frame)),
                "vector_count": 0,
                "aggregate_checksum": manifest.to_dict()["aggregate_checksum"],
            },
            conflict_columns=["snapshot_id"],
            update_columns=[
                "taxonomy",
                "model_name",
                "model_version",
                "expected_dimension",
                "export_manifest_path",
                "status",
                "document_count",
                "aggregate_checksum",
            ],
        )

    return manifest_path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Export text shards for Colab embeddings")
    parser.add_argument("--snapshot-id", default="", help="If omitted, generate from UTC timestamp")
    parser.add_argument("--taxonomy", default="")
    parser.add_argument(
        "--since",
        default="",
        help="UTC ISO datetime. Export only papers whose latest version was updated on/after this timestamp.",
    )
    return parser.parse_args()


def _parse_utc_datetime(value: str) -> datetime:
    dt = datetime.fromisoformat(value)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def main() -> None:
    configure_logging()
    settings = get_settings()
    args = parse_args()

    taxonomy = args.taxonomy or settings.taxonomy_default
    updated_since = _parse_utc_datetime(args.since) if args.since else None
    snapshot_id = (
        args.snapshot_id
        or build_snapshot_id(
            taxonomy=taxonomy,
            model_version=settings.embedding_model_version,
            now=datetime.now(timezone.utc),
        )
    )

    manifest_path = export_snapshot(
        snapshot_id=snapshot_id,
        taxonomy=taxonomy,
        updated_since=updated_since,
    )
    print(f"Export manifest created at: {manifest_path}")


if __name__ == "__main__":
    main()
