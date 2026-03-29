"""enrichment schema expansion

Revision ID: 0002_enrichment_schema
Revises: 0001_initial_schema
Create Date: 2026-03-02 00:00:00.000000

"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0002_enrichment_schema"
down_revision = "0001_initial_schema"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "paper_versions",
        sa.Column("authors_raw", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
    )
    op.add_column("paper_versions", sa.Column("submitter", sa.Text(), nullable=True))
    op.add_column("paper_versions", sa.Column("comments", sa.Text(), nullable=True))
    op.add_column("paper_versions", sa.Column("journal_ref", sa.Text(), nullable=True))
    op.add_column("paper_versions", sa.Column("doi", sa.String(length=256), nullable=True))
    op.add_column("paper_versions", sa.Column("primary_category", sa.String(length=64), nullable=True))
    op.create_index("ix_paper_versions_submitted_at", "paper_versions", ["submitted_at"])
    op.create_index("ix_paper_versions_doi", "paper_versions", ["doi"])
    op.create_index("ix_paper_versions_primary_category", "paper_versions", ["primary_category"])

    op.create_table(
        "paper_external_ids",
        sa.Column(
            "paper_id",
            sa.String(length=64),
            sa.ForeignKey("papers.paper_id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("doi", sa.String(length=256), nullable=True),
        sa.Column("openalex_id", sa.String(length=128), nullable=True),
        sa.Column("s2_id", sa.String(length=128), nullable=True),
        sa.Column("crossref_doi", sa.String(length=256), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_paper_external_ids_doi", "paper_external_ids", ["doi"])
    op.create_index("ix_paper_external_ids_openalex_id", "paper_external_ids", ["openalex_id"])
    op.create_index("ix_paper_external_ids_s2_id", "paper_external_ids", ["s2_id"])

    op.create_table(
        "paper_metrics_enriched",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "paper_id",
            sa.String(length=64),
            sa.ForeignKey("papers.paper_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("source", sa.String(length=32), nullable=False),
        sa.Column("citation_count", sa.Integer(), nullable=True),
        sa.Column("reference_count", sa.Integer(), nullable=True),
        sa.Column("influential_citation_count", sa.Integer(), nullable=True),
        sa.Column("venue", sa.Text(), nullable=True),
        sa.Column("publication_type", sa.String(length=64), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("paper_id", "source", name="uq_paper_metrics_enriched_paper_source"),
    )
    op.create_index(
        "ix_paper_metrics_enriched_source_updated",
        "paper_metrics_enriched",
        ["source", "updated_at"],
    )

    op.create_table(
        "authors",
        sa.Column("author_uid", sa.String(length=128), primary_key=True),
        sa.Column("display_name", sa.Text(), nullable=False),
        sa.Column("orcid", sa.String(length=32), nullable=True),
        sa.Column("openalex_author_id", sa.String(length=128), nullable=True),
        sa.Column("s2_author_id", sa.String(length=128), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "paper_authors",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "paper_version_id",
            sa.String(length=72),
            sa.ForeignKey("paper_versions.paper_version_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "author_uid",
            sa.String(length=128),
            sa.ForeignKey("authors.author_uid", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("author_order", sa.Integer(), nullable=False),
        sa.Column("affiliation", sa.Text(), nullable=True),
        sa.Column("country_code", sa.String(length=8), nullable=True),
        sa.UniqueConstraint("paper_version_id", "author_uid", name="uq_paper_authors_version_author"),
    )
    op.create_index("ix_paper_authors_author_uid", "paper_authors", ["author_uid"])

    op.create_table(
        "paper_relationships",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("source", sa.String(length=32), nullable=False),
        sa.Column(
            "citing_paper_id",
            sa.String(length=64),
            sa.ForeignKey("papers.paper_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "cited_paper_id",
            sa.String(length=64),
            sa.ForeignKey("papers.paper_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("relation_type", sa.String(length=32), nullable=False),
        sa.Column("snapshot_date", sa.Date(), nullable=False),
        sa.UniqueConstraint(
            "source",
            "citing_paper_id",
            "cited_paper_id",
            "relation_type",
            "snapshot_date",
            name="uq_paper_relationships_unique_edge",
        ),
    )
    op.create_index("ix_paper_relationships_citing", "paper_relationships", ["citing_paper_id"])
    op.create_index("ix_paper_relationships_cited", "paper_relationships", ["cited_paper_id"])

    op.create_table(
        "paper_source_raw",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "paper_id",
            sa.String(length=64),
            sa.ForeignKey("papers.paper_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("source", sa.String(length=32), nullable=False),
        sa.Column("fetched_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("payload_json", sa.JSON(), nullable=False),
        sa.Column("payload_hash", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.UniqueConstraint("paper_id", "source", "payload_hash", name="uq_paper_source_raw_payload"),
    )
    op.create_index("ix_paper_source_raw_source_fetched", "paper_source_raw", ["source", "fetched_at"])


def downgrade() -> None:
    op.drop_index("ix_paper_source_raw_source_fetched", table_name="paper_source_raw")
    op.drop_table("paper_source_raw")

    op.drop_index("ix_paper_relationships_cited", table_name="paper_relationships")
    op.drop_index("ix_paper_relationships_citing", table_name="paper_relationships")
    op.drop_table("paper_relationships")

    op.drop_index("ix_paper_authors_author_uid", table_name="paper_authors")
    op.drop_table("paper_authors")
    op.drop_table("authors")

    op.drop_index("ix_paper_metrics_enriched_source_updated", table_name="paper_metrics_enriched")
    op.drop_table("paper_metrics_enriched")

    op.drop_index("ix_paper_external_ids_s2_id", table_name="paper_external_ids")
    op.drop_index("ix_paper_external_ids_openalex_id", table_name="paper_external_ids")
    op.drop_index("ix_paper_external_ids_doi", table_name="paper_external_ids")
    op.drop_table("paper_external_ids")

    op.drop_index("ix_paper_versions_primary_category", table_name="paper_versions")
    op.drop_index("ix_paper_versions_doi", table_name="paper_versions")
    op.drop_index("ix_paper_versions_submitted_at", table_name="paper_versions")
    op.drop_column("paper_versions", "primary_category")
    op.drop_column("paper_versions", "doi")
    op.drop_column("paper_versions", "journal_ref")
    op.drop_column("paper_versions", "comments")
    op.drop_column("paper_versions", "submitter")
    op.drop_column("paper_versions", "authors_raw")
