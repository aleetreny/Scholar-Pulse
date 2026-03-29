from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any


@dataclass(frozen=True)
class ParsedArxivId:
    base_id: str
    version: int
    paper_version_id: str


@dataclass(frozen=True)
class ArxivRecord:
    paper_id: str
    paper_version_id: str
    version: int
    title: str
    abstract: str
    submitted_at: datetime
    updated_at: datetime
    categories: list[str]
    authors: list[str] = field(default_factory=list)
    raw: dict[str, Any] = field(default_factory=dict)
    submitter: str | None = None
    comments: str | None = None
    journal_ref: str | None = None
    doi: str | None = None
    primary_category: str | None = None
