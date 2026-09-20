# ScholarPulse Web

The primary ScholarPulse interface is a static Next.js application for discovering and organizing arXiv research. It is deployed to GitHub Pages, with a small Cloudflare Worker for authenticated, cached search.

[Live application](https://aleetreny.github.io/Scholar-Pulse/)

## Features

- Field-specific feeds with new-since-last-visit indicators.
- OpenAlex keyword/phrase search (including indexed full text); author-name searches use `author:Name`. All orderings use the same corpus.
- Paper pages with references, citations, citation counts, summaries, and related work.
- A private browser-based library with notes and reading status.
- BibTeX export and JSON backup/import.
- English and Spanish interfaces, responsive layout, and light or dark themes.

## Local development

Use Node.js 24 to match CI.

```bash
npm ci
npm run dev
```

Open <http://localhost:3000>.

Feed snapshots are generated into `public/data/`, which is intentionally ignored by Git:

```bash
npm run snapshots -- --cats cs.LG,cs.CL --max 60
```

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the development server. |
| `npm run snapshots` | Fetch arXiv feed snapshots and RSS files. |
| `npm run lint` | Run ESLint. |
| `npm run typecheck` | Validate TypeScript without emitting files. |
| `npm run test:browser` | Run reader journeys against a Pages export built with `PAGES_BASE_PATH=/Scholar-Pulse`. |
| `npm run build` | Create the static export in `out/`. |
| `npm run start` | Serve a non-static production build when applicable. |

## Data sources

| Feature | Source | Runtime model |
| --- | --- | --- |
| Category feeds | arXiv | Snapshots generated during deployment. |
| Search and author lookup | OpenAlex | Authenticated, cached Worker requests; explicit errors, never a different corpus. |
| References and citations | OpenAlex | Same work identity through search, shared links and details. |
| Search titles and authors | arXiv | Original records preferred over merged index metadata; cached for a week. |
| Summaries and related papers | Semantic Scholar | Loaded on demand with graceful fallback. |

Topics, saved papers, notes, reading status, and search history remain in browser `localStorage`.

## Optional environment variables

| Variable | Purpose |
| --- | --- |
| `ARXIV_API_BASE` | Override the arXiv endpoint used by snapshot generation. |
| `NEXT_PUBLIC_OPENALEX_API_BASE` | Override the search gateway for local development (never put a secret here). |
| `NEXT_PUBLIC_S2_API_BASE` | Override the Semantic Scholar API endpoint. |
| `PAGES_BASE_PATH` | Set the GitHub Pages subpath during a static build. |
| `SITE_BASE_URL` | Set the canonical base URL used in generated RSS feeds. |

Search service setup, secrets and deployment: [workers/search-api](../../workers/search-api/README.md).
