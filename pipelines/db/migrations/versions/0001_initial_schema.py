"""initial schema

Revision ID: 0001_initial_schema
Revises: 
Create Date: 2026-02-27 00:00:00.000000

"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0001_initial_schema"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "papers",
        sa.Column("paper_id", sa.String(length=64), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "paper_versions",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("paper_id", sa.String(length=64), sa.ForeignKey("papers.paper_id", ondelete="CASCADE")),
        sa.Column("paper_version_id", sa.String(length=72), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("abstract", sa.Text(), nullable=False),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("content_hash", sa.String(length=64), nullable=False),
        sa.UniqueConstraint("paper_version_id", name="uq_paper_versions_paper_version_id"),
    )
    op.create_index("ix_paper_versions_paper_id", "paper_versions", ["paper_id"])
    op.create_index("ix_paper_versions_updated_at", "paper_versions", ["updated_at"])

    op.create_table(
        "paper_categories",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("paper_id", sa.String(length=64), sa.ForeignKey("papers.paper_id", ondelete="CASCADE")),
        sa.Column("category", sa.String(length=64), nullable=False),
        sa.Column("latest_submitted_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("paper_id", "category", name="uq_paper_categories_paper_category"),
    )
    op.create_index(
        "ix_paper_categories_category_submitted",
        "paper_categories",
        ["category", "latest_submitted_at"],
    )

    op.create_table(
        "ingestion_runs",
        sa.Column("run_id", sa.String(length=64), primary_key=True),
        sa.Column("mode", sa.String(length=32), nullable=False),
        sa.Column("taxonomy", sa.String(length=256), nullable=False),
        sa.Column("from_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("to_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("processed_entries", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("inserted_versions", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("updated_versions", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("raw_records_path", sa.Text(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
    )

    op.create_table(
        "snapshot_manifests",
        sa.Column("snapshot_id", sa.String(length=128), primary_key=True),
        sa.Column("taxonomy", sa.String(length=256), nullable=False),
        sa.Column("model_name", sa.String(length=128), nullable=False),
        sa.Column("model_version", sa.String(length=128), nullable=False),
        sa.Column("expected_dimension", sa.Integer(), nullable=False),
        sa.Column("export_manifest_path", sa.Text(), nullable=False),
        sa.Column("import_manifest_path", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("document_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("vector_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("aggregate_checksum", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_snapshot_manifests_snapshot_id", "snapshot_manifests", ["snapshot_id"])

    op.create_table(
        "analytics_runs",
        sa.Column("run_id", sa.String(length=64), primary_key=True),
        sa.Column("snapshot_id", sa.String(length=128), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("parameters", sa.JSON(), nullable=False),
        sa.Column("output_path", sa.Text(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_analytics_runs_snapshot_id", "analytics_runs", ["snapshot_id"])

    op.create_table(
        "pipeline_state",
        sa.Column("state_key", sa.String(length=128), primary_key=True),
        sa.Column("state_value", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("pipeline_state")
    op.drop_index("ix_analytics_runs_snapshot_id", table_name="analytics_runs")
    op.drop_table("analytics_runs")
    op.drop_index("ix_snapshot_manifests_snapshot_id", table_name="snapshot_manifests")
    op.drop_table("snapshot_manifests")
    op.drop_table("ingestion_runs")
    op.drop_index("ix_paper_categories_category_submitted", table_name="paper_categories")
    op.drop_table("paper_categories")
    op.drop_index("ix_paper_versions_updated_at", table_name="paper_versions")
    op.drop_index("ix_paper_versions_paper_id", table_name="paper_versions")
    op.drop_table("paper_versions")
    op.drop_table("papers")
