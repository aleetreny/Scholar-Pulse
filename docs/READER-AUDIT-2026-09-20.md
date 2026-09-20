# Reader-flow audit — 20 September 2026

The reported `embeddings` discrepancy was real. A failed OpenAlex request was
replaced automatically by a scan of recent feed snapshots. Thus relevance could
show about 657,000 results while Most cited showed 154 different recent papers,
topped by one citation. The warning did not make that behaviour correct.

## Fixes

- Search now uses a bounded, authenticated Cloudflare gateway with public-query
  caching. The key is a server secret. A failed request remains an error; no sort
  or next-page request can change the catalogue.
- Keyword/phrase matching uses OpenAlex's searchable corpus, including indexed
  full text. Author searches use a quoted byline phrase, avoiding a first name
  matching one coauthor and a surname matching another. Author browsing labels
  the actual citation order; wildcard syntax uses the unstemmed search endpoint.
- Pagination separates the provider's indexed total from whether another mapped
  page exists. Concurrent consumers cannot advance the upstream cursor twice.
  Failed pages preserve loaded results and expose a working retry.
- The URL drives query, field and sort, including Back/Forward and author links.
- Search counts retain their OpenAlex work identity on cards, detail pages and
  shared URLs. Another provider or a preprint-only record cannot silently replace
  the count used for sorting. Citation graph counts describe that same work.
- Original arXiv titles, bylines, abstracts and categories are preferred when
  available. A live example was `W2896457183`: OpenAlex returned an unrelated
  health-supplement title for arXiv `1810.04805`; the original record correctly
  restored BERT and its authors. No paper-specific override is used. The date
  remains the index's publication date, which is the field used for Newest.
- Partial feed failures identify the missing discipline and can be retried.
- Library notes persist while typing, before blur/reload. JSON restore preserves
  measured counts and index identity. BibTeX keys include the arXiv identifier,
  avoiding collisions between an author's similarly titled papers in one year.
- Retry/load-more controls and singular citation labels are localized. The
  citation-order explanation is a short source label instead of a warning box.
- Next.js and affected transitive packages were updated to patched versions;
  the npm audit for the final dependency lock reports no known vulnerabilities.

## Coverage and evidence

| Journey | Verification |
| --- | --- |
| `embeddings`, relevance / most cited / newest | Real authenticated API and browser: each returned 656,508 indexed matches; relevance started with FaceNet (11,552 citations), citations with VGG (75,434). |
| Discipline filter | Computer Science changes the query consistently; reload keeps the filter and sort. |
| Sorting during outage | Browser-injected 429 produces an error, zero substitute papers, and a successful retry restores the expected order/count. |
| Load more / failed next page | Existing 20 papers survive failure; retry produces 40 distinct papers without skipping upstream pages. |
| Back/Forward / author links | Browser controls restore the displayed ordering; author links populate the input and use one byline phrase. |
| Detail and citation identity | Card count persists through detail; shared URLs retain the work id. Original arXiv metadata is independently checked. |
| Feed and topics | Fresh onboarding, follow/unfollow, ranked feed; partial snapshot failure and recovery; canonical category aliases retained. |
| Library | Save/remove, reading-status filters, note followed immediately by reload, JSON export/import, unique BibTeX identifiers. |
| Locale/theme/mobile | English/Spanish, persistent dark theme, 390px mobile layout, no horizontal overflow or uncaught browser errors in the tested journeys. |
| Regression protection | 74 data/ranking tests, 6 gateway tests, 2 Playwright reader journeys (19 checkpoints plus partial-feed recovery), lint, TypeScript, static export and 17 native Python tests. |

The automated browser tests run against the actual static export with controlled
upstream responses, including failures. Separate live tests use real services;
their observed totals and counts are a point-in-time check, not frozen fixtures
or a promise that the external index will never change.

## Operational limits

The gateway caches successful queries for one hour and canonical arXiv metadata
for a week. arXiv metadata lookup is optional and bounded: failure leaves index
metadata rather than removing results. It does not validate every citation edge
or repair the underlying index. Counts represent indexed records; duplicate arXiv
versions are displayed once. The OpenAlex key still has a daily quota; exhaustion
is reported explicitly, never as a different set of papers. Worker deployment
and key rotation are documented separately from the existing Pages workflow.

Ranking formulas, historical prediction records and the November prospective
review are unchanged by this reader-flow fix.

Sources: [OpenAlex search and author matching](https://help.openalex.org/api/searching/),
[OpenAlex sorting](https://help.openalex.org/api/sorting/),
[original BERT record](https://arxiv.org/abs/1810.04805).
