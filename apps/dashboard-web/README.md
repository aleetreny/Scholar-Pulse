# ScholarPulse Web

A researcher-first reading companion for arXiv. Fully static — served directly on GitHub Pages with zero required backend infrastructure.

**Live Demo:** <https://aleetreny.github.io/Scholar-Pulse/>

---

## Key Features

- **For You Feed (`/`)**
  - Personal feed of the newest arXiv submissions in the fields you follow.
  - Interactive topic pills with **strict primary-category filtering** when focusing on a single field.
  - *New since your last visit* indicators and a "you're caught up" divider.
- **Instant Corpus Search (`/search`)**
  - Search across arXiv papers by title, abstract, or author name.
  - **Author Search**: Clicking any author's name inside a paper page automatically opens search for all papers by that author.
  - **Multi-tiered Search Engine**: Powered by live **arXiv API** query parsing with automatic fallback handling, avoiding rate limits.
  - Sort by relevance or newest, and filter by broad field of study.
- **Paper Detail View (`/paper?id=...`)**
  - Full paper abstracts with LaTeX equations rendered via KaTeX.
  - Citation counts, TL;DR summaries, and AI-recommended similar papers.
  - **In the Literature (Citation Graph)**: Explore *Builds on* (references) and *Cited by* (citations).
  - Quick actions: PDF / arXiv / DOI direct links, one-click BibTeX and APA citation copy, and clickable author links.
- **Personal Reading Library (`/library`)**
  - Save papers locally and track reading status (*To read*, *Reading*, *Read*).
  - Attach personal research notes to any saved paper.
  - Export reading list as `.bib` (notes exported as BibTeX `annote`) or JSON for seamless cross-device sync.
- **Topics & Per-Field RSS (`/topics`)**
  - Customize your followed disciplines anytime.
  - Every arXiv category ships a static RSS feed (`/data/rss/<cat>.xml`) for external feed readers.
- **Bilingual UI (English / Spanish)**
  - Toggle UI language instantly in the top navigation bar.
- **Modern Responsive Design**
  - Clean typography, custom card spacing, vertical hover indicators, light/dark mode support, and keyboard shortcut (`/` to focus search).

---

## How it Works (Data Architecture)

| Feature | Data Source | Method |
| --- | --- | --- |
| **Category Feed** | arXiv API | **Prebuilt Snapshots**: Static snapshots (`/data/feed/<cat>.json`) built by scheduled CI runs. Filtered on the client by primary category when focusing on a single field. |
| **Search & Author Lookup** | OpenAlex API | **Live Client Queries**: Full-corpus search scoped to arXiv (`locations.source.id`), relevance/newest sorting, field-of-study filter, and an `author:Name` operator (exact `raw_author_name` filter). Sub-second, CORS-enabled, no key required. Falls back to a local scan of the shipped snapshots if unreachable. |
| **Citations & Graph** | OpenAlex API | **Live Client Calls**: "Builds on" (batched lookup of `referenced_works`) and "Cited by" (`cites:` filter), most-cited first, loaded on expand with session caching. |
| **TL;DR & Similar Papers** | Semantic Scholar API | **Live Client Calls**: TLDRs, recommendations, and version-merged citation metrics — data OpenAlex doesn't have. Degrades gracefully when S2's shared rate-limit pool is saturated (OpenAlex covers the citation count as fallback). |

*Personal data (topics, saved papers, notes, reading statuses, search history) is stored exclusively in `localStorage` — no tracking, no accounts required.*

---

## Local Development

```bash
cd apps/dashboard-web
npm install
npm run snapshots -- --cats cs.LG,cs.CL --max 60   # fetch dev feed snapshots
npm run dev
```

Open `http://localhost:3000` in your browser.

### Available Scripts

- `npm run dev` — Launch Next.js local development server.
- `npm run build` — Build static export (`out/` directory).
- `npm run snapshots` — Generate static feed snapshots from arXiv (`--cats a,b`, `--max N`).
- `npm run lint` — Run ESLint checks.
- `npm run typecheck` — Run TypeScript type validation (`tsc --noEmit`).

---

## Environment Variables (Optional)

| Variable | Description |
| --- | --- |
| `ARXIV_API_BASE` | Override the arXiv API base URL for snapshot generation. |
| `NEXT_PUBLIC_OPENALEX_API_BASE` | Override the OpenAlex API base URL. |
| `NEXT_PUBLIC_S2_API_BASE` | Override the Semantic Scholar API base URL. |
| `PAGES_BASE_PATH` | Subpath base path for GitHub Pages deployment. |
| `SITE_BASE_URL` | Absolute canonical URL for generated RSS feeds. |
