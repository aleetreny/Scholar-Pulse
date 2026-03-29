from __future__ import annotations

from datetime import date, datetime
from typing import Any

from sqlalchemy import (
    JSON,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from pipelines.db.base import Base


class Paper(Base):
    __tablename__ = "papers"

    paper_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    versions: Mapped[list["PaperVersion"]] = relationship(back_populates="paper", cascade="all, delete")
    categories: Mapped[list["PaperCategory"]] = relationship(
        back_populates="paper", cascade="all, delete"
    )


class PaperVersion(Base):
    __tablename__ = "paper_versions"
    __table_args__ = (
        UniqueConstraint("paper_version_id", name="uq_paper_versions_paper_version_id"),
        Index("ix_paper_versions_paper_id", "paper_id"),
        Index("ix_paper_versions_updated_at", "updated_at"),
        Index("ix_paper_versions_submitted_at", "submitted_at"),
        Index("ix_paper_versions_doi", "doi"),
        Index("ix_paper_versions_primary_category", "primary_category"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    paper_id: Mapped[str] = mapped_column(String(64), ForeignKey("papers.paper_id", ondelete="CASCADE"))
    paper_version_id: Mapped[str] = mapped_column(String(72), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False)

    title: Mapped[str] = mapped_column(Text, nullable=False)
    abstract: Mapped[str] = mapped_column(Text, nullable=False)
    authors_raw: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    submitter: Mapped[str | None] = mapped_column(Text, nullable=True)
    comments: Mapped[str | None] = mapped_column(Text, nullable=True)
    journal_ref: Mapped[str | None] = mapped_column(Text, nullable=True)
    doi: Mapped[str | None] = mapped_column(String(256), nullable=True)
    primary_category: Mapped[str | None] = mapped_column(String(64), nullable=True)
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)

    paper: Mapped[Paper] = relationship(back_populates="versions")
    authorships: Mapped[list["PaperAuthor"]] = relationship(
        back_populates="paper_version", cascade="all, delete"
    )


class PaperCategory(Base):
    __tablename__ = "paper_categories"
    __table_args__ = (
        UniqueConstraint("paper_id", "category", name="uq_paper_categories_paper_category"),
        Index("ix_paper_categories_category_submitted", "category", "latest_submitted_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    paper_id: Mapped[str] = mapped_column(String(64), ForeignKey("papers.paper_id", ondelete="CASCADE"))
    category: Mapped[str] = mapped_column(String(64), nullable=False)
    latest_submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    paper: Mapped[Paper] = relationship(back_populates="categories")


class IngestionRun(Base):
    __tablename__ = "ingestion_runs"

    run_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    mode: Mapped[str] = mapped_column(String(32), nullable=False)
    taxonomy: Mapped[str] = mapped_column(String(256), nullable=False)
    from_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    to_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    processed_entries: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    inserted_versions: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    updated_versions: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    raw_records_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class SnapshotManifest(Base):
    __tablename__ = "snapshot_manifests"
    __table_args__ = (Index("ix_snapshot_manifests_snapshot_id", "snapshot_id"),)

    snapshot_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    taxonomy: Mapped[str] = mapped_column(String(256), nullable=False)
    model_name: Mapped[str] = mapped_column(String(128), nullable=False)
    model_version: Mapped[str] = mapped_column(String(128), nullable=False)
    expected_dimension: Mapped[int] = mapped_column(Integer, nullable=False)

    export_manifest_path: Mapped[str] = mapped_column(Text, nullable=False)
    import_manifest_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    document_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    vector_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    aggregate_checksum: Mapped[str | None] = mapped_column(String(64), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class AnalyticsRun(Base):
    __tablename__ = "analytics_runs"

    run_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    snapshot_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    parameters: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    output_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class PipelineState(Base):
    __tablename__ = "pipeline_state"

    state_key: Mapped[str] = mapped_column(String(128), primary_key=True)
    state_value: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class PaperExternalId(Base):
    __tablename__ = "paper_external_ids"
    __table_args__ = (
        Index("ix_paper_external_ids_doi", "doi"),
        Index("ix_paper_external_ids_openalex_id", "openalex_id"),
        Index("ix_paper_external_ids_s2_id", "s2_id"),
    )

    paper_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("papers.paper_id", ondelete="CASCADE"), primary_key=True
    )
    doi: Mapped[str | None] = mapped_column(String(256), nullable=True)
    openalex_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    s2_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    crossref_doi: Mapped[str | None] = mapped_column(String(256), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class PaperMetricEnriched(Base):
    __tablename__ = "paper_metrics_enriched"
    __table_args__ = (
        UniqueConstraint("paper_id", "source", name="uq_paper_metrics_enriched_paper_source"),
        Index("ix_paper_metrics_enriched_source_updated", "source", "updated_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    paper_id: Mapped[str] = mapped_column(String(64), ForeignKey("papers.paper_id", ondelete="CASCADE"))
    source: Mapped[str] = mapped_column(String(32), nullable=False)
    citation_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    reference_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    influential_citation_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    venue: Mapped[str | None] = mapped_column(Text, nullable=True)
    publication_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class Author(Base):
    __tablename__ = "authors"

    author_uid: Mapped[str] = mapped_column(String(128), primary_key=True)
    display_name: Mapped[str] = mapped_column(Text, nullable=False)
    orcid: Mapped[str | None] = mapped_column(String(32), nullable=True)
    openalex_author_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    s2_author_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    papers: Mapped[list["PaperAuthor"]] = relationship(back_populates="author", cascade="all, delete")


class PaperAuthor(Base):
    __tablename__ = "paper_authors"
    __table_args__ = (
        UniqueConstraint("paper_version_id", "author_uid", name="uq_paper_authors_version_author"),
        Index("ix_paper_authors_author_uid", "author_uid"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    paper_version_id: Mapped[str] = mapped_column(
        String(72), ForeignKey("paper_versions.paper_version_id", ondelete="CASCADE"), nullable=False
    )
    author_uid: Mapped[str] = mapped_column(
        String(128), ForeignKey("authors.author_uid", ondelete="CASCADE"), nullable=False
    )
    author_order: Mapped[int] = mapped_column(Integer, nullable=False)
    affiliation: Mapped[str | None] = mapped_column(Text, nullable=True)
    country_code: Mapped[str | None] = mapped_column(String(8), nullable=True)

    paper_version: Mapped[PaperVersion] = relationship(back_populates="authorships")
    author: Mapped[Author] = relationship(back_populates="papers")


class PaperRelationship(Base):
    __tablename__ = "paper_relationships"
    __table_args__ = (
        UniqueConstraint(
            "source",
            "citing_paper_id",
            "cited_paper_id",
            "relation_type",
            "snapshot_date",
            name="uq_paper_relationships_unique_edge",
        ),
        Index("ix_paper_relationships_citing", "citing_paper_id"),
        Index("ix_paper_relationships_cited", "cited_paper_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    source: Mapped[str] = mapped_column(String(32), nullable=False)
    citing_paper_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("papers.paper_id", ondelete="CASCADE"), nullable=False
    )
    cited_paper_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("papers.paper_id", ondelete="CASCADE"), nullable=False
    )
    relation_type: Mapped[str] = mapped_column(String(32), nullable=False)
    snapshot_date: Mapped[date] = mapped_column(Date(), nullable=False)


class PaperSourceRaw(Base):
    __tablename__ = "paper_source_raw"
    __table_args__ = (
        UniqueConstraint("paper_id", "source", "payload_hash", name="uq_paper_source_raw_payload"),
        Index("ix_paper_source_raw_source_fetched", "source", "fetched_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    paper_id: Mapped[str] = mapped_column(String(64), ForeignKey("papers.paper_id", ondelete="CASCADE"))
    source: Mapped[str] = mapped_column(String(32), nullable=False)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    payload_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    payload_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
