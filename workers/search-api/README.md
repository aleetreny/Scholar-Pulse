# ScholarPulse search service

The GitHub Pages app calls this bounded OpenAlex gateway. An anonymous browser
previously shared its network's tiny daily OpenAlex allowance; when it ran out,
the app silently replaced the complete search with recent snapshots. The gateway
uses a server-side key and caches each public query for one hour. The frontend
now reports an error if the index fails and never substitutes another corpus.

Production: `https://scholar-pulse-search.alejandrotreny100.workers.dev`.
`GET /health` reports whether the key is configured (not upstream availability).

## Deploy

```sh
npm ci
npm test
npm run check
npm run deploy
npx wrangler secret put OPENALEX_API_KEY
```

Wrangler uses the existing Cloudflare account. The service fits the Workers Free
plan. No paid plan or OpenAlex overage purchase is configured by this change.
The API key is a Worker secret, never `NEXT_PUBLIC_*`, a URL parameter, a cache
key, or a repository file. Rotate the Worker secret when rotating the key in
GitHub's `OPENALEX_API_KEY` environment; they are independent secret stores.

The public frontend origin is configured in `wrangler.jsonc`. Local tests mock
requests or use a local worker with a local origin; do not put the production
key in the frontend. The worker deliberately exposes only bounded `/works`
queries used by this app, not an arbitrary OpenAlex proxy. It caches successful
responses only, prefers original arXiv titles/authors over merged OpenAlex metadata
(with a per-paper week-long cache and a bounded optional batch lookup), applies a short per-IP limit to cache misses, sanitizes upstream
errors, and fails closed if no key is configured. Limits are per Cloudflare
location; the OpenAlex account's own daily quota remains the final cap. A 429
can still occur, and must remain an explicit retryable failure in the app.

The Pages workflow continues to publish the frontend and ranking snapshots.
Deploy this service with Wrangler when its source/configuration changes. The
repository Checks workflow runs its tests and deployment validation.
