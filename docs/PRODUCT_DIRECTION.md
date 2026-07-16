# Scholar Pulse: new product direction

## The split

The cartography of science already has a natural home in
[Mapping Science](https://aleetreny.github.io/Mapping-Science/). Scholar Pulse should not
rebuild that experience. It should answer a different question:

> What is arriving at the research frontier right now, and where should I start?

Scholar Pulse becomes a living research showroom: a lightweight public front door for recent
papers, thematic collections, and eventually evidence-backed signals about novelty and influence.

## Product pillars

1. **The daily pulse** — a small, fresh edition of recent open papers.
2. **Topic showrooms** — stable thematic lenses that make browsing feel intentional.
3. **Paper sheets** — title, authors, abstract, categories, date, and a direct source link.
4. **Transparent selection** — the current edition is category-based and explicitly not a ranking.
5. **A companion map** — Mapping Science remains one click away for structural exploration.

## What ships in the public beta

- A static Next.js site based on the existing Scholar Pulse visual system.
- Six showrooms: intelligent systems, life and health, climate and Earth, quantum and matter,
  space and cosmos, and society and economy.
- Thirty-six recent arXiv papers refreshed at build time.
- Search, topic filters, and a paper detail panel.
- A scheduled GitHub Actions build and GitHub Pages deployment.

The public beta does not require the local embedding shards, Parquet matrices, PostgreSQL, or the
FastAPI service. This keeps the public site fast and makes every edition reproducible from the
repository.

## How the existing work still matters

The ingestion, enrichment, similarity, and publication pipelines remain valuable. They are the
path from a transparent newest-first beta to a more distinctive product:

1. Replace the category-only feed with the canonical `latest_papers` artifact.
2. Add OpenAlex, Crossref, and Semantic Scholar metadata already supported by the repository.
3. Add explainable signals such as recency, cross-field movement, and novelty.
4. Add related-paper shelves generated from the existing similarity layer.

The old map-specific frontend is removed from the public Next.js app, but the analytical engine is
kept in the repository for this next phase.

## Data needed later

No large local files are required for the public beta. To add novelty scoring or related-paper
shelves, the smallest useful handoff would be a recent exported snapshot containing paper IDs,
titles, abstracts, dates, categories, and optionally embedding vectors. Raw historical corpora are
not required for the next design iteration.
