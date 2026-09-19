import assert from "node:assert/strict";
import { test, afterEach } from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadState, validPredictions } from "./state.mjs";
import { recordPredictions } from "./predictions.mjs";
import { auditBuild, weightedAuc, ndcgAt } from "./evaluation.mjs";
import { EMPTY_MEMORY, monthIndex } from "../src/lib/ranking/signals.ts";
import { scoreCohort } from "../src/lib/ranking/score.ts";
import { makePaper } from "../src/lib/test-fixtures.ts";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test("remote outage cannot replace production history with an empty log", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pulse-state-"));
  try {
    globalThis.fetch = async () => { throw new Error("network failure"); };
    await assert.rejects(loadState(path.join(dir, "missing.json"), "https://example.test/history", validPredictions), /Refusing to reset history/);
    await writeFile(path.join(dir, "corrupt.json"), "{");
    await assert.rejects(loadState(path.join(dir, "corrupt.json"), "https://example.test/history", validPredictions), SyntaxError);
    globalThis.fetch = async () => new Response("", { status: 404 });
    await assert.rejects(loadState(path.join(dir, "missing.json"), "https://example.test/history", validPredictions), /Refusing/);
  } finally { await rm(dir, { recursive: true }); }
});

test("new logs preserve every old claim and freeze the first claim per version/day", () => {
  const old = { version: 1, builds: [{ rankedAt: "2026-08-23T15:06:47.298Z", restSampledOneIn: 16, cohorts: { "cs.LG": [["old", 99, 0, 0]] } }] };
  const papers = Array.from({ length: 30 }, (_, i) => makePaper(`2609.${String(i).padStart(5, "0")}`));
  const pulses = scoreCohort(papers, EMPTY_MEMORY, monthIndex("2026-09-19"));
  const snapshots = [{ category: "cs.LG", fetchedAt: "2026-09-19", papers: papers.map((paper, i) => ({ ...paper, pulse: pulses[i] })) }];
  const next = recordPredictions(old, snapshots, EMPTY_MEMORY, new Map(), monthIndex("2026-09-19"), "2026-09-19T12:00:00Z");
  assert.deepEqual(next.builds[0], old.builds[0]);
  assert.equal(next.builds[1].cohorts["cs.LG"].length, 30);
  assert.equal(next.builds[1].restSampledOneIn, 1);
  assert.deepEqual(recordPredictions(next, [], EMPTY_MEMORY, new Map(), 0, "2026-09-19T23:00:00Z"), next);
});

test("weighted AUC gives ties half credit and sampling weights do not invent positives", () => {
  assert.equal(weightedAuc([{ score: 50, hit: true, weight: 16 }, { score: 50, hit: false, weight: 1 }]), 0.5);
  const build = { rankedAt: "2026-01-01", restSampledOneIn: 16, cohorts: { physics: [["a", 90, 2, 0], ["b", 80, 2, 0], ["c", 50, 2, 0]] } };
  const result = auditBuild(build, new Map([["a", 2], ["b", 3], ["c", 0]]), { now: Date.parse("2026-09-19") });
  assert.equal(result.cohorts[0].positives, 2);
  assert.equal(result.cohorts[0].verdict, "insufficient-observed-positives");
  assert.equal(result.cohorts[0].auc, null);
});

test("prospective audit uses citation gains and requires matched heads in every baseline", () => {
  const rows = Array.from({ length: 20 }, (_, i) => [`p${i}`, 100 - i, i < 2 ? 0 : 2, 0, i + 1, 20 - i, 20 - i, i + 1, 100, "2025-12-01"]);
  const build = { rankedAt: "2026-01-01", modelVersion: "pulse-v2", restSampledOneIn: 1, rowSchema: ["full"], cohorts: { physics: rows } };
  const counts = new Map(rows.map(([id], i) => [id, 120 - i]));
  const options = { now: Date.parse("2026-09-19") };
  const measured = auditBuild(build, counts, options).cohorts[0];
  assert.equal(measured.verdict, null);
  assert.equal(measured.ndcg10.pulse, 1);
  assert.ok(measured.deltaVsLegacy > 0);
  counts.delete("p0");
  assert.equal(auditBuild(build, counts, options).cohorts[0].verdict, "incomplete-paired-outcomes");
  assert.equal(auditBuild(build, counts, { now: Date.parse("2026-01-15") }).cohorts[0].verdict, "immature");
  assert.equal(ndcgAt([0, 1], [0, 0]), null);
});

test("cross-field citation rates cannot manufacture a global AUC", () => {
  const build = { rankedAt: "2026-01-01", restSampledOneIn: 1, cohorts: {
    popular: Array.from({ length: 10 }, (_, i) => [`high${i}`, 90, 0, 0]),
    quiet: Array.from({ length: 10 }, (_, i) => [`low${i}`, 10, 2, 0]),
  } };
  const counts = new Map([...build.cohorts.popular.map(([id]) => [id, 100]), ...build.cohorts.quiet.map(([id]) => [id, 0])]);
  const result = auditBuild(build, counts, { now: Date.parse("2026-09-19") });
  assert.equal(result.cohorts[0].auc, null);
  assert.equal(result.cohorts[1].auc, null);
});

test("the complete build scripts preserve histories, fallback dates, cached counts and field scores", async () => {
  const { mkdir, readFile } = await import("node:fs/promises");
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);
  const dir = await mkdtemp(path.join(os.tmpdir(), "pulse-pipeline-"));
  try {
    await mkdir(path.join(dir, "feed"));
    const original = { version: 1, builds: [{ rankedAt: "2026-08-23T15:06:47.298Z", restSampledOneIn: 16, cohorts: { "cs.LG": [["old", 99, 0, 0]] } }] };
    const papers = Array.from({ length: 20 }, (_, i) => makePaper(`2609.${String(i).padStart(5, "0")}`, {
      categories: ["cs.LG", "stat.ML"], metrics: { citations: i, references: i + 10, asOf: "2026-09-01T00:00:00Z" },
    }));
    for (const category of ["cs.LG", "stat.ML"]) await writeFile(path.join(dir, "feed", `${category}.json`), JSON.stringify({ category, fetchedAt: "2026-09-01T00:00:00Z", papers }));
    await writeFile(path.join(dir, "memory.json"), JSON.stringify(EMPTY_MEMORY));
    await writeFile(path.join(dir, "predictions.json"), JSON.stringify(original));
    await writeFile(path.join(dir, "manifest.json"), JSON.stringify({ generatedAt: "2026-09-01T00:00:00Z", categories: ["cs.LG", "stat.ML"] }));
    const env = { ...process.env, SCHOLARPULSE_DATA_DIR: dir, SCHOLARPULSE_CORPUS_DIR: path.join(dir, "corpus"), HARVEST_BUDGET_MS: "0" };
    const buildScript = new URL("./build-feed-snapshots.mjs", import.meta.url).pathname;
    const rankScript = new URL("./rank-snapshots.mjs", import.meta.url).pathname;
    await run(process.execPath, [buildScript, "--cats", "cs.LG,stat.ML"], { env });
    const manifest = JSON.parse(await readFile(path.join(dir, "manifest.json"), "utf8"));
    assert.equal(manifest.generatedAt, "2026-09-01T00:00:00Z");
    assert.equal(manifest.refresh.carried.length, 2);
    await run(process.execPath, [rankScript, "--no-enrich"], { env });
    const next = JSON.parse(await readFile(path.join(dir, "predictions.json"), "utf8"));
    assert.deepEqual(next.builds[0], original.builds[0]);
    assert.equal(next.builds.at(-1).cohorts["stat.ML"].length, 20);
    const ranked = JSON.parse(await readFile(path.join(dir, "feed/stat.ML.json"), "utf8"));
    assert.ok(ranked.papers.every((paper) => paper.pulse.cohort === "stat.ML"));
    assert.equal(ranked.papers[0].metrics.asOf, "2026-09-01T00:00:00Z");
    const memory = JSON.parse(await readFile(path.join(dir, "memory.json"), "utf8"));
    assert.equal(memory.authors["Unknown author"].n, 20);
    await run(process.execPath, [rankScript, "--no-enrich"], { env });
    assert.deepEqual(JSON.parse(await readFile(path.join(dir, "predictions.json"), "utf8")), next);
  } finally { await rm(dir, { recursive: true }); }
});
