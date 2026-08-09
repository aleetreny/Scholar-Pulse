"""Build the canonical research corpora for the ranking experiments.

Three real corpora, no synthetic data:

  A. hep-th citation graph (KDD Cup 2003 / SNAP, mirrored on GitHub) —
     27,770 arXiv papers and 352,807 citations, 1992-04 to 2003-04. arXiv
     identifiers of that era encode the submission month (YYMMNNN), so every
     node and every edge carries a timestamp. That is what makes a causal
     experiment possible: we can freeze the world at month t and score only
     what was knowable then.

  B. 41,000 arXiv papers with full submission-time metadata (title, abstract,
     author list, categories, date). Same shape as the snapshots ScholarPulse
     already builds, so anything that works here transfers to production.

  C. 198 papers curated as high-impact in cs.LG and cs.CL, with their measured
     citation counts. Used as a held-out relevance set for corpus B.

Outputs land in RESEARCH_DATA (default /workspace/rankdata) as parquet.
"""

from __future__ import annotations

import gzip
import json
import os
import re
from pathlib import Path

import pandas as pd

DATA = Path(os.environ.get("RESEARCH_DATA", "/workspace/rankdata"))
WORK = Path(os.environ.get("RESEARCH_WORK", "/workspace/corpora"))
HEPTH_GZ = DATA / "cit-HepTh.txt.gz"
ARXIV_JSON = WORK / "arxivdata" / "arxivData.json"
ANNOTATIONS = WORK / "ukp-trends" / "human_annotations"

# hep-th ran from 1992-04; the SNAP crawl stops at 2003-04.
BASE_YEAR = 1992


def month_index(year: int, month: int) -> int:
    """Months elapsed since 1992-01, so time is a single integer axis."""
    return (year - BASE_YEAR) * 12 + (month - 1)


def decode_hepth_id(node: int) -> tuple[int, int] | None:
    """arXiv ids of the hep-th era are YYMMNNN once zero-padded to 7 digits.

    Ids are stored as integers, so 2000-2003 papers lost their leading zero
    (0001001 -> 1001). Padding restores the calendar, and the month field is a
    free correctness check: a wrong decoding produces months outside 1..12.
    """
    text = f"{node:07d}"
    yy, mm = int(text[:2]), int(text[2:4])
    if not 1 <= mm <= 12:
        return None
    year = 1900 + yy if yy >= 90 else 2000 + yy
    if not 1992 <= year <= 2003:
        return None
    return year, mm


def build_hepth() -> None:
    edges: list[tuple[int, int]] = []
    with gzip.open(HEPTH_GZ, "rt") as handle:
        for line in handle:
            if line.startswith("#"):
                continue
            src, dst = line.split()
            edges.append((int(src), int(dst)))

    nodes = sorted({n for edge in edges for n in edge})
    decoded = {n: decode_hepth_id(n) for n in nodes}
    undated = [n for n, value in decoded.items() if value is None]

    papers = pd.DataFrame(
        [
            {
                "paper": n,
                "year": decoded[n][0],
                "month": decoded[n][1],
                "t": month_index(*decoded[n]),
            }
            for n in nodes
            if decoded[n] is not None
        ]
    )

    dated = set(papers["paper"])
    edge_df = pd.DataFrame(edges, columns=["src", "dst"])
    edge_df = edge_df[edge_df["src"].isin(dated) & edge_df["dst"].isin(dated)]
    t_of = papers.set_index("paper")["t"]
    edge_df["t_src"] = edge_df["src"].map(t_of)
    edge_df["t_dst"] = edge_df["dst"].map(t_of)

    # A citation cannot precede the cited paper. Violations are real in this
    # corpus (a v2 revision adds a reference to newer work, but the node keeps
    # the v1 identifier), and they would leak the future into the features, so
    # they are dropped rather than clamped.
    backward = int((edge_df["t_src"] < edge_df["t_dst"]).sum())
    edge_df = edge_df[edge_df["t_src"] >= edge_df["t_dst"]].reset_index(drop=True)

    papers.to_parquet(DATA / "hepth_papers.parquet", index=False)
    edge_df.to_parquet(DATA / "hepth_edges.parquet", index=False)

    print(f"[hep-th] papers={len(papers):,}  edges={len(edge_df):,}")
    print(f"[hep-th] undecodable ids dropped: {len(undated)}")
    print(f"[hep-th] time-inconsistent edges dropped: {backward:,}")
    print(
        f"[hep-th] span: {papers['year'].min()}-{papers['month'].min():02d}"
        f" .. {papers['year'].max()}-{papers[papers['year'] == papers['year'].max()]['month'].max():02d}"
    )


def build_arxiv() -> None:
    raw = json.loads(ARXIV_JSON.read_text())
    rows = []
    for item in raw:
        try:
            authors = [a["name"] for a in json.loads(item["author"].replace("'", '"'))]
        except Exception:
            authors = re.findall(r"'name':\s*'([^']+)'", item["author"])
        try:
            tags = [t["term"] for t in json.loads(item["tag"].replace("'", '"'))]
        except Exception:
            tags = re.findall(r"'term':\s*'([^']+)'", item["tag"])
        rows.append(
            {
                "id": item["id"].split("v")[0],
                "title": " ".join(item["title"].split()),
                "abstract": " ".join(item["summary"].split()),
                "authors": authors,
                "categories": tags,
                "primary": tags[0] if tags else "",
                "year": int(item["year"]),
                "month": int(item["month"]),
                "day": int(item["day"]),
                "t": month_index(int(item["year"]), int(item["month"])),
            }
        )
    frame = pd.DataFrame(rows).drop_duplicates(subset="id").reset_index(drop=True)
    frame.to_parquet(DATA / "arxiv_papers.parquet", index=False)
    print(f"[arxiv] papers={len(frame):,}  authors parsed for "
          f"{(frame['authors'].str.len() > 0).mean():.1%} of rows")
    print(f"[arxiv] years {frame['year'].min()}-{frame['year'].max()}, "
          f"median {int(frame['year'].median())}")


def build_labels() -> None:
    rows = []
    for path, field in [("csLG_12302018.tsv", "cs.LG"), ("csCL_12302018.tsv", "cs.CL")]:
        for line in (ANNOTATIONS / path).read_text(encoding="utf8").splitlines():
            parts = line.split("\t")
            if not parts or not re.match(r"^\d{4}\.\d{4,5}$", parts[0].strip()):
                continue
            zscore = re.search(r"zscore:\s*([-\d.]+)", parts[3]) if len(parts) > 3 else None
            rows.append(
                {
                    "id": parts[0].strip(),
                    "title": " ".join(parts[1].split()),
                    "citations": int(parts[2]) if parts[2].strip().isdigit() else None,
                    "zscore": float(zscore.group(1)) if zscore else None,
                    "field": field,
                }
            )
    frame = pd.DataFrame(rows)
    frame.to_parquet(DATA / "top_papers.parquet", index=False)
    print(f"[labels] curated high-impact papers={len(frame)}  "
          f"median citations={frame['citations'].median():.0f}")


if __name__ == "__main__":
    DATA.mkdir(parents=True, exist_ok=True)
    build_hepth()
    build_arxiv()
    build_labels()
