# ScholarPulse Web

The primary ScholarPulse interface is a static Next.js application for discovering and organizing arXiv research. It is deployed to GitHub Pages and does not require a hosted application server.

[Live application](https://aleetreny.github.io/Scholar-Pulse/)

## Features

- Field-specific feeds with new-since-last-visit indicators.
- OpenAlex search across titles, abstracts, and authors.
- Paper pages with references, citations, citation counts, summaries, and related work.
- A private browser-based library with notes and reading status.
- BibTeX and JSON import or export.
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
| `npm run build` | Create the static export in `out/`. |
| `npm run start` | Serve a non-static production build when applicable. |

## Data sources

| Feature | Source | Runtime model |
| --- | --- | --- |
| Category feeds | arXiv | Snapshots generated during deployment. |
| Search and author lookup | OpenAlex | Direct browser requests with local snapshot fallback. |
| References and citations | OpenAlex | Loaded on demand and cached for the session. |
| Summaries and related papers | Semantic Scholar | Loaded on demand with graceful fallback. |

Topics, saved papers, notes, reading status, and search history remain in browser `localStorage`.

## Optional environment variables

| Variable | Purpose |
| --- | --- |
| `ARXIV_API_BASE` | Override the arXiv endpoint used by snapshot generation. |
| `NEXT_PUBLIC_OPENALEX_API_BASE` | Override the OpenAlex API endpoint. |
| `NEXT_PUBLIC_S2_API_BASE` | Override the Semantic Scholar API endpoint. |
| `PAGES_BASE_PATH` | Set the GitHub Pages subpath during a static build. |
| `SITE_BASE_URL` | Set the canonical base URL used in generated RSS feeds. |
