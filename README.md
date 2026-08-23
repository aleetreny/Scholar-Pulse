# ScholarPulse

ScholarPulse is a researcher-focused discovery platform for exploring recent
arXiv literature, following fields, investigating citation networks, and
maintaining a private reading library.

Its feed is ranked rather than chronological: every paper is scored at build
time for how likely it is to matter, using only what is knowable on the day it
appears.

[Open the live application](https://aleetreny.github.io/Scholar-Pulse/)

## Highlights

- Personalized feeds built from scheduled arXiv snapshots, ranked by predicted impact.
- A calibrated 0-100 score per paper, with the signals behind it shown on the paper page.
- Citation and reference counts that appear immediately, because the build carries them into the snapshot rather than asking an external index while the reader waits.
- Full-corpus search, author lookup and a citation graph through OpenAlex.
- Local reading lists, notes, status tracking, and BibTeX or JSON export.
- English and Spanish interfaces with responsive light and dark themes.
- Static deployment: no hosted backend, no database, no user account, no paid API.

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

**Corpus memory.** The signals about authors and vocabulary are only as good as
what the site has seen, so the harvest is deliberately wider than the feed. Each
build takes the hundred newest papers per category for display and everything
submitted in the last ten days for the memory, and the memory is carried across
deployments rather than rebuilt. `npm run backfill` fills in history the site was
never running for. This matters more than any other single lever: with a
hundred papers a week per field the memory had never seen the authors of 44% of
any cohort, and the four author signals, 45% of the model's weight, went
constant inside that pool and dropped out of the ranking entirely.

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
their own pool and hold a reserved 30% of the board. Without it, hits from
unknown authors landed at the 49th percentile against the 88th for established
ones, and the score was learning reputation as much as merit. With a
backfilled memory the pool is now empty in practice, which is the intended
state: the reservation was protection against a cold start, not a permanent
feature of the ranking.

## How well it works

Two numbers get quoted about this system and they measure different things.
Keeping them apart is the point of this section.

**The offline study**, on 2017-18 cs.LG and cs.CL papers against a curated list
of landmarks, reached **AUC 0.79** (95% CI 0.76-0.83) and **5.5x lift in the top
10%** against a 1.4% base rate. That is the evidence that cold-start ranking is
possible at all. It is not a measurement of this feed and should never be read
as one.

**The deployed system**, replayed over February and March 2026 in cs.LG, cs.CL
and hep-th and graded against the citations those papers had collected by
August, looks like this. Twenty-seven cohorts, 2,576 papers, five to six months
of accrual, confidence intervals bootstrapped over cohorts.

| Ranker | NDCG@10 | lift@10 |
| --- | --- | --- |
| **as deployed** | **0.414** [0.374, 0.458] | **1.68x** |
| reference count alone | 0.417 [0.370, 0.474] | 1.63x |
| the twelve signals alone | 0.317 [0.284, 0.353] | 1.44x |
| random shuffle | 0.339 [0.293, 0.383] | 1.22x |
| newest first | 0.258 [0.225, 0.290] | 1.03x |

Three honest conclusions:

1. **The feed beats the feed it replaced**, by +0.156 NDCG@10 [0.106, 0.205] and
   in 85% of cohorts. Chronological ordering is worse than a shuffle, which is
   the premise the whole project rests on, and it replicates on 2026 data.
2. **The improvement is real but modest**, and much smaller than the offline
   study suggests. 1.7x, not 5.5x.
3. **Most of it came from the reference count, not from the model.** Sorting by
   nothing but bibliography length scored 0.417 against the full system's 0.414.
   On their own the twelve signals ranked below a shuffle.

Point three was a coverage problem rather than a modelling one, and it has been
fixed. Given a memory that has actually seen the field, the same twelve signals
move from 0.317 to 0.393, above the shuffle, and their AUC on the papers that
passed twenty citations goes from 0.698 to 0.800. The live site now runs on a
memory of 516,858 authors across thirteen months, against 42,565 across five,
and the share of each cohort with no author history has gone from 46.8% to 0%.

Whether that lands as predicted is not yet knowable, and the next section is how
it gets answered rather than argued.

The measurement, every arm of it, and the study behind the model are in
[research/ranking](research/ranking/README.md), including the hypotheses that
failed.

## Checking it against reality

A model that validated offline can still be wrong in production, and this one
kept no record it could be judged by: each build overwrote the feed snapshots
and the deployment artifact expired within a day.

Every build now writes down what it claimed, in `data/predictions.json`: the
whole front page and notable band, plus one paper in sixteen from the rest as a
control group, carried across deployments the same way the corpus memory is.

```bash
cd apps/web && npm run verify
```

That reads the log, asks Semantic Scholar what those papers have collected
since, and reports the base rate, the weighted AUC and the lift of each band
against what actually happened.

**It will refuse to answer until a cohort is ninety days old**, and that is the
honest answer rather than a limitation: a preprint has no citations because it
is a preprint, and the study measured that a cohort needs about three months
before its top ten has settled into its field's top decile. The log starts on
2026-08-23, so the first cohort is gradable from **2026-11-21**.

## Repository layout

| Path | Purpose |
| --- | --- |
| `apps/web/` | Primary Next.js web application deployed to GitHub Pages. |
| `apps/dashboard/` | Optional Plotly dashboard for locally generated analytics artifacts. |
| `apps/dashboard_api/` | Optional FastAPI service for dashboard data. |
| `pipelines/` | Ingestion, enrichment, embeddings, indexing, and orchestration workflows. |
| `research/ranking/` | The study behind the ranking, and the backtest of the deployed system. |
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

Open <http://localhost:3000>. To generate fresh local feed data before starting
the app:

```bash
npm run snapshots -- --cats cs.LG,cs.CL --max 60
npm run rank -- --no-enrich   # score them; --no-enrich skips the external index
```

The ranking maths has its own tests:

```bash
npm test
```

Two operational commands, both safe to interrupt and safe to re-run:

```bash
npm run verify                  # score past predictions against real citations
npm run backfill -- --months 12 # fold arXiv history into the corpus memory
```

The backfill records the months it has folded in the memory itself and stops on
a month boundary when its budget runs out, so several runs finish a long one. In
CI it is the `backfill_months` input on the deploy workflow, which publishes the
result so the next build carries it forward. Budget roughly 160 bytes of
`memory.json` per paper folded, and four to eight minutes per month of arXiv
depending on how busy the month was.

## Run the Python toolchain

Python 3.11 or later is required.

```bash
python -m venv .venv
source .venv/bin/activate
python -m pip install -e ".[dev,dashboard]"
pytest
```

Copy `.env.example` to `.env` only when running services that need local
configuration. Data products, logs, environment files, and generated web
snapshots are intentionally excluded from version control.

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

The workflow in `.github/workflows/deploy-pages.yml` harvests arXiv, ranks the
result, builds the static application, and deploys it to GitHub Pages. It runs
weekly, on every push to `main`, and on demand. A normal run takes about eight
minutes.

There is no database. The ranker fetches the previous deployment's
`data/memory.json`, which records the authors and words the site has seen and
when, scores the new batch against that memory as it stood *before* the batch,
then folds the batch in and republishes it. `data/predictions.json` makes the
same round trip, so the record of what each build claimed survives the build
that replaces it. The deployment is the storage, which is what keeps the whole
thing free to run.

Each paper is folded into the memory exactly once, ever. The workflow also runs
on every push and each run refetches the same window, so without a ledger of
what has already been counted a busy afternoon of commits inflates the corpus by
an order of magnitude: eleven builds ran in the thirty-one hours after the
ranking launched.

**Upstreams.** Semantic Scholar supplies reference and citation counts at build
time, four hundred arXiv ids per request; it is the only free index that parses
preprint bibliographies. OpenAlex serves the browser for search, author lookup
and the citation graph. It used to supply citation counts to the build as well,
and no longer does: measured on the same run it added 33 papers S2 did not know
about, every one of them a zero, and it has since started metering its free
tier, so the pass was a billed dependency in the critical path buying nothing.

One optional secret:

| Secret | Effect if unset |
| --- | --- |
| `S2_API_KEY` | The build falls back to Semantic Scholar's anonymous pool, which is shared with every other unauthenticated caller. With the key set, recent builds match 99.8% of the feed; anonymous runs measured 86%, 64% and 31%. Keys are free. Every build logs which mode it is in. |

Nothing else is required. Enrichment failures, rate limits and preprints that no
index has reached yet all degrade the ranking rather than failing the deploy,
and the build names any signal that did not participate along with the share of
the model's weight it withdrew.
