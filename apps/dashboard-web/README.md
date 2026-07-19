# ScholarPulse Web

A researcher-first reading companion for arXiv. Fully static — the site is
plain files on GitHub Pages; there is no backend at all.

**Live:** <https://aleetreny.github.io/Scholar-Pulse/>

## What it does

- **For you** — a feed of the newest arXiv submissions in the fields you
  follow (picked during onboarding, editable anytime in *Topics*), with
  *new since your last visit* markers and a "you're caught up" divider.
- **Search** — the arXiv corpus by title, abstract, or author, via Semantic
  Scholar's search API; relevance / newest sorting and a field-of-study
  filter.
- **Paper pages** — abstract with LaTeX rendered via KaTeX, citation count +
  TL;DR + similar papers, and an **In the literature** section that walks the
  citation graph: *Builds on* (most-cited references) and *Cited by*
  (influential follow-up work). PDF / arXiv / DOI links, one-click BibTeX and
  APA copy, clickable authors.
- **Library** — save papers locally, track reading status (to read / reading /
  read), attach notes, and export everything as a `.bib` file (notes travel
  as BibTeX `annote`) or as JSON — which can be imported back on another
  browser or machine (non-destructive merge).
- **RSS per field** — every category ships an RSS feed (`/data/rss/<cat>.xml`,
  linked from *Topics*), so a feed reader can watch your fields without any
  server-side alert infrastructure.
- **English / Spanish UI** — toggle in the masthead; defaults to the browser
  language. arXiv taxonomy names stay in English in both.
- Installable (web manifest), light & dark theme, `/` to search, responsive
  (masthead on desktop, tab bar on mobile).

All personal state (topics, library, notes, recent searches) lives in
`localStorage` — no account, no tracking, nothing leaves the browser except
the API calls that fetch paper data.

## How a static site gets its data

| Need | Source | How |
| --- | --- | --- |
| Feed of newest papers | arXiv API | **Prebuilt snapshots.** The arXiv API sends no CORS headers, so browsers can't call it. `scripts/build-feed-snapshots.mjs` fetches each category's latest submissions at build time and ships them as `public/data/feed/<cat>.json`; CI rebuilds them on a schedule that tracks arXiv's once-per-weekday announcement rhythm. |
| Search, paper lookup, citations, TL;DR, similar papers, citation graph | Semantic Scholar (Graph + Recommendations APIs) | **Live from the browser** (S2 sends CORS headers). Each visitor spends their own rate-limit budget; 429s surface as a friendly retryable message. |

Papers opened from a card also carry their full arXiv record along in
`sessionStorage`, so paper pages render instantly and completely; cold deep
links reconstruct what they can from Semantic Scholar.

## Local dev

```bash
npm install
npm run snapshots -- --cats cs.LG,cs.CL --max 60   # feed data for dev
npm run dev
```

Open `http://localhost:3000`. Run `npm run snapshots` with no flags to fetch
all categories (takes a few minutes — it's polite to arXiv).

### Optional environment variables

| Variable | Purpose |
| --- | --- |
| `ARXIV_API_BASE` | Override the arXiv API base URL for the snapshot script. |
| `NEXT_PUBLIC_S2_API_BASE` | Override the Semantic Scholar base URL (testing/mirrors). |
| `PAGES_BASE_PATH` | Base path when deploying under a subpath (set by CI from `actions/configure-pages`). |
| `SITE_BASE_URL` | Absolute site URL used inside generated RSS feeds (defaults to the live Pages URL). |

## Scripts

- `npm run dev` — dev server
- `npm run build` — static export to `out/`
- `npm run snapshots` — build feed snapshot JSON (`--cats a,b`, `--max N`)
- `npm run lint` — ESLint
- `npm run typecheck` — TypeScript

## Structure

```
scripts/          feed snapshot builder (runs in CI on a schedule)
src/
  app/            pages (feed, search, paper?id=…, library, topics)
  components/     views and shared UI (ledger cards, citation graph, shell)
  lib/data/       client data layer: snapshot feed, Semantic Scholar, caches
  lib/            localStorage stores, citations, categories, formatting
```
