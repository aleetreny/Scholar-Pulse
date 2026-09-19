// Bounded reproducible stress test on the public SNAP hep-th citation graph.
// RESEARCH_DATA=data/review-corpora node research/ranking/check_fusion.mjs
// This evaluates fusion under controlled missingness, not today's entire model.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { rankEvidence, percentileRank } from '../../apps/web/src/lib/ranking/fusion.ts';
import { ndcgAt } from '../../apps/web/scripts/evaluation.mjs';

const dir = process.env.RESEARCH_DATA ?? 'data/review-corpora';
const bytes = await readFile(path.join(dir, 'cit-HepTh.txt.gz'));
const month = (id) => {
  const code = String(id).padStart(7, '0'), yy = Number(code.slice(0, 2)), mm = Number(code.slice(2, 4));
  const year = yy >= 90 ? 1900 + yy : 2000 + yy;
  return mm >= 1 && mm <= 12 && year >= 1992 && year <= 2003 ? (year - 1992) * 12 + mm - 1 : null;
};
const nodes = new Map(), incoming = new Map(), references = new Map();
let edges = 0, invalid = 0;
for (const line of gunzipSync(bytes).toString().split('\n')) {
  if (!line || line.startsWith('#')) continue;
  const [source, target] = line.trim().split(/\s+/).map(Number);
  const from = month(source), to = month(target);
  if (from === null || to === null || from < to) { invalid++; continue; }
  nodes.set(source, from); nodes.set(target, to); edges++;
  if (!incoming.has(target)) incoming.set(target, []);
  incoming.get(target).push(from);
  references.set(source, (references.get(source) ?? 0) + 1);
}
const hash = (id, seed) => parseInt(createHash('sha256').update(`${id}/${seed}`).digest('hex').slice(0, 8), 16) / 2 ** 32;
const oldLane = (values) => {
  const positions = values.flatMap((value, i) => value === undefined ? [] : [i]);
  if (positions.length < 8) return values.map(() => 0);
  const known = positions.map((i) => values[i]);
  if (known.every((value) => value === known[0])) return values.map(() => 0);
  const ranks = percentileRank(known.map((value) => -value)).map((p) => p * (known.length + 1));
  const neutral = 1 / (20 + (known.length + 1) / 2);
  const out = values.map(() => 0);
  positions.forEach((pos, i) => { out[pos] = 1 / (20 + ranks[i]) - neutral; });
  return out;
};
function evaluate(fromMonth, toMonth, receptionWeight) {
const arms = [];
// Protocol fixed before reading outcomes: metadata omitted because this graph
// contains no titles or authors; one month observation, next 23 months target.
for (const [refCoverage, citationCoverage] of [[1, 1], [0.75, 0.75], [1, 0.25], [0.25, 1], [0.25, 0.25]]) {
  const cohorts = [];
  for (let t = fromMonth; t <= toMonth; t++) { // Jan 1998 through Apr 2001; complete 24-month horizon.
    const ids = [...nodes].filter(([, at]) => at === t).map(([id]) => id).sort((a, b) => a - b);
    if (ids.length < 30) continue;
    const gains = ids.map((id) => (incoming.get(id) ?? []).filter((at) => at > t + 1 && at <= t + 24).length);
    const refs = ids.map((id) => hash(id, 'refs') < refCoverage ? references.get(id) ?? 0 : undefined);
    const cites = ids.map((id) => hash(id, 'cites') < citationCoverage ? (incoming.get(id) ?? []).filter((at) => at <= t + 1).length : undefined);
    const current = [refs, cites].map((v, lane) => {
      const evidence = rankEvidence(v);
      return evidence ? evidence.contributions.map((c) => c * (lane === 1 ? receptionWeight : 1)) : v.map(() => 0);
    });
    const legacy = [refs, cites].map(oldLane);
    const score = (lanes) => {
      const scores = ids.map((_, i) => lanes.reduce((sum, lane) => sum + lane[i], 0));
      return ndcgAt(ids.map((_, i) => i).sort((a, b) => scores[b] - scores[a] || ids[a] - ids[b]), gains);
    };
    cohorts.push({ month: t, papers: ids.length, legacy: score(legacy), current: score(current) });
  }
  const avg = (key) => cohorts.reduce((sum, c) => sum + c[key], 0) / cohorts.length;
  const deltas = cohorts.map((c) => c.current - c.legacy);
  let state = 17;
  const rand = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 2 ** 32; };
  const draws = Array.from({ length: 4000 }, () => deltas.reduce((sum) => sum + deltas[Math.floor(rand() * deltas.length)], 0) / deltas.length).sort((a, b) => a - b);
  arms.push({ refCoverage, citationCoverage, cohorts: cohorts.length, papers: cohorts.reduce((sum, c) => sum + c.papers, 0), legacyNdcg10: avg('legacy'), currentNdcg10: avg('current'), delta: avg('current') - avg('legacy'), delta95: [draws[100], draws[3899]], details: cohorts });
}
return arms;
}

const grid = [1, 2, 4].map((weight) => {
  const arms = evaluate(12, 47, weight);
  return { weight, meanNdcg10: arms.reduce((sum, arm) => sum + arm.currentNdcg10, 0) / arms.length };
});
const selected = [...grid].sort((a, b) => b.meanNdcg10 - a.meanNdcg10)[0].weight;
const arms = evaluate(72, 111, selected);
const report = { selectedReceptionWeight: selected, training: { from: "1993-01", to: "1995-12", labelsCompleteBy: "1997-12", grid }, rejectedEqualWeight: evaluate(72, 111, 1).map(({ details, ...arm }) => arm), protocol: 'Reception weight chosen from [1,2,4] on 1993-1995 cohorts; labels complete by end 1997. Evaluation 1998-2001 hep-th, observation through month+1, gains months+2..+24. Missingness simulates indexing loss. Static references may include revisions. Evaluation outcomes were examined for the rejected equal-weight candidate before this grid was run; retrospective evidence, not a blinded holdout. Not a validation of the complete production ranker.', source: 'https://snap.stanford.edu/data/cit-HepTh.html', sha256: createHash('sha256').update(bytes).digest('hex'), nodes: nodes.size, edges, invalid, arms };
await mkdir(path.join(dir, 'results'), { recursive: true });
await writeFile(path.join(dir, 'results/fusion.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, arms: arms.map(({ details, ...arm }) => arm) }, null, 2));

if (process.argv.includes('--export')) {
  const model = { version: 1, receptionWeight: selected, minimumAgeDays: 28, sourceSha256: report.sha256, training: report.training };
  await writeFile(new URL('../../apps/web/src/lib/ranking/fusion-model.generated.ts', import.meta.url), '// Generated by research/ranking/check_fusion.mjs --export. Do not edit by hand.\n// Physics-only retrospective calibration; prospective cross-field validation is pending.\nexport const FUSION_MODEL = ' + JSON.stringify(model, null, 2) + ' as const;\n');
}
