import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { matchesSnapshot, sortSnapshotMatches } from "./search-options.ts";
import { makePaper } from "../test-fixtures.ts";
import { getFeed, searchSnapshots } from "./feed.ts";
import { searchPapers } from "./openalex.ts";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("a focused discipline retains cross-listed work and its discipline-specific score", async () => {
  const cross = makePaper("2609.12345", {
    primaryCategory: "cs.AI",
    categories: ["cs.AI", "cs.LG"],
  });
  globalThis.fetch = async (url) => {
    const category = String(url).includes("cs.LG") ? "cs.LG" : "cs.AI";
    const pulse = {
      score: category === "cs.LG" ? 90 : 10,
      tier: "notable",
      lanes: [],
      reasons: [],
      newcomer: false,
      cohort: category,
    };
    return new Response(
      JSON.stringify({
        category,
        fetchedAt: "2026-09-19",
        papers: [{ ...cross, pulse }],
      }),
    );
  };
  const feed = await getFeed(["cs.AI", "cs.LG"], 0, 20, "cs.LG", "pulse");
  assert.equal(feed.papers.length, 1);
  assert.equal(feed.papers[0].id, cross.id);
  assert.equal(feed.papers[0].pulse?.cohort, "cs.LG");
  assert.equal(feed.papers[0].pulse?.score, 90);
});

test("the combined feed prefers a followed primary discipline's score", async () => {
  const cross = makePaper("2609.23456", {
    primaryCategory: "cs.RO",
    categories: ["cs.CV", "cs.RO"],
  });
  globalThis.fetch = async (url) => {
    const category = String(url).includes("cs.RO") ? "cs.RO" : "cs.CV";
    const pulse = {
      score: category === "cs.RO" ? 90 : 10,
      tier: "notable",
      lanes: [],
      reasons: [],
      newcomer: false,
      cohort: category,
    };
    return new Response(
      JSON.stringify({
        category,
        fetchedAt: "2026-09-19",
        papers: [{ ...cross, pulse }],
      }),
    );
  };
  const feed = await getFeed(["cs.CV", "cs.RO"], 0, 20);
  assert.equal(feed.papers.length, 1);
  assert.equal(feed.papers[0].pulse?.cohort, "cs.RO");
  assert.equal(feed.papers[0].pulse?.score, 90);
  assert.deepEqual(await getFeed(["cs.RO", "cs.CV"], 0, 20), feed);
});

test("fallback finds cross-listings retained only in another discipline's snapshot", async () => {
  const cross = makePaper("2609.34567", {
    title: "Symbolic logic",
    primaryCategory: "math.LO",
    categories: ["math.LO", "cs.PL"],
  });
  globalThis.fetch = async (url) =>
    new Response(
      JSON.stringify(
        String(url).endsWith("manifest.json")
          ? { generatedAt: "2026-09-19", categories: ["math.LO", "cs.PL"] }
          : {
              category: String(url).includes("math.LO") ? "math.LO" : "cs.PL",
              fetchedAt: "2026-09-19",
              papers: String(url).includes("math.LO") ? [cross] : [],
            },
      ),
    );
  const result = await searchSnapshots("logic", [], 0, 20, {
    fieldId: 17,
    sort: "citations",
  });
  assert.equal(result.papers.length, 1);
  assert.equal(result.papers[0].id, cross.id);
});

test("fallback respects discipline and author filters", () => {
  const paper = makePaper("test", {
    title: "Ada computes",
    authors: ["Grace Hopper"],
  });
  assert.ok(matchesSnapshot(paper, "Grace", 17, true));
  assert.ok(!matchesSnapshot(paper, "Ada", 17, true));
  assert.ok(!matchesSnapshot(paper, "", 31, false));
  assert.ok(matchesSnapshot(paper, "", 17, false));
});

test("most-cited fallback keeps unknown citations distinct from zero", () => {
  const metrics = (citations: number) => ({
    citations,
    references: null,
    asOf: "2026-09-19",
  });
  const rows = [
    makePaper("unknown"),
    makePaper("zero", { metrics: metrics(0) }),
    makePaper("known", { metrics: metrics(50) }),
  ];
  assert.deepEqual(
    sortSnapshotMatches(rows, "citations").map((paper) => paper.id),
    ["known", "zero", "unknown"],
  );
});

test("query-free field exploration sends an explicit most-cited request", async () => {
  let requested = "";
  globalThis.fetch = async (url) => {
    requested = String(url);
    return new Response(JSON.stringify({ meta: { count: 0 }, results: [] }));
  };
  const result = await searchPapers("", 31, "citations", 0, 20);
  const url = new URL(requested);
  assert.equal(url.searchParams.get("sort"), "cited_by_count:desc");
  assert.equal(url.searchParams.get("search"), null);
  assert.ok(
    url.searchParams.get("filter")!.includes("primary_topic.field.id:31"),
  );
  assert.equal(result.source, "openalex");
});

test("saved Statistics Theory aliases load the canonical ranked feed once", async () => {
  const requests: string[] = [];
  const paper = makePaper("2609.45678", {
    primaryCategory: "math.ST",
    categories: ["math.ST"],
    pulse: {
      score: 95,
      tier: "headline",
      lanes: [],
      newcomer: false,
      reasons: [],
      cohort: "math.ST",
    },
  });
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    assert.ok(String(url).endsWith("/math.ST.json"));
    return new Response(
      JSON.stringify({
        category: "math.ST",
        fetchedAt: "2026-09-19",
        papers: [paper],
      }),
    );
  };
  const focused = await getFeed(["stat.TH"], 0, 20, "stat.TH");
  assert.equal(focused.papers[0].id, paper.id);
  assert.equal(focused.papers[0].pulse?.cohort, "math.ST");
  const combined = await getFeed(["stat.TH", "math.ST"], 0, 20);
  assert.equal(combined.papers.length, 1);
  assert.equal(requests.length, 1);
});

test("sorts search the same corpus and retain its indexed total after deduplication", async () => {
  const filters: string[] = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    filters.push(url.searchParams.get("filter")!);
    const citations = url.searchParams.get("sort") === "cited_by_count:desc";
    const results = [12000, 20000].map((count, index) => ({
      id: `https://openalex.org/W${100 + index}`,
      doi: `https://doi.org/10.48550/arxiv.1503.0000${index}`,
      display_name: `Embedding ${index}`,
      cited_by_count: count,
    }));
    return Response.json({
      meta: { count: 2 },
      results: citations ? results.reverse() : results,
    });
  };
  const relevance = await searchPapers(
    "sort-regression",
    null,
    "relevance",
    0,
    20,
  );
  const citations = await searchPapers(
    "sort-regression",
    null,
    "citations",
    0,
    20,
  );
  assert.deepEqual(filters, [
    "locations.source.id:S4306400194",
    "locations.source.id:S4306400194",
  ]);
  assert.equal(citations.totalResults, relevance.totalResults);
  assert.ok(
    citations.papers[0].metrics!.citations! >=
      relevance.papers[0].metrics!.citations!,
  );
  assert.equal(citations.papers[0].metrics!.workId, "W101");
  assert.equal(citations.hasMore, false);
});

test("an unavailable most-cited query never becomes a recent-snapshot search", async () => {
  const { searchPapers: entryPoint } = await import("./search.ts");
  const requests: string[] = [];
  globalThis.fetch = async (input) => {
    requests.push(String(input));
    return Response.json({ error: "daily_budget" }, { status: 429 });
  };
  await assert.rejects(
    entryPoint("budget-regression", null, "citations", 0, 20),
    /daily allowance/,
  );
  assert.equal(requests.length, 1);
  assert.ok(!requests[0].includes("/data/"));
});

test("concurrent consumers do not skip upstream pages and can retry failed pagination", async () => {
  const requests: number[] = [];
  let fail = true;
  globalThis.fetch = async (input) => {
    const page = Number(new URL(String(input)).searchParams.get("page"));
    requests.push(page);
    if (page === 2 && fail) return new Response("unavailable", { status: 503 });
    await new Promise((resolve) => setTimeout(resolve, 5));
    return Response.json({
      meta: { count: 50 },
      results: Array.from({ length: 25 }, (_, i) => ({
        id: `W${page * 100 + i}`,
        doi: `https://doi.org/10.48550/arxiv.2609.${String((page - 1) * 25 + i).padStart(5, "0")}`,
        display_name: `Page ${page} paper ${i}`,
      })),
    });
  };
  const [a, b] = await Promise.all([
    searchPapers("concurrency-regression", null, "recent", 0, 20),
    searchPapers("concurrency-regression", null, "recent", 0, 20),
  ]);
  assert.deepEqual(a, b);
  assert.deepEqual(requests, [1]);
  await assert.rejects(
    searchPapers("concurrency-regression", null, "recent", 20, 20),
  );
  fail = false;
  const next = await searchPapers(
    "concurrency-regression",
    null,
    "recent",
    20,
    20,
  );
  assert.equal(next.papers.length, 20);
  assert.equal(
    new Set([...a.papers, ...next.papers].map((p) => p.id)).size,
    40,
  );
  assert.deepEqual(requests, [1, 2, 2]);
  assert.equal(next.hasMore, true);
  const last = await searchPapers(
    "concurrency-regression",
    null,
    "recent",
    40,
    20,
  );
  assert.equal(last.papers.length, 10);
  assert.equal(last.hasMore, false);
});

test("author names are matched within one byline and punctuation cannot inject filters", async () => {
  let filter = "";
  globalThis.fetch = async (input) => {
    filter = new URL(String(input)).searchParams.get("filter")!;
    return Response.json({ meta: { count: 0 }, results: [] });
  };
  await searchPapers(
    "John Smith, Jr",
    null,
    "citations",
    0,
    20,
    undefined,
    true,
  );
  assert.equal(
    filter,
    'locations.source.id:S4306400194,raw_author_name.search:"John Smith Jr"',
  );
});

test("canonical arXiv metadata corrects merged index identities without changing citation rank", async () => {
  globalThis.fetch = async () =>
    Response.json({
      meta: { count: 1 },
      results: [
        {
          id: "https://openalex.org/W999",
          doi: "https://doi.org/10.48550/arxiv.1810.04805",
          display_name: "Wrong title",
          cited_by_count: 46030,
          publication_date: "2018-10-11",
          arxiv_metadata: {
            id: "1810.04805",
            versionedId: "1810.04805v2",
            title: "BERT",
            authors: ["Jacob Devlin"],
            abstract: "Original",
            categories: ["cs.CL"],
            primaryCategory: "cs.CL",
            doi: null,
            journalRef: null,
            comment: null,
          },
        },
      ],
    });
  const result = await searchPapers(
    "canonical-regression",
    null,
    "citations",
    0,
    20,
  );
  assert.equal(result.papers[0].title, "BERT");
  assert.deepEqual(result.papers[0].authors, ["Jacob Devlin"]);
  assert.equal(result.papers[0].metrics!.citations, 46030);
  assert.equal(result.papers[0].metrics!.workId, "W999");
});

test("shared paper URLs retain the search work and reject unrelated work identifiers", async () => {
  const { paperHref } = await import("../paper-link.ts");
  assert.equal(
    paperHref("hep-th/9901001", "W123"),
    "/paper?id=hep-th%2F9901001&work=W123",
  );
  assert.equal(
    paperHref("1810.04805", "invalid&other=1"),
    "/paper?id=1810.04805",
  );
});

test("BibTeX export distinguishes similar titles from the same author and year",async()=>{
 const {toBibtex}=await import('../citations.ts');
 const a=makePaper('2609.00001',{title:'A new embedding method',authors:['John Smith']});
 const b=makePaper('2609.00002',{title:'A new embedding model',authors:['John Smith']});
 assert.notEqual(toBibtex(a).split('\n')[0],toBibtex(b).split('\n')[0]);
});
