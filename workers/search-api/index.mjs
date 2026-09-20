import { canonicalize } from "./arxiv.mjs";
/** A bounded, cached OpenAlex gateway. The site and ranking snapshots stay on Pages. */
const SELECT = new Set([
  "id",
  "display_name",
  "publication_date",
  "doi",
  "authorships",
  "locations",
  "cited_by_count",
  "referenced_works",
  "abstract_inverted_index",
]);
const SORT = new Set([
  "cited_by_count:desc",
  "publication_date:desc",
  "relevance_score:desc",
]);
const ALLOWED = new Set([
  "filter",
  "select",
  "search",
  "search.exact",
  "sort",
  "page",
  "per-page",
]);

export function upstreamUrl(input) {
  const url = new URL(input);
  if (url.pathname !== "/works" || url.search.length > 3500) return null;
  const params = url.searchParams;
  for (const key of params.keys())
    if (!ALLOWED.has(key) || params.getAll(key).length !== 1) return null;
  const filter = params.get("filter") ?? "";
  const arxiv =
    /^locations\.source\.id:S4306400194(?:,primary_topic\.field\.id:(?:13|16|17|20|22|25|26|31))?(?:,raw_author_name\.search:"[^,:|"\\]{1,250}")?$/;
  const title =
    /^title\.search:[^,:|]{1,1000},locations\.source\.id:S4306400194$/;
  const doi =
    /^doi:10\.48550\/arxiv\.(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})$/i;
  const graph = /^(?:cites:W\d+|openalex:W\d+(?:\|W\d+){0,49})$/;
  if (![arxiv, title, doi, graph].some((pattern) => pattern.test(filter)))
    return null;
  if (
    !params
      .get("select")
      ?.split(",")
      .every((field) => SELECT.has(field))
  )
    return null;
  if (params.has("sort") && !SORT.has(params.get("sort"))) return null;
  for (const key of ["search", "search.exact"])
    if ((params.get(key)?.length ?? 0) > 512) return null;
  if (params.has("search") && params.has("search.exact")) return null;
  for (const [key, max] of [
    ["per-page", 50],
    ["page", 400],
  ]) {
    const value = params.get(key);
    if (value !== null && (!/^\d+$/.test(value) || +value < 1 || +value > max))
      return null;
  }
  params.sort();
  return new URL(`/works?${params}`, "https://api.openalex.org");
}

function failure(code, status, headers) {
  return Response.json(
    { error: code },
    { status, headers: { ...headers, "Cache-Control": "no-store" } },
  );
}

export async function handle(request, env, ctx, cache, fetchUpstream = fetch) {
  const origin = request.headers.get("Origin");
  const headers = {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    Vary: "Origin",
    "X-Content-Type-Options": "nosniff",
  };
  if (origin && origin !== env.ALLOWED_ORIGIN)
    return failure("forbidden_origin", 403, {});
  if (request.method === "OPTIONS")
    return new Response(null, { status: 204, headers });
  if (request.method !== "GET")
    return failure("method_not_allowed", 405, headers);
  if (new URL(request.url).pathname === "/health")
    return Response.json(
      { ready: Boolean(env.OPENALEX_API_KEY), version: "search-v1" },
      { status: env.OPENALEX_API_KEY ? 200 : 503, headers },
    );
  const upstream = upstreamUrl(request.url);
  if (!upstream) return failure("invalid_query", 400, headers);
  // Cache keys contain only the permitted public query, never an API key.
  const cacheKey = new Request(
    new URL("/v2" + upstream.pathname + upstream.search, request.url),
  );
  const hit = await cache.match(cacheKey);
  if (hit) {
    const cachedHeaders = new Headers(hit.headers);
    for (const [key, value] of Object.entries(headers))
      cachedHeaders.set(key, value);
    cachedHeaders.set("X-Search-Cache", "HIT");
    return new Response(hit.body, {
      status: hit.status,
      headers: cachedHeaders,
    });
  }
  if (!env.OPENALEX_API_KEY)
    return failure("search_unconfigured", 503, headers);
  // Anonymous app: IP is the only server-verifiable caller identifier. Cached
  // requests are exempt; the short, generous limit allows shared networks.
  if (
    !(
      await env.SEARCH_LIMIT.limit({
        key: request.headers.get("CF-Connecting-IP") ?? "unknown",
      })
    ).success
  )
    return failure("rate_limited", 429, { ...headers, "Retry-After": "60" });
  let response;
  try {
    response = await fetchUpstream(upstream, {
      headers: { Authorization: `Bearer ${env.OPENALEX_API_KEY}` },
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    return failure("upstream_unavailable", 503, headers);
  }
  if (!response.ok) {
    // Do not relay upstream messages, which can contain account details.
    const status =
      response.status === 429 ? 429 : response.status === 400 ? 400 : 503;
    let code = status === 400 ? "invalid_query" : "upstream_unavailable";
    if (status === 429) {
      const body = await response.json().catch(() => ({}));
      code = /budget|allowance/i.test(body.message ?? "")
        ? "daily_budget"
        : "rate_limited";
    } else await response.body?.cancel();
    return failure(code, status, headers);
  }
  // Each upstream page is bounded to at most 50 works by validation.
  const data = await canonicalize(
    await response.json(),
    new URL(request.url).origin,
    cache,
    ctx,
    fetchUpstream,
  );
  const result = new Response(JSON.stringify(data), {
    headers: {
      ...headers,
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=3600",
      "X-Search-Cache": "MISS",
    },
  });
  ctx.waitUntil(cache.put(cacheKey, result.clone()));
  return result;
}

export default {
  fetch(request, env, ctx) {
    return handle(request, env, ctx, caches.default);
  },
};
