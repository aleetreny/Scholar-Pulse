from __future__ import annotations

import time
from datetime import datetime
from typing import Iterator

import feedparser
import requests

from pipelines.common.settings import get_settings
from pipelines.ingestion.arxiv_utils import (
    normalize_record,
    taxonomy_to_arxiv_query,
    taxonomy_to_category_query,
)
from pipelines.ingestion.types import ArxivRecord


class ArxivClient:
    def __init__(self) -> None:
        self.settings = get_settings()
        self.base_url = self.settings.arxiv_base_url

    def _fetch_page(self, query: str, start: int, max_results: int) -> feedparser.FeedParserDict:
        params = {
            "search_query": query,
            "start": start,
            "max_results": max_results,
            "sortBy": "submittedDate",
            "sortOrder": "descending",
        }
        attempts = 0
        while attempts < self.settings.arxiv_max_retries:
            attempts += 1
            try:
                response = requests.get(
                    self.base_url,
                    params=params,
                    timeout=60,
                    headers={"User-Agent": "ScholarPulse/0.1 (research pipeline)"},
                )

                if response.status_code == 429:
                    retry_after = response.headers.get("Retry-After")
                    wait_seconds = (
                        int(retry_after) if retry_after and retry_after.isdigit() else 2**attempts
                    )
                    time.sleep(min(wait_seconds, 120))
                    continue

                response.raise_for_status()
                parsed = feedparser.parse(response.text)
                if parsed.bozo:
                    raise RuntimeError("ArXiv feed parser failed")
                return parsed
            except (requests.RequestException, RuntimeError):
                if attempts >= self.settings.arxiv_max_retries:
                    raise
                time.sleep(min(2**attempts, 120))

        raise RuntimeError("Failed to fetch arXiv page after retries")

    def fetch_records(
        self,
        taxonomy: list[str],
        from_dt: datetime,
        to_dt: datetime,
        max_records: int | None = None,
    ) -> Iterator[ArxivRecord]:
        query = taxonomy_to_arxiv_query(taxonomy, from_dt, to_dt)
        start = 0
        page_size = self.settings.arxiv_page_size
        yielded = 0

        while True:
            page = self._fetch_page(query=query, start=start, max_results=page_size)
            entries = list(page.entries)
            if not entries:
                break

            for entry in entries:
                yield normalize_record(entry)
                yielded += 1
                if max_records is not None and yielded >= max_records:
                    return

            start += len(entries)
            if len(entries) < page_size:
                break

            time.sleep(self.settings.arxiv_delay_seconds)

    def fetch_latest_records(
        self,
        taxonomy: list[str],
        max_records: int,
    ) -> Iterator[ArxivRecord]:
        query = taxonomy_to_category_query(taxonomy)
        start = 0
        page_size = min(self.settings.arxiv_page_size, max_records)
        yielded = 0

        while yielded < max_records:
            page = self._fetch_page(query=query, start=start, max_results=page_size)
            entries = list(page.entries)
            if not entries:
                break

            for entry in entries:
                yield normalize_record(entry)
                yielded += 1
                if yielded >= max_records:
                    return

            start += len(entries)
            if len(entries) < page_size:
                break

            time.sleep(self.settings.arxiv_delay_seconds)
