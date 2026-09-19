import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { matchesSnapshot, sortSnapshotMatches } from "./search-options.ts";
import { makePaper } from "../test-fixtures.ts";
import { getFeed } from "./feed.ts";
import { searchPapers } from "./openalex.ts";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test("a focused discipline retains cross-listed work and its discipline-specific score", async () => {
  const cross = makePaper("2609.12345", { primaryCategory: "stat.ML", categories: ["stat.ML", "cs.LG"] });
  globalThis.fetch = async () => new Response(JSON.stringify({ category: "cs.LG", fetchedAt: "2026-09-19", papers: [cross] }));
  const feed = await getFeed(["cs.LG"], 0, 20, "cs.LG", "pulse");
  assert.equal(feed.papers.length, 1);
  assert.equal(feed.papers[0].id, cross.id);
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
