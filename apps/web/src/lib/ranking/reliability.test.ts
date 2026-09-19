import assert from "node:assert/strict";
import { test } from "node:test";
import { rankEvidence } from "./fusion.ts";
import { scoreCohort, orderByPulse } from "./score.ts";
import { EMPTY_MEMORY, foldIntoMemory, monthIndex } from "./signals.ts";
import { makePaper } from "../test-fixtures.ts";

const now = monthIndex("2026-09-19");
const papers = Array.from({ length: 40 }, (_, i) => makePaper(`2609.${String(i).padStart(5, "0")}`));

test("missing evidence is exactly neutral and sparse evidence has bounded influence", () => {
  const small = rankEvidence([1, 2, 3, 4, 5, 6, 7, 8])!;
  const large = rankEvidence([1, 2, 3, 4, 5, 6, 7, 8, ...Array(72).fill(undefined)])!;
  assert.equal(large.coverage, 0.1);
  for (let i = 0; i < 8; i++) assert.ok(Math.abs(large.contributions[i] - small.contributions[i] * 0.1) < 1e-12);
  assert.ok(large.contributions.slice(8).every((value) => value === 0));
});

test("non-finite, negative and missing values cannot masquerade as counts", () => {
  assert.equal(rankEvidence([1, 2, 3, 4, 5, 6, 7, NaN, Infinity, -1, undefined]), null);
  assert.equal(rankEvidence(Array(40).fill(0)), null);
  const enriched = new Map(papers.map((paper) => [paper.id, { references: NaN, citations: Infinity }]));
  assert.deepEqual(scoreCohort(papers, EMPTY_MEMORY, now, enriched), scoreCohort(papers, EMPTY_MEMORY, now));
});

test("a hundred citations on old papers cannot overwhelm tied young peers solely through age", () => {
  const cohort = papers.map((paper, i) => ({ ...paper, published: i < 20 ? "2025-01-01" : "2026-09-01" }));
  const enriched = new Map(cohort.map((paper, i) => [paper.id, { citations: i < 20 ? 100 : 0 }]));
  const pulses = scoreCohort(cohort, EMPTY_MEMORY, now, enriched, { asOf: "2026-09-19", category: "cs.LG" });
  assert.equal(new Set(pulses.map((pulse) => pulse.score)).size, 1);
  assert.ok(pulses.every((pulse) => !pulse.lanes.includes("reception")));
});

test("external evidence appears in the explanation only for observed papers", () => {
  const enriched = new Map(papers.slice(0, 20).map((paper, i) => [paper.id, { references: i + 1 }]));
  const pulses = scoreCohort(papers, EMPTY_MEMORY, now, enriched);
  assert.ok(pulses[19].reasons.some((reason) => reason.signal === "references"));
  assert.ok(!pulses[30].lanes.includes("references"));
  assert.ok(pulses.every((pulse) => pulse.probability === undefined));
});

test("rounding and input permutation cannot silently change the reading order", () => {
  const input = Array.from({ length: 500 }, (_, i) => makePaper(`2609.${String(i).padStart(5, "0")}`));
  const enriched = new Map(input.map((paper, i) => [paper.id, { references: i + 1 }]));
  const board = (items: typeof input) => {
    const pulses = scoreCohort(items, EMPTY_MEMORY, now, enriched);
    return orderByPulse(items.map((paper, i) => ({ ...paper, pulse: pulses[i] })), (paper) => paper.pulse).map((paper) => paper.id);
  };
  assert.deepEqual(board(input), board([...input].reverse()));
  assert.equal(board(input)[0], input.at(-1)!.id);
});

test("the same paper appearing twice in a harvest is folded once", () => {
  const memory = foldIntoMemory(EMPTY_MEMORY, [papers[0], papers[0]]);
  assert.equal(memory.authors["Unknown author"].n, 1);
  assert.equal(Object.values(memory.volume)[0], 1);
});

test("complete backfill months are not counted again by a weekly harvest", () => {
  const first = foldIntoMemory(EMPTY_MEMORY, [papers[0]]);
  const memory = { ...first, folded: [], backfilled: ["oai/2026-09"] };
  assert.deepEqual(foldIntoMemory(memory, [papers[0]]), memory);
});

test("quiet-field papers do not fall out of the duplicate ledger after 20k IDs", () => {
  const first = foldIntoMemory(EMPTY_MEMORY, [papers[0]]);
  const memory = { ...first, folded: [...Array.from({ length: 20_001 }, (_, i) => `2608.${i}`), papers[0].id] };
  const folded = foldIntoMemory(memory, [papers[1]]);
  assert.ok(folded.folded!.includes(papers[0].id));
  assert.equal(foldIntoMemory(folded, [papers[0]]).authors["Unknown author"].n, 2);
});

test("candidates older than the memory horizon cannot repeatedly inflate active authors", () => {
  const current = foldIntoMemory(EMPTY_MEMORY, [papers[0]]);
  const old = { ...papers[0], id: "1901.12345", published: "2019-01-01" };
  assert.deepEqual(foldIntoMemory(current, [old]), current);
});
