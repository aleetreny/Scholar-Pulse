# Scholar Pulse web

The public Next.js application for the Scholar Pulse research showroom. It keeps the original
Scholar Pulse visual language while replacing the map-led dashboard with recent papers and topic
showrooms.

## Commands

```bash
npm ci
npm run dev
npm run typecheck
npm run lint
npm run build
```

`npm run build` creates a static export in `out/`. GitHub Pages supplies `PAGES_BASE_PATH` during
the production build so assets resolve correctly under `/Scholar-Pulse/`.

The paper feed lives at `src/data/showroom.json` and is refreshed from the repository root with:

```bash
python scripts/fetch_recent_papers.py
```
