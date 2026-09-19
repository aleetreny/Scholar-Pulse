import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { matchesSnapshot, sortSnapshotMatches } from "./search-options.ts";
import { makePaper } from "../test-fixtures.ts";
import { getFeed, searchSnapshots } from "./feed.ts";
import { searchPapers } from "./openalex.ts";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test("a focused discipline retains cross-listed work and its discipline-specific score", async () => {
  const cross = makePaper("2609.12345", { primaryCategory: "cs.AI", categories: ["cs.AI", "cs.LG"] });
  globalThis.fetch = async (url) => {
    const category = String(url).includes("cs.LG") ? "cs.LG" : "cs.AI";
    const pulse = { score: category === "cs.LG" ? 90 : 10, tier: "notable", lanes: [], reasons: [], newcomer: false, cohort: category };
    return new Response(JSON.stringify({ category, fetchedAt: "2026-09-19", papers: [{ ...cross, pulse }] }));
  };
  const feed = await getFeed(["cs.AI", "cs.LG"], 0, 20, "cs.LG", "pulse");
  assert.equal(feed.papers.length, 1);
  assert.equal(feed.papers[0].id, cross.id);
  assert.equal(feed.papers[0].pulse?.cohort, "cs.LG");
  assert.equal(feed.papers[0].pulse?.score, 90);
});

test("the combined feed prefers a followed primary discipline's score", async () => {
  const cross = makePaper("2609.23456", { primaryCategory: "cs.RO", categories: ["cs.CV", "cs.RO"] });
  globalThis.fetch = async (url) => {
    const category = String(url).includes("cs.RO") ? "cs.RO" : "cs.CV";
    const pulse = { score: category === "cs.RO" ? 90 : 10, tier: "notable", lanes: [], reasons: [], newcomer: false, cohort: category };
    return new Response(JSON.stringify({ category, fetchedAt: "2026-09-19", papers: [{ ...cross, pulse }] }));
  };
  const feed = await getFeed(["cs.CV", "cs.RO"], 0, 20);
  assert.equal(feed.papers.length, 1);
  assert.equal(feed.papers[0].pulse?.cohort, "cs.RO");
  assert.equal(feed.papers[0].pulse?.score, 90);
  assert.deepEqual(await getFeed(["cs.RO", "cs.CV"], 0, 20), feed);
});

test("fallback finds cross-listings retained only in another discipline's snapshot", async () => {
  const cross = makePaper("2609.34567", { title: "Symbolic logic", primaryCategory: "math.LO", categories: ["math.LO", "cs.PL"] });
  globalThis.fetch = async (url) => new Response(JSON.stringify(String(url).endsWith("manifest.json")
    ? { generatedAt: "2026-09-19", categories: ["math.LO", "cs.PL"] }
    : { category: String(url).includes("math.LO") ? "math.LO" : "cs.PL", fetchedAt: "2026-09-19", papers: String(url).includes("math.LO") ? [cross] : [] }));
  const result = await searchSnapshots("logic", [], 0, 20, { fieldId: 17, sort: "citations" });
  assert.equal(result.papers.length, 1);
  assert.equal(result.papers[0].id, cross.id);
});

test("fallback respects discipline and author filters", () => {
  const paper = makePaper("test", { title: "Ada computes", authors: ["Grace Hopper"] });
  assert.ok(matchesSnapshot(paper, "Grace", 17, true));
  assert.ok(!matchesSnapshot(paper, "Ada", 17, true));
  assert.ok(!matchesSnapshot(paper, "", 31, false));
  assert.ok(matchesSnapshot(paper, "", 17, false));
});

test("most-cited fallback keeps unknown citations distinct from zero", () => {
  const metrics = (citations: number) => ({ citations, references: null, asOf: "2026-09-19" });
  const rows = [makePaper("unknown"), makePaper("zero", { metrics: metrics(0) }), makePaper("known", { metrics: metrics(50) })];
  assert.deepEqual(sortSnapshotMatches(rows, "citations").map((paper) => paper.id), ["known", "zero", "unknown"]);
});

test("query-free field exploration sends an explicit most-cited request", async () => {
  let requested = "";
  globalThis.fetch = async (url) => { requested = String(url); return new Response(JSON.stringify({ meta: { count: 0 }, results: [] })); };
  const result = await searchPapers("", 31, "citations", 0, 20);
  const url = new URL(requested);
  assert.equal(url.searchParams.get("sort"), "cited_by_count:desc");
  assert.equal(url.searchParams.get("search"), null);
  assert.ok(url.searchParams.get("filter")!.includes("primary_topic.field.id:31"));
  assert.equal(result.source, "openalex");
});
