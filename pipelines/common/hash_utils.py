from __future__ import annotations

import hashlib


def deterministic_content_hash(title: str, abstract: str, categories: list[str]) -> str:
    canonical = "||".join(
        [
            title.strip().lower(),
            abstract.strip().lower(),
            "|".join(sorted(category.strip().lower() for category in categories)),
        ]
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()
