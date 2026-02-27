from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint
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
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    paper_id: Mapped[str] = mapped_column(String(64), ForeignKey("papers.paper_id", ondelete="CASCADE"))
    paper_version_id: Mapped[str] = mapped_column(String(72), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False)

    title: Mapped[str] = mapped_column(Text, nullable=False)
    abstract: Mapped[str] = mapped_column(Text, nullable=False)
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)

    paper: Mapped[Paper] = relationship(back_populates="versions")


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
