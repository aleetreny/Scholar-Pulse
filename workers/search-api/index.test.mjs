import test from "node:test";
import assert from "node:assert/strict";
import { handle, upstreamUrl } from "./index.mjs";
const query =
  "https://search.example/works?filter=locations.source.id%3AS4306400194&select=id,display_name&search=embeddings&sort=cited_by_count:desc&per-page=25&page=1";
function harness(overrides = {}) {
  const stored = new Map(),
    tasks = [];
  return {
    env: {
      OPENALEX_API_KEY: "test-secret",
      ALLOWED_ORIGIN: "https://aleetreny.github.io",
      SEARCH_LIMIT: { limit: async () => ({ success: true }) },
      ...overrides,
    },
    ctx: { waitUntil: (p) => tasks.push(p) },
    cache: {
      match: async (k) => stored.get(k.url)?.clone(),
      put: async (k, v) => stored.set(k.url, v),
    },
    tasks,
  };
}
test("gateway permits app searches/graph queries and rejects arbitrary proxy parameters", () => {
  assert.ok(upstreamUrl(query));
  for (const suffix of [
    "&api_key=stolen",
    "&mailto=someone",
    "&search=second",
    "&page=2",
    "&cursor=*",
  ])
    assert.equal(upstreamUrl(query + suffix), null);
  assert.equal(upstreamUrl(query.replace("S4306400194", "S123")), null);
  assert.equal(upstreamUrl(query.replace("per-page=25", "per-page=200")), null);
  assert.equal(upstreamUrl(query.replace("/works?", "/authors?")), null);
  assert.ok(
    upstreamUrl(
      query.replace("locations.source.id%3AS4306400194", "cites:W123"),
    ),
  );
});
test("one upstream request serves repeated queries and never exposes the credential", async () => {
  const h = harness();
  let calls = 0;
  const fetch = async (url, init) => {
    calls++;
    assert.equal(init.headers.Authorization, "Bearer test-secret");
    assert.ok(!String(url).includes("test-secret"));
    return Response.json({ meta: { count: 657000 }, results: [] });
  };
  const one = await handle(new Request(query), h.env, h.ctx, h.cache, fetch);
  assert.equal(one.status, 200);
  await Promise.all(h.tasks);
  const two = await handle(new Request(query), h.env, h.ctx, h.cache, fetch);
  assert.equal(calls, 1);
  assert.equal(two.headers.get("X-Search-Cache"), "HIT");
  assert.equal((await two.json()).meta.count, 657000);
});
test("service fails closed before a key is configured", async () => {
  const h = harness({ OPENALEX_API_KEY: "" });
  const result = await handle(new Request(query), h.env, h.ctx, h.cache, () =>
    assert.fail("must not spend anonymous allowance"),
  );
  assert.equal(result.status, 503);
});
test("upstream budget errors are explicit, sanitized and not cached", async () => {
  const h = harness();
  const result = await handle(
    new Request(query),
    h.env,
    h.ctx,
    h.cache,
    async () =>
      Response.json(
        { message: "Insufficient budget for secret-account" },
        { status: 429 },
      ),
  );
  assert.equal(result.status, 429);
  assert.deepEqual(await result.json(), { error: "daily_budget" });
  assert.equal(h.tasks.length, 0);
});
test("unsupported origins and excessive uncached requests are rejected", async () => {
  const h = harness({
    SEARCH_LIMIT: { limit: async () => ({ success: false }) },
  });
  const foreign = await handle(
    new Request(query, { headers: { Origin: "https://unrelated.example" } }),
    h.env,
    h.ctx,
    h.cache,
    () => assert.fail(),
  );
  assert.equal(foreign.status, 403);
  const limit = await handle(new Request(query), h.env, h.ctx, h.cache, () =>
    assert.fail(),
  );
  assert.equal(limit.status, 429);
  assert.equal(limit.headers.get("Retry-After"), "60");
});

test("arXiv identity replaces corrupt index titles while preserving counts and order", async () => {
  const h = harness();
  let arxivCalls = 0;
  const upstream = async (url) => {
    if (url.hostname === "export.arxiv.org") {
      arxivCalls++;
      return new Response(
        '<feed><entry><id>http://arxiv.org/abs/1810.04805v2</id><title>BERT: Pre-training of Deep Bidirectional Transformers</title><summary>Original abstract</summary><author><name>Jacob Devlin</name></author><category term="cs.CL"/><arxiv:primary_category term="cs.CL"/></entry></feed>',
      );
    }
    return Response.json({
      meta: { count: 1 },
      results: [
        {
          id: "W2896457183",
          display_name: "Incorrect merged title",
          cited_by_count: 46030,
          locations: [{ landing_page_url: "http://arxiv.org/abs/1810.04805" }],
        },
      ],
    });
  };
  const result = await handle(
    new Request(query),
    h.env,
    h.ctx,
    h.cache,
    upstream,
  );
  const data = await result.json();
  assert.equal(
    data.results[0].arxiv_metadata.title,
    "BERT: Pre-training of Deep Bidirectional Transformers",
  );
  assert.equal(data.results[0].cited_by_count, 46030);
  assert.equal(data.meta.count, 1);
  await Promise.all(h.tasks);
  await handle(
    new Request(query.replace("cited_by_count:desc", "publication_date:desc")),
    h.env,
    h.ctx,
    h.cache,
    upstream,
  );
  assert.equal(arxivCalls, 1);
});
