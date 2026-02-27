from __future__ import annotations

from datetime import datetime, timezone


def build_snapshot_id(taxonomy: str, model_version: str, now: datetime | None = None) -> str:
    ts = (now or datetime.now(timezone.utc)).strftime("%Y%m%dT%H%M%SZ")
    normalized_taxonomy = taxonomy.replace(",", "-").replace(" ", "")
    normalized_model = model_version.replace("/", "-")
    return f"{ts}__{normalized_taxonomy}__{normalized_model}"
