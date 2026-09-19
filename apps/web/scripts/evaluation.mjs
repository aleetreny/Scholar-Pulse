export const DAY = 864e5;

export function weightedAuc(rows) {
  const sorted = [...rows].sort((a, b) => a.score - b.score);
  let below = 0, area = 0, positives = 0, negatives = 0;
  for (let i = 0; i < sorted.length;) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1].score === sorted[i].score) j += 1;
    let pos = 0, neg = 0;
    for (let k = i; k <= j; k += 1) {
      if (sorted[k].hit) pos += sorted[k].weight;
      else neg += sorted[k].weight;
    }
    area += pos * (below + neg / 2);
    below += neg;
    positives += pos;
    negatives += neg;
    i = j + 1;
  }
  return positives && negatives ? area / (positives * negatives) : null;
}

export function ndcgAt(order, gains, k = 10) {
  const dcg = (values) => values.slice(0, k).reduce((sum, gain, i) => sum + Math.log1p(gain) / Math.log2(i + 2), 0);
  const ideal = dcg([...gains].sort((a, b) => b - a));
  return ideal > 0 ? dcg(order.map((i) => gains[i])) / ideal : null;
}

const mean = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

/** Evaluate each field separately. Unknown outcomes are never zero citations.
 * v2 labels are citations gained after ranking, so existing citations cannot
 * act as both a predictor and the outcome they purport to predict.
 */
export function auditBuild(build, citations, { now = Date.now(), minAge = 90, minCoverage = 0.8 } = {}) {
  const ageDays = (now - Date.parse(build.rankedAt)) / DAY;
  const full = build.restSampledOneIn === 1 && Boolean(build.rowSchema);
  const cohorts = [];
  for (const [category, entries] of Object.entries(build.cohorts)) {
    const known = entries.filter(([id]) => Number.isFinite(citations.get(id)) && citations.get(id) >= 0);
    const coverage = known.length / entries.length;
    const rows = known.map(([id, score, tier, newcomer, rank, legacyRank, newestRank, referencesRank, initial]) => {
      const count = citations.get(id);
      return { id, score, tier, newcomer, rank, legacyRank, newestRank, referencesRank,
        citations: count, gain: full && Number.isFinite(initial) ? count - initial : null,
        hit: count > 0, weight: tier === 2 ? build.restSampledOneIn : 1 };
    });
    // Two cited controls weighted 16x are still two observations, not 32.
    const positives = rows.filter((row) => full ? row.gain > 0 : row.hit).length;
    let verdict = ageDays < minAge ? "immature" : coverage < minCoverage ? "insufficient-coverage" : null;
    if (!verdict && positives < 5) verdict = "insufficient-observed-positives";
    const result = { category, papers: entries.length, matched: known.length, coverage, positives, verdict };
    if (full) {
      const arms = { pulse: "rank", legacy: "legacyRank", newest: "newestRank", references: "referencesRank" };
      // Same evaluable papers in every arm. Missing original top-ten outcomes
      // suppress the verdict instead of silently promoting paper #11.
      const valid = rows.filter((row) => row.gain !== null && row.gain >= 0);
      result.baselineCoverage = valid.length / entries.length;
      const usable = new Set(valid.map((row) => row.id));
      const completeHeads = Object.values(arms).every((key) => {
        const column = { rank: 4, legacyRank: 5, newestRank: 6, referencesRank: 7 }[key];
        return entries.filter((row) => row[column] <= 10).every(([id]) => usable.has(id));
      });
      if (!result.verdict && (result.baselineCoverage < minCoverage || !completeHeads)) result.verdict = "incomplete-paired-outcomes";
      result.ndcg10 = null;
      result.deltaVsLegacy = null;
      result.deltaVsNewest = null;
      if (!result.verdict) {
        result.ndcg10 = Object.fromEntries(Object.entries(arms).map(([name, key]) => [name, ndcgAt(
          valid.map((_, i) => i).sort((a, b) => valid[a][key] - valid[b][key]), valid.map((row) => row.gain),
        )]));
        result.deltaVsLegacy = result.ndcg10.pulse - result.ndcg10.legacy;
        result.deltaVsNewest = result.ndcg10.pulse - result.ndcg10.newest;
      }
    } else {
      result.auc = result.verdict ? null : weightedAuc(rows);
      const totalWeight = rows.reduce((sum, row) => sum + row.weight, 0);
      const average = totalWeight ? rows.reduce((sum, row) => sum + row.weight * row.citations, 0) / totalWeight : 0;
      result.bands = Object.fromEntries([0, 1, 2].map((tier) => {
        const subset = rows.filter((row) => row.tier === tier);
        return [["headline", "notable", "rest"][tier], {
          observed: subset.length,
          lift: result.verdict || !subset.length || !average ? null : mean(subset.map((row) => row.citations)) / average,
        }];
      }));
    }
    cohorts.push(result);
  }
  return { rankedAt: build.rankedAt, modelVersion: build.modelVersion ?? "pulse-v1", ageDays,
    outcome: full ? "citation-gain-since-ranking" : "cumulative-citations-legacy-sampled", cohorts };
}

export function summariseAudits(audits) {
  return [...new Set(audits.map((audit) => audit.modelVersion))].map((modelVersion) => {
    const cohorts = audits.filter((audit) => audit.modelVersion === modelVersion).flatMap((audit) => audit.cohorts);
    const eligible = cohorts.filter((cohort) => !cohort.verdict);
    const pick = (key) => mean(eligible.map((cohort) => cohort[key]).filter((value) => value !== null && value !== undefined));
    return { modelVersion, cohorts: cohorts.length, measurable: eligible.length,
      meanWithinFieldAuc: pick("auc"), meanDeltaVsLegacy: pick("deltaVsLegacy"), meanDeltaVsNewest: pick("deltaVsNewest") };
  });
}
