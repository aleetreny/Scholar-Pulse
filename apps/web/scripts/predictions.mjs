import { orderByPulse, RANKING_VERSION } from "../src/lib/ranking/score.ts";
import { scoreCohort as legacyScore, orderByPulse as legacyOrder } from "../src/lib/ranking/legacy-score.ts";

const TIERS = { headline: 0, notable: 1, rest: 2 };
const positions = (papers) => new Map(papers.map((paper, i) => [paper.id, i + 1]));

/** Immutable, versioned daily observations, with paired baselines on the same candidates.
 * Legacy sampled entries are carried byte-for-byte at the object level. New
 * entries keep every candidate so NDCG@10 can be evaluated without sampling bias.
 */
export function recordPredictions(previous, snapshots, memory, enrichment, now, rankedAt) {
  const day = rankedAt.slice(0, 10);
  if (previous.builds.some((build) => build.modelVersion === RANKING_VERSION && build.rankedAt.slice(0, 10) === day)) return previous;
  const cohorts = {};
  const dataAsOf = {};
  for (const snapshot of snapshots) {
    const papers = snapshot.papers;
    const legacy = legacyScore(papers, memory, now, enrichment);
    const currentOrder = positions(orderByPulse(papers, (paper) => paper.pulse));
    const oldOrder = positions(legacyOrder(papers.map((paper, i) => ({ ...paper, pulse: legacy[i] })), (paper) => paper.pulse));
    const newest = positions([...papers].sort((a, b) => b.published.localeCompare(a.published) || a.id.localeCompare(b.id)));
    const references = positions([...papers].sort((a, b) =>
      (enrichment.get(b.id)?.references ?? -1) - (enrichment.get(a.id)?.references ?? -1) || a.id.localeCompare(b.id)));
    cohorts[snapshot.category] = papers.map((paper) => [
      paper.id, paper.pulse.score, TIERS[paper.pulse.tier], paper.pulse.newcomer ? 1 : 0,
      currentOrder.get(paper.id), oldOrder.get(paper.id), newest.get(paper.id), references.get(paper.id),
      // Cached counts predate this prediction and cannot be a clean gain baseline.
      enrichment.get(paper.id)?.asOf ? null : enrichment.get(paper.id)?.citations ?? null, paper.published,
    ]);
    dataAsOf[snapshot.category] = snapshot.fetchedAt;
  }
  return { version: 2, builds: [...previous.builds, {
    rankedAt, modelVersion: RANKING_VERSION, restSampledOneIn: 1,
    rowSchema: ["id", "score", "tier", "newcomer", "rank", "legacyRank", "newestRank", "referencesRank", "citationsAtRank", "published"],
    cohorts, dataAsOf,
  }] };
}
