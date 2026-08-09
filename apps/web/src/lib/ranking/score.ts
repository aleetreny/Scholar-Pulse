import { RANKING_MODEL } from "./model.generated.ts";
import {
  type CorpusMemory,
  type Signals,
  SIGNAL_NAMES,
  burstScores,
  extractSignals,
} from "./signals.ts";
import type { Paper, Pulse, PulseLane, PulseReason, PulseTier } from "@/lib/types";

/**
 * Turning signals into the number the reader sees.
 *
 * The shape of this file follows what the study found, in order:
 *
 *  1. Compare inside a cohort, never across one. A paper's percentile among the
 *     papers filed beside it is meaningful; its raw score is not.
 *  2. Weigh the signals with coefficients that cannot cancel each other, so the
 *     score decomposes into contributions a person can read.
 *  3. Fuse the independent lanes by rank, not by score, so a missing lane
 *     degrades the ranking instead of breaking it.
 *  4. Rank papers with no author history separately and reserve room for them,
 *     because otherwise the board becomes a list of famous laboratories.
 *  5. Publish bands, not positions — the order inside the head of the list is
 *     not stable enough to assert.
 */

/** What an external index adds once it has caught up with the preprint. */
export type Enrichment = {
  /** Citations already recorded. Zero and "not indexed yet" are different. */
  citations?: number;
  /** Length of the reference list. */
  references?: number;
};

export type { Pulse, PulseLane, PulseReason, PulseTier };

const WEIGHTS: Partial<Record<keyof Signals, number>> = RANKING_MODEL.weights;
const CALIBRATION = RANKING_MODEL.calibration;

/** Reciprocal-rank-fusion constant. Small k sharpens the head of the list. */
const RRF_K = 20;
/** Share of board positions reserved for papers with no author history. */
export const NEWCOMER_QUOTA = 0.3;
const TIER_HEADLINE = 0.95;
const TIER_NOTABLE = 0.8;
/** Below this many papers, percentiles are too coarse to mean anything. */
const MIN_COHORT = 12;

/**
 * Percentile of each value within the array, ties averaged, mapped to (0, 1).
 *
 * Ties matter more than they look: in a fresh snapshot almost every paper has
 * zero citations, so the reception lane is nearly all ties. Averaging them
 * makes that lane a near-constant, which is exactly right — it then carries no
 * opinion instead of imposing an arbitrary order.
 */
export function percentileRank(values: number[]): number[] {
  const n = values.length;
  if (n === 0) {
    return [];
  }
  const order = values
    .map((value, index) => ({ value, index }))
    .sort((a, b) => a.value - b.value);
  const ranks = new Array<number>(n);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && order[j + 1].value === order[i].value) {
      j += 1;
    }
    const shared = (i + j) / 2 + 1;
    for (let k = i; k <= j; k += 1) {
      ranks[order[k].index] = shared;
    }
    i = j + 1;
  }
  return ranks.map((rank) => rank / (n + 1));
}

/** Calibrated probability for a percentile, by linear interpolation. */
export function calibrate(percentile: number): number {
  const clamped = Math.min(Math.max(percentile, 0), 1);
  for (let i = 1; i < CALIBRATION.length; i += 1) {
    const [x0, y0] = CALIBRATION[i - 1];
    const [x1, y1] = CALIBRATION[i];
    if (clamped <= x1) {
      const span = x1 - x0;
      const t = span > 0 ? (clamped - x0) / span : 0;
      return y0 + t * (y1 - y0);
    }
  }
  return CALIBRATION[CALIBRATION.length - 1][1];
}

function tierFor(percentile: number): PulseTier {
  if (percentile >= TIER_HEADLINE) {
    return "headline";
  }
  return percentile >= TIER_NOTABLE ? "notable" : "rest";
}

function laneScores(
  signals: Signals[],
): { total: number[]; contributions: PulseReason[][] } {
  const percentiles = new Map<keyof Signals, number[]>();
  for (const name of SIGNAL_NAMES) {
    percentiles.set(name, percentileRank(signals.map((signal) => signal[name])));
  }
  const total = signals.map(() => 0);
  const contributions: PulseReason[][] = signals.map(() => []);
  for (const name of SIGNAL_NAMES) {
    const weight = WEIGHTS[name];
    if (weight === undefined) {
      continue;
    }
    const column = percentiles.get(name)!;
    for (let i = 0; i < signals.length; i += 1) {
      total[i] += weight * column[i];
      // Centred on the cohort median, so a contribution is positive exactly
      // when the paper is on the helpful side of its peers — which is what
      // makes it readable as a reason rather than an arbitrary quantity.
      contributions[i].push({ signal: name, contribution: weight * (column[i] - 0.5) });
    }
  }
  return { total, contributions };
}

/** Ranks from best to worst, 1-based, ties averaged. */
function descendingRanks(values: number[]): number[] {
  const percentiles = percentileRank(values.map((value) => -value));
  return percentiles.map((percentile) => percentile * (values.length + 1));
}

function hasVariation(values: (number | undefined)[]): values is number[] {
  const present = values.filter((value): value is number => value !== undefined);
  if (present.length < Math.max(values.length / 2, MIN_COHORT)) {
    return false;
  }
  return present.some((value) => value !== present[0]);
}

/**
 * Score one cohort — papers that belong together, in practice one field's
 * snapshot. Returns pulses in the same order as the input.
 */
export function scoreCohort(
  papers: Paper[],
  memory: CorpusMemory,
  now: number,
  enrichment: Map<string, Enrichment> = new Map(),
): Pulse[] {
  if (papers.length === 0) {
    return [];
  }
  const bursts = burstScores(memory, now);
  const signals = papers.map((paper) => extractSignals(paper, memory, bursts, now));
  const { total, contributions } = laneScores(signals);

  const lanes: number[][] = [descendingRanks(total)];
  const laneNames: PulseLane[] = ["signals"];

  const references = papers.map((paper) => enrichment.get(paper.id)?.references);
  if (hasVariation(references)) {
    lanes.push(descendingRanks(references.map((value) => value ?? 0)));
    laneNames.push("references");
  }
  const citations = papers.map((paper) => enrichment.get(paper.id)?.citations);
  if (hasVariation(citations)) {
    lanes.push(descendingRanks(citations.map((value) => value ?? 0)));
    laneNames.push("reception");
  }

  // Reciprocal rank fusion. It ignores each lane's scale, so a percentile, a
  // reference count and a citation count combine without any calibration step
  // between them, and no single extreme value can capture the consensus.
  const fused = papers.map((_, i) =>
    lanes.reduce((sum, lane) => sum + 1 / (RRF_K + lane[i]), 0),
  );

  // Papers whose authors are all unknown to the site are scored against each
  // other, not against papers with a track record: on author signals they are
  // all identical, so a shared pool would rank them by nothing at all and bury
  // them wholesale. The study measured that burial — hits from unknown authors
  // landed at the 49th percentile against the 88th for established ones.
  const newcomer = signals.map((signal) => signal.author_new_frac >= 1);
  const established = fused.map((value, i) => (newcomer[i] ? null : value));
  const outsiders = fused.map((value, i) => (newcomer[i] ? value : null));

  const percentileWithin = (pool: (number | null)[]): (number | null)[] => {
    const present = pool.filter((value): value is number => value !== null);
    if (present.length === 0) {
      return pool.map(() => null);
    }
    const ranked = percentileRank(present);
    let cursor = 0;
    return pool.map((value) => (value === null ? null : ranked[cursor++]));
  };

  const establishedPercentiles = percentileWithin(established);
  const outsiderPercentiles = percentileWithin(outsiders);

  return papers.map((_, i) => {
    const percentile =
      (newcomer[i] ? outsiderPercentiles[i] : establishedPercentiles[i]) ?? 0.5;
    const reasons: PulseReason[] = [...contributions[i]]
      .sort((a, b) => b.contribution - a.contribution)
      .filter((reason) => reason.contribution > 0)
      .slice(0, 3);
    return {
      score: Math.round(percentile * 100),
      tier: tierFor(percentile),
      probability: calibrate(percentile),
      lanes: laneNames,
      newcomer: newcomer[i],
      reasons,
    };
  });
}

/**
 * Order a scored list for display, reserving `quota` of the positions for
 * papers with no author history.
 *
 * Nothing is scored more generously inside either lane; the reservation only
 * stops one lane from taking every slot. Measured cost: 0.03 AUC and 6% of
 * lift@10, against outsider hits moving from the 49th percentile to the 73rd —
 * and recall@25 went slightly *up*, because the reserved slots displaced
 * mediocre papers from well-known groups.
 */
export function interleave<T>(
  items: T[],
  isNewcomer: (item: T) => boolean,
  rank: (item: T) => number,
  quota = NEWCOMER_QUOTA,
): T[] {
  const byRank = (a: T, b: T) => rank(b) - rank(a);
  const established = items.filter((item) => !isNewcomer(item)).sort(byRank);
  const fresh = items.filter(isNewcomer).sort(byRank);
  const out: T[] = [];
  let i = 0;
  let j = 0;
  while (i < established.length || j < fresh.length) {
    const takeFresh =
      j < fresh.length &&
      (i >= established.length || (out.length + 1) * quota > j + 0.5);
    out.push(takeFresh ? fresh[j++] : established[i++]);
  }
  return out;
}

/** Headline numbers from the fit, for the interface to quote honestly. */
const BAND_ORDER: PulseTier[] = ["headline", "notable", "rest"];

/**
 * Final display order: band first, newcomer reservation inside each band.
 *
 * The two mechanisms have to compose in this order. Interleaving across the
 * whole list instead lets a newcomer that is top-of-its-own-lane land between
 * two established papers from a lower band, and the reader sees the section
 * headings oscillate — "Front page", "Notable", "Front page" again — which
 * looks like a bug and is indistinguishable from one. Banding first keeps each
 * heading appearing exactly once while the reservation still holds inside it.
 */
export function orderByPulse<T>(items: T[], pulseOf: (item: T) => Pulse | undefined): T[] {
  const unscored = items.filter((item) => !pulseOf(item));
  const ordered = BAND_ORDER.flatMap((band) =>
    interleave(
      items.filter((item) => pulseOf(item)?.tier === band),
      (item) => pulseOf(item)?.newcomer ?? false,
      (item) => pulseOf(item)?.score ?? 0,
    ),
  );
  return [...ordered, ...unscored];
}

export const MODEL_INFO = {
  auc: RANKING_MODEL.validation.auc,
  aucLow: RANKING_MODEL.validation.aucLow,
  aucHigh: RANKING_MODEL.validation.aucHigh,
  liftAt10: RANKING_MODEL.validation.liftAt10,
  papers: RANKING_MODEL.trainedOn.papers,
  positives: RANKING_MODEL.trainedOn.positives,
};
