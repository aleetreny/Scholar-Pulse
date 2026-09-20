# ScholarPulse

Explore arXiv papers by discipline, discover promising recent work, and find
established references. Readers need no account or paid model. The static site uses a small cached search service.

[Open ScholarPulse](https://aleetreny.github.io/Scholar-Pulse/)

- **Recommended:** recent papers grouped by field and ranked using the evidence
  available at the time of the build.
- **Newest:** chronological browsing of the same candidates.
- **Search:** choose a discipline without entering a query, or search by topic
  or `author:Name`. Sorting keeps the same OpenAlex catalogue. **Most cited** surfaces established work; citations favor older
  papers and are not a measure of scientific quality.
- Paper pages explain the ranking and link to references, citations and related work.
- Save papers, notes and reading status locally; export BibTeX or JSON.
- English and Spanish, light and dark themes, desktop and mobile.

The [reader-flow audit](docs/READER-AUDIT-2026-09-20.md) documents the search,
pagination, metadata and library fixes. The [search service](workers/search-api/README.md)
keeps the OpenAlex key server-side; outages never switch to a smaller catalogue.

## Ranking

`pulse-v2` is a discovery aid, **not a probability of future importance**.

1. Each category is its own comparison group, including cross-listed papers.
   Small disciplines are not pooled with unrelated fields.
2. The existing twelve-feature metadata model provides an experimental prior.
   It was fitted on older machine-learning/NLP data; its accuracy across all
   current disciplines has not been established.
3. Bibliography length and recorded citations contribute independent rankings.
   Reciprocal-rank fusion puts every lane on the same percentile scale and
   weights it by observed coverage. Missing values are neutral, not zero.
4. Citations are compared within 28-day publication-age bands. Once papers are
   at least 28 days old, the reception lane receives more weight, selected on
   historical training cohorts. A single quiet field can otherwise mix days-old
   papers with papers that have accumulated citations for years.
5. Newcomers retain the existing separate comparison and reserved space inside
   each band. Continuous percentiles determine order; rounded scores are only
   presentation. Exact ties have deterministic ordering.

The candidate set includes up to **500 papers per category**, drawn from the
latest ten days, with up to 100 retained in quiet disciplines. It is bounded,
not an exhaustive catalog. Use search for the wider arXiv literature.

### Evidence and limits

The September review found self-inclusion in the former dense-memory backtest:
its author memory already contained the papers being evaluated. Consequently,
the previous reported improvement to NDCG@10 0.476 and the 0% newcomer rate do
not establish a causal production improvement. Historical results remain in
[the archived study](research/ranking/legacy-study.md), with that qualification.

The replacement fusion experiment uses the public SNAP hep-th citation graph.
The reception weight was selected on **1993–1995** cohorts, whose outcomes
were complete before 1998, then evaluated on **40 later monthly cohorts with
9,348 papers**. With full reference and citation coverage, NDCG@10 changed from
**0.792 to 0.852** for the two external lanes. Four of five coverage scenarios
had positive paired intervals; the sparsest scenario was inconclusive.

**This is not the full application's predictive accuracy.** It omits the
metadata model, uses an old physics corpus and simulated missingness, and the
static citation graph may include revised bibliographies. An initial equal-weight
candidate had mixed results and is reported too. See the
[protocol, results and sources](research/ranking/README.md).

## Prospective evaluation

The original prediction log is preserved. Its first cohort becomes 90 days old
on **21 November 2026 at 15:06 UTC**. A scheduled Saturday evaluation now checks
mature cohorts and uploads its report as a GitHub Actions artifact.

New v2 entries record every candidate, its displayed rank, the old ranking
formula on those same candidates, chronological and reference-only baselines,
and citation counts observed during ranking. The first claim per version/day is
immutable. Old sampled entries are kept as originally recorded, never relabeled
as v2 results. No 60-build cap can delete an immature cohort.

Evaluation stays within each field and separates model versions. For v2 it
measures **citation gains after ranking**, requires adequate outcome coverage
and complete top-ten observations for each compared method, and refuses a
verdict with too few actual positive observations. Cached older counts are not
treated as a fresh baseline. V2 needs its own 90-day observation period;
November's original cohort cannot validate a September algorithm retroactively.

```bash
cd apps/web
npm run verify                       # deployed history; no queries for immature cohorts
npm run verify -- --local             # local history
```

## Development

Use Node.js 24, matching CI:

```bash
cd apps/web
npm ci
npm run restore                      # preserve the live memory, log and snapshots locally
npm run dev
```

Open <http://localhost:3000>. To refresh and rank local candidates:

```bash
npm run snapshots -- --cats cs.LG,cs.CL --max 500
npm run rank                         # optional S2_API_KEY improves coverage
npm run rank -- --no-enrich           # reuse saved counts; do not query the index
```

State restoration deliberately fails if existing history cannot be read.
`--bootstrap` on ranking/backfill is only for a new installation whose state URL
returns 404; it never turns a timeout or malformed response into an empty history.

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

## Deployment and persistence

[The Pages workflow](.github/workflows/deploy-pages.yml) runs on main pushes,
weekly and on demand. It restores the published state first, refreshes arXiv,
ranks the candidates, exports the static site and deploys it.

- arXiv outages retain the last available category snapshot and its actual date.
  A time budget and circuit breaker bound refresh attempts. Cached lists remain
  usable, but may be stale; the interface says so.
- A failed memory or prediction-log restore stops deployment instead of silently
  losing history. Ranking observations also get a 90-day artifact backup.
- Semantic Scholar supplies counts; the optional `S2_API_KEY` GitHub secret
  improves access. Missing responses fall back to saved observations with their
  original timestamps, or to metadata when no observation exists.
- Corpus memory is folded once per known ID, with a two-year ledger and completed
  backfill-month protection. Its collaborator degree is an approximate per-batch
  statistic, not an exact lifetime coauthor graph.

To backfill author/topic history, dispatch deployment with `backfill_months`, or
run `npm run backfill -- --months 12`. Backfills checkpoint completed months.
The memory is an as-of-build corpus summary; it does not reconstruct each
paper's immutable day-zero author history.

## Repository

| Path | Purpose |
| --- | --- |
| `apps/web/` | Public static Next.js application and ranking/build scripts |
| `research/ranking/` | Reproducible experiments, results and research limitations |
| `pipelines/` | Optional local ingestion, embeddings, enrichment and analytics |
| `apps/dashboard/`, `apps/dashboard_api/` | Optional local analytics dashboard/API |
| `tests/` | Python unit, integration and ingestion/export/import tests |
| `docs/` | [Architecture](docs/ARCHITECTURE.md) and [September review](docs/REVIEW-2026-09.md) |

The public site does not depend on the Python services. For their test suite:

```bash
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install -e '.[dev,dashboard,dashboard_api]' scikit-learn
ruff check .
pytest
```

Generated data, dependency directories and credentials are excluded from Git.
