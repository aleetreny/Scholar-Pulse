# Architecture

ScholarPulse separates the public reading experience from optional local analytics workflows. The public web application stays deployable as static files, while the Python packages can ingest and process larger research datasets independently.

## Components

```text
Scholar-Pulse/
|-- apps/
|   |-- web/                 # Static Next.js application
|   |-- dashboard/           # Optional Plotly analytics dashboard
|   `-- dashboard_api/       # Optional FastAPI data service
|-- research/
|   `-- ranking/           # Offline ranking study and model exporter
|-- pipelines/
|   |-- common/              # Settings, files, logging, and snapshots
|   |-- db/                  # Database models and migrations
|   |-- ingestion/           # arXiv collection and normalization
|   |-- embeddings/          # Embedding export, import, and local execution
|   |-- enrichment/          # External metadata enrichment
|   |-- space/               # Dimensionality reduction and map artifacts
|   |-- similarity/          # Similarity index construction and queries
|   |-- publish/             # Dashboard-ready artifact generation
|   `-- orchestration/       # Repeatable local and Prefect workflows
|-- tests/                   # Unit, integration, and end-to-end tests
|-- infra/                   # Environment-specific setup
|-- docs/                    # Maintainer documentation
`-- data/                    # Local runtime data; contents are not versioned
```

## Public web data flow

1. The deployment workflow runs `apps/web/scripts/build-feed-snapshots.mjs`.
2. The script fetches current arXiv metadata and produces static feed and RSS files.
3. `apps/web/scripts/rank-snapshots.mjs` scores those snapshots (see below) and writes
   the ranking back into them.
4. Next.js exports the application and generated data as a static site.
5. The browser queries OpenAlex and Semantic Scholar for search, citation, and enrichment features.
6. Personal state remains in the browser and can be exported as BibTeX or JSON.

The static application does not depend on the Python services.

## Ranking

Scoring happens entirely at build time; the browser only reads the result. There is
no database and no server.

0. **Harvest.** The snapshot builder writes two things per category: the
   hundred newest papers, which the site displays, and everything submitted in
   the last ten days, which it does not. The second lands in `apps/web/.corpus`
   and exists only to be folded into the memory. They were the same thing until
   it was measured: a hundred papers is ten hours of cs.AI, so the ranking's
   entire view of the field was a hundred papers a week, and 44% of every
   cohort arrived with authors it had never seen. Separating them roughly
   doubles the corpus, from about 3,750 unique papers a week to about 8,000,
   for around 30 extra arXiv requests.
1. **Memory.** The ranker fetches `data/memory.json` from the previously deployed
   site: which authors and which words it has seen, and when. The deployment is
   the storage.

   `scripts/backfill-memory.mjs` fills it with history the site was not running
   for, over arXiv's OAI-PMH endpoint rather than the query API: 1,300 records
   a request across every category at once, against roughly 2,500 requests to
   cover the same ground category by category. OAI answers HTTP 503 while it
   assembles a response, which the protocol intends and the script retries. It
   folds a month at a time, records each finished month in the memory, and
   stops on a month boundary when its budget runs out, so it is safe to
   interrupt and safe to re-run. Author names are rebuilt as forenames then
   keyname to match what the Atom feed produces; on 119 papers present in both
   sources the two agreed exactly, which is the property that makes the
   backfill merge into existing author records rather than duplicate every
   researcher. Budget about 160 bytes of memory.json per paper folded. Signals are computed against that memory as it stood *before* the
   batch being scored, so no paper is credited with a track record its authors
   gained this morning.
2. **Enrichment.** Two indexes, asked for different things. Semantic Scholar goes
   first, four hundred arXiv ids per request, because it parses preprint PDFs and
   is therefore the only source of reference counts, the strongest cold-start
   signal in the study. OpenAlex follows, fifty DOIs per request, for citation
   counts: it has a record for ~97% of submissions within days, but it catalogues
   a preprint *without* parsing its bibliography, so its `referenced_works_count`
   is zero for all of them and is deliberately discarded. Recording that zero
   would tell the ranker "this paper cites nothing" when the truth is "we have
   not looked", and the reference lane cannot tell those apart.

   Optional by construction: failures, rate limits and preprints that are not
   indexed yet all reduce to "this paper is ranked on fewer lanes". Semantic
   Scholar's anonymous pool is shared with every other unauthenticated caller and
   throttles hard, so a 429 is treated as routine rather than exceptional. Three
   things follow, and consecutive production runs needed all of them: the run
   backs off and continues instead of abandoning the remaining batches; batches
   are striped across the feed rather than cut contiguously, so a request that
   does fail costs every field a slice of its coverage instead of costing a few
   fields all of theirs; and throttled batches are retried once at the end of the
   pass, since a 429 means the pool was busy just then, not that those papers are
   unknowable.

   All three help, and none of them was a cure. Three consecutive production runs
   of the same code got 86%, 64% and 31% of the feed: the anonymous pool is
   shared with the whole internet, and no local backoff fixes a queue somebody
   else is filling.

   The actual fix is the `S2_API_KEY` secret, which is set. A key carries its own
   rate limit of one request per second, so the build no longer competes for the
   shared pool, and requests are spaced 1.1s apart instead of 3s, so the whole pass
   takes about fifteen seconds. The code still runs without a key, at the pool's
   mercy, so this is a coverage improvement rather than a dependency; every build
   logs which of the two modes it is in, because a mistyped secret would
   otherwise degrade to anonymous silently and look like a bad day upstream.

   The graceful degradation stays regardless of the key, and it is the part worth
   keeping: nothing is ever recorded as a zero that was not measured, and
   whatever fails, fails evenly across fields. Even the 31% run produced a
   reference lane in 61 of 78 cohorts, built entirely from real counts.
3. **Scoring.** `apps/web/src/lib/ranking/` turns signals into a percentile within
   the paper's own field, fuses the available lanes by reciprocal rank, ranks
   papers with no author history in a separate lane, and assigns a band.
4. **Fold forward.** The batch is folded into the memory and written back out for
   the next build, so the corpus the ranker learns from grows on its own. The
   memory is pruned to a two-year window and holds only author records, term
   frequencies and monthly volumes, roughly 1 MB, so it cannot grow without
   bound as the site keeps running.

   Each paper is folded exactly once. The workflow runs on every push as well
   as weekly, and every run refetches the same newest-100-per-category, so the
   memory carries a ledger of ids it has already counted. Without it, the
   eleven builds in the thirty-one hours after the ranking launched recorded 39,312
   papers for August against a feed of 5,248, and gave twenty thousand authors
   a publication count of twelve for a fortnight of arXiv.
5. **Record the claim.** The build appends what it ranked to
   `data/predictions.json`: the full front page and notable band, plus a
   deterministic one-in-sixteen sample of the rest as a control group. That
   file rides the same round trip through the deployment as the memory does,
   pruned to twelve months and sixty builds. It exists because none of the
   other outputs survive: the feed snapshots are overwritten each week and the
   Pages artifact expires after a day, so before this the site kept no record
   of anything it had ever claimed. `scripts/verify-ranking.mjs` reads the log
   back, asks Semantic Scholar what those papers collected, and scores the
   bands against the outcome, declining to judge cohorts under ninety days
   old.

Model coefficients live in `apps/web/src/lib/ranking/model.generated.ts` and are
produced by `research/ranking/export_model.py`. They are generated, not authored:
regenerate rather than edit.

## Analytics data flow

1. `pipelines/ingestion/` stores normalized paper metadata in the configured database.
2. Embedding and enrichment jobs create versioned artifacts under `data/`.
3. Space and similarity jobs derive visualization and retrieval artifacts.
4. `pipelines/publish/` prepares compact data products for the optional dashboard and API.

Generated data, logs, credentials, dependency directories, and build outputs are excluded from version control. Only source code, migrations, tests, configuration examples, and documentation belong in the repository.
