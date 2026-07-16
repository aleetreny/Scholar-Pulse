# ScholarPulse Web

A researcher-first web app for staying on top of the literature. Next.js +
TypeScript, no backend required — it talks to public scholarly APIs through
its own server-side route handlers.

## What it does

- **For you** — a feed of the newest arXiv submissions in the fields you
  follow (picked during onboarding, editable anytime in *Topics*).
- **Search** — full arXiv search with phrase support (`"state space models"`),
  field filter, and relevance / newest / recently-updated sorting.
- **Paper pages** — full abstract with LaTeX rendered via KaTeX, citation
  count + TL;DR + similar papers (Semantic Scholar), PDF / arXiv / DOI links,
  one-click BibTeX and APA citation copy.
- **Library** — save papers locally, track reading status (to read / reading /
  read), attach notes, and export everything as a `.bib` file.
- Light & dark theme, keyboard shortcut `/` to search, fully responsive
  (sidebar on desktop, tab bar on mobile).

All personal state (topics, library, notes, recent searches) lives in
`localStorage` — no account, no server-side storage.

## Data sources

| Source | Used for | Endpoint |
| --- | --- | --- |
| arXiv API | feed, search, paper metadata | `export.arxiv.org/api` |
| Semantic Scholar Graph | citations, venue, TL;DR | `api.semanticscholar.org/graph/v1` |
| Semantic Scholar Recommendations | similar papers | `api.semanticscholar.org/recommendations/v1` |

Requests are proxied through Next.js route handlers (`src/app/api/*`) with
in-memory caching (5 min for arXiv, 30 min for Semantic Scholar), so the
browser never talks to third parties directly and upstream rate limits are
respected. Semantic Scholar enrichment is optional: when it is unavailable the
paper page still renders and says so.

## Local dev

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. No environment variables are required.

### Optional environment variables

| Variable | Purpose |
| --- | --- |
| `ARXIV_API_BASE` | Override the arXiv API base URL (testing/mirrors). |
| `S2_API_BASE` | Override the Semantic Scholar base URL. |

## Scripts

- `npm run dev` — dev server
- `npm run build` — production build
- `npm run start` — serve the production build
- `npm run lint` — ESLint
- `npm run typecheck` — TypeScript

## Structure

```
src/
  app/            pages (feed, search, paper/[...id], library, topics)
  app/api/        route handlers proxying arXiv + Semantic Scholar
  components/     views and shared UI (cards, states, shell, KaTeX text)
  lib/            client api, localStorage stores, citations, formatting
  lib/server/     upstream clients (arXiv Atom parsing, Semantic Scholar)
```
