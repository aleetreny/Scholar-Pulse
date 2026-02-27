from __future__ import annotations

from dataclasses import dataclass
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
    raw: dict[str, Any]
