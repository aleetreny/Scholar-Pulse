# ScholarPulse

ScholarPulse is a researcher-focused discovery platform for exploring recent arXiv literature, following fields, investigating citation networks, and maintaining a private reading library.

Its feed is ranked rather than chronological: every paper is scored at build time for how likely it is to matter, from metadata available the day it appears. The model behind that score was fitted and validated offline against papers that demonstrably became references in their field. See [research/ranking](research/ranking/README.md) for the evidence, including what did not work.

[Open the live application](https://aleetreny.github.io/Scholar-Pulse/)

## Highlights

- Personalized feeds built from scheduled arXiv snapshots, ranked by predicted impact.
- A calibrated 0-100 score per paper, with the signals behind it shown on the paper page.
- Full-corpus search and author lookup through OpenAlex.
- Paper details with citations, references, related work, and Semantic Scholar enrichment.
- Local reading lists, notes, status tracking, and BibTeX or JSON export.
- English and Spanish interfaces with responsive light and dark themes.
- Static deployment: the public application requires no hosted backend or user account.

## How the ranking works

The hard part is that the papers worth surfacing are the ones nobody has cited
yet. A day-old preprint has no citations, no downloads and no discussion, so the
usual impact measures are all exactly zero. The score has to be built from what
exists on day one: who wrote it, what it is about, and how it is written.

**Signals.** Twelve features, all computable from metadata plus a memory of the
corpus so far: team size, how new the authors are, how far their collaboration
network reaches, how recently they published, title and abstract length, whether
the title carries a colon, whether it names a system, how rare its vocabulary is,
and whether its terms are currently spiking. Weights are fitted, not chosen, and
constrained non-negative after orienting each feature, so no two can cancel each
other out and the score decomposes into contributions a reader can be shown. The
paper page lists the three that helped most.

**Cohorts.** A paper is ranked against the field it was filed under, never
against the whole feed. Citation habits differ enough between fields that one
pool would rank the discipline instead of the paper. Every feature is converted
to a percentile within its cohort, so raw units never leave the model.

**Lanes.** Up to three independent rankings are fused by reciprocal rank: the
model's own score, reference-list length, and citations already recorded.
External indexes lag, so the second and third lanes are usually partial: they
rank the papers they know about and seat the rest at their neutral midpoint,
which makes a lane's influence scale with its own coverage automatically. A
paper an index has not reached is never scored as if it had zero references;
"unknown" and "zero" are different claims and conflating them punishes papers
for being new.

**Bands, not positions.** Papers are published as *Front page* (top 5%),
*Notable* (next 15%) and the rest. Rank stability inside the head of the list
was not good enough to assert an exact order, so it is not asserted.

**Newcomers.** Papers whose authors are all unknown to the site are ranked in
their own pool and reserved 30% of the board. Without it, hits from unknown
authors landed at the 49th percentile against the 88th for established ones,
and the score was learning reputation as much as merit.

Validation is leave-one-month-out on papers that demonstrably became references
in their field: **AUC 0.79** (95% CI 0.76–0.83) and **5.5x lift in the top 10%**
against a 1.4% base rate. That is the offline study, on 2017-18 cs.LG and cs.CL
papers against a curated list of landmarks; it is not a measurement of the live
feed, and it should not be read as one.

Replayed against 2026 arXiv, the deployed system scores **NDCG@10 0.414**
[0.374, 0.458] and **1.7x lift in the top 10**, against 0.258 and 1.0x for the
chronological feed it replaced: a real improvement, in 85% of cohorts, and a
much smaller one than the study suggests. Almost all of it comes from the
reference lane rather than from the model, whose twelve signals currently rank
below a random shuffle on their own, because the site's memory has never seen
the authors of 44% of any cohort. The measurement, the arms and the fix are in
[research/ranking](research/ranking/README.md), along with the full study and
the hypotheses that failed.

**Checking it against reality.** Those numbers come from a 2017-18 corpus, and
a model that validated offline can still be wrong in production. Every build
therefore writes down what it claimed, in `data/predictions.json`: the whole
front page and notable band, one paper in sixteen from the rest as a control
group, carried forward from the previous deployment the same way the corpus
memory is. `npm run verify` reads that log, asks Semantic Scholar what those
papers collected since, and reports the base rate, the AUC and the lift of each
band against what actually happened.

It will decline to answer for a while, and that is the honest answer rather
than a limitation. A preprint has no citations because it is a preprint, and
the study measured that a cohort needs about three months before its top ten
has settled into its field's top decile, so cohorts younger than ninety days
are reported as too young to measure instead of being scored.

## Repository layout

| Path | Purpose |
| --- | --- |
| `apps/web/` | Primary Next.js web application deployed to GitHub Pages. |
| `apps/dashboard/` | Optional Plotly dashboard for locally generated analytics artifacts. |
| `apps/dashboard_api/` | Optional FastAPI service for dashboard data. |
| `pipelines/` | Ingestion, enrichment, embeddings, indexing, and orchestration workflows. |
| `research/ranking/` | Offline study behind the ranking: corpora, experiments, and the model exporter. |
| `tests/` | Python unit, integration, and end-to-end tests. |
| `infra/` | Infrastructure-specific setup, including Colab workflows. |
| `docs/` | Architecture and pipeline documentation. |

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for component boundaries and data flow.

## Run the web application

Node.js 24 is used in CI.

```bash
cd apps/web
npm ci
npm run dev
```

Open <http://localhost:3000>. To generate fresh local feed data before starting the app:

```bash
npm run snapshots -- --cats cs.LG,cs.CL --max 60
npm run rank -- --no-enrich   # score them; --no-enrich skips the external indexes
```

The ranking maths has its own tests:

```bash
npm test
```

To audit the deployed ranking against realized citations:

```bash
npm run verify                       # the live site's prediction log
npm run verify -- --local            # a log built locally
```

## Run the Python toolchain

Python 3.11 or later is required.

```bash
python -m venv .venv
source .venv/bin/activate
python -m pip install -e ".[dev,dashboard]"
pytest
```

Copy `.env.example` to `.env` only when running services that need local configuration. Data products, logs, environment files, and generated web snapshots are intentionally excluded from version control.

## Quality checks

```bash
cd apps/web
npm run lint
npm run typecheck
npm test
npm run build
```

```bash
ruff check .
pytest
```

## Deployment

The workflow in `.github/workflows/deploy-pages.yml` refreshes feed snapshots,
ranks them, builds the static application, and deploys it to GitHub Pages. It
runs weekly and on every push to `main`.

There is no database. The ranker fetches the previous deployment's
`data/memory.json`, which records the authors and words the site has seen and
when, scores the new batch against that memory as it stood *before* the batch,
then folds the batch in and republishes it. `data/predictions.json` makes the
same round trip, so the record of what each build claimed survives the build
that replaces it. The deployment is the storage, which is what keeps the whole
thing free to run.

The fold is counted once per paper, ever. The workflow also runs on every push,
and each run refetches the same newest-100-per-category, so without a ledger of
what has already been folded a busy afternoon of commits inflates the corpus by
a factor of ten.

One optional secret:

| Secret | Effect if unset |
| --- | --- |
| `S2_API_KEY` | The build falls back to Semantic Scholar's anonymous pool, which is shared with every other unauthenticated caller. Measured coverage of the reference lane across runs: 86%, 64% and 31% anonymous, against 95% with a key. Keys are free. Every build logs which mode it is in. |

Nothing else is required. Enrichment failures, rate limits and preprints that no
index has reached yet all degrade the ranking rather than failing the deploy.
