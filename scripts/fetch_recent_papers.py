"""Build the lightweight paper feed used by the public Scholar Pulse site.

The public site is intentionally independent from the large local embedding
artifacts. It uses arXiv as a small, transparent freshness layer while the
repository's richer ingestion pipeline remains available for later scoring and
enrichment work.
"""

from __future__ import annotations

import argparse
import json
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ARXIV_API = "https://export.arxiv.org/api/query"
ATOM = {"atom": "http://www.w3.org/2005/Atom"}
USER_AGENT = "ScholarPulse/2.0 (+https://github.com/aleetreny/Scholar-Pulse)"

THEMES = [
    {
        "id": "intelligent-systems",
        "name": "Intelligent systems",
        "shortName": "AI",
        "description": "Models that learn, reason, generate, and act.",
        "accent": "#1f4fb8",
        "query": "cat:cs.AI OR cat:cs.LG OR cat:cs.CL",
    },
    {
        "id": "life-health",
        "name": "Life & health",
        "shortName": "Life",
        "description": "From molecular mechanisms to human health.",
        "accent": "#23706f",
        "query": "cat:q-bio.BM OR cat:q-bio.GN OR cat:q-bio.NC OR cat:q-bio.QM",
    },
    {
        "id": "climate-earth",
        "name": "Climate & Earth",
        "shortName": "Earth",
        "description": "A changing planet, observed across scales.",
        "accent": "#7a6531",
        "query": "cat:physics.ao-ph OR cat:physics.geo-ph OR cat:q-bio.PE",
    },
    {
        "id": "quantum-matter",
        "name": "Quantum & matter",
        "shortName": "Quantum",
        "description": "The structure and behavior of matter at its limits.",
        "accent": "#6a4ba0",
        "query": "cat:quant-ph OR cat:cond-mat.mtrl-sci OR cat:cond-mat.str-el",
    },
    {
        "id": "space-cosmos",
        "name": "Space & cosmos",
        "shortName": "Space",
        "description": "New observations of worlds, galaxies, and the universe.",
        "accent": "#355879",
        "query": "cat:astro-ph.CO OR cat:astro-ph.GA OR cat:astro-ph.EP",
    },
    {
        "id": "society-economy",
        "name": "Society & economy",
        "shortName": "Society",
        "description": "Evidence about institutions, markets, and collective life.",
        "accent": "#9a573e",
        "query": "cat:econ.GN OR cat:econ.EM OR cat:cs.CY OR cat:stat.AP",
    },
]


def normalize(value: str | None) -> str:
    return " ".join((value or "").split())


def load_existing(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"papers": []}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"papers": []}


def fetch_theme(theme: dict[str, str], limit: int) -> list[dict[str, Any]]:
    params = urllib.parse.urlencode(
        {
            "search_query": theme["query"],
            "start": 0,
            "max_results": limit,
            "sortBy": "submittedDate",
            "sortOrder": "descending",
        }
    )
    request = urllib.request.Request(
        f"{ARXIV_API}?{params}",
        headers={"User-Agent": USER_AGENT, "Accept": "application/atom+xml"},
    )
    with urllib.request.urlopen(request, timeout=45) as response:
        root = ET.fromstring(response.read())

    papers: list[dict[str, Any]] = []
    for entry in root.findall("atom:entry", ATOM):
        entry_url = normalize(entry.findtext("atom:id", namespaces=ATOM))
        arxiv_id = entry_url.rstrip("/").split("/")[-1]
        authors = [
            normalize(node.findtext("atom:name", namespaces=ATOM))
            for node in entry.findall("atom:author", ATOM)
        ]
        categories = [node.attrib.get("term", "") for node in entry.findall("atom:category", ATOM)]
        pdf_url = next(
            (
                node.attrib.get("href", "")
                for node in entry.findall("atom:link", ATOM)
                if node.attrib.get("title") == "pdf"
            ),
            f"https://arxiv.org/pdf/{arxiv_id}",
        )
        papers.append(
            {
                "id": arxiv_id,
                "title": normalize(entry.findtext("atom:title", namespaces=ATOM)),
                "summary": normalize(entry.findtext("atom:summary", namespaces=ATOM)),
                "authors": authors,
                "publishedAt": normalize(entry.findtext("atom:published", namespaces=ATOM)),
                "updatedAt": normalize(entry.findtext("atom:updated", namespaces=ATOM)),
                "arxivUrl": entry_url.replace("http://", "https://").replace(
                    "export.arxiv.org", "arxiv.org"
                ),
                "pdfUrl": pdf_url.replace("http://", "https://"),
                "primaryCategory": categories[0] if categories else "",
                "categories": categories,
                "themeId": theme["id"],
            }
        )
    return papers


def build_feed(output: Path, per_theme: int) -> dict[str, Any]:
    existing = load_existing(output)
    fallback_by_theme: dict[str, list[dict[str, Any]]] = {}
    for paper in existing.get("papers", []):
        fallback_by_theme.setdefault(paper.get("themeId", ""), []).append(paper)

    papers: list[dict[str, Any]] = []
    seen: set[str] = set()
    warnings: list[str] = []

    for index, theme in enumerate(THEMES):
        if index:
            # arXiv asks clients making repeated calls to leave a three-second gap.
            time.sleep(3.1)
        try:
            candidates = fetch_theme(theme, per_theme * 2)
        except (OSError, TimeoutError, ET.ParseError) as error:
            candidates = fallback_by_theme.get(theme["id"], [])
            warnings.append(f"{theme['name']}: {type(error).__name__}")

        selected = 0
        for paper in candidates:
            if paper["id"] in seen:
                continue
            seen.add(paper["id"])
            papers.append(paper)
            selected += 1
            if selected >= per_theme:
                break

    if not papers:
        raise RuntimeError("No papers were returned and no existing feed was available.")

    papers.sort(key=lambda paper: paper.get("publishedAt", ""), reverse=True)
    return {
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": {
            "name": "arXiv",
            "url": "https://arxiv.org/",
            "note": "Newest submissions selected by transparent category lenses; no ranking is implied.",
        },
        "themes": [{key: value for key, value in theme.items() if key != "query"} for theme in THEMES],
        "papers": papers,
        "warnings": warnings,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("apps/dashboard-web/src/data/showroom.json"),
    )
    parser.add_argument("--per-theme", type=int, default=12)
    args = parser.parse_args()

    feed = build_feed(args.output, max(1, args.per_theme))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(feed, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {len(feed['papers'])} papers to {args.output}")
    if feed["warnings"]:
        print("Used cached data for: " + ", ".join(feed["warnings"]))


if __name__ == "__main__":
    main()
