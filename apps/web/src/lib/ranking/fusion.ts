/**
 * Coverage-weighted reciprocal rank fusion on a common percentile scale.
 * A rank of 1/8 must not be mistaken for 1/500. Missing observations receive
 * the neutral rank and the lane's weight is its measured coverage. Equal
 * observations remain tied; invalid counts never become evidence.
 */
export function percentileRank(values: number[]): number[] {
  const order = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const result = new Array<number>(values.length);
  for (let i = 0; i < order.length;) {
    let j = i;
    while (j + 1 < order.length && order[j + 1].value === order[i].value) j += 1;
    const percentile = ((i + j) / 2 + 1) / (values.length + 1);
    for (let k = i; k <= j; k += 1) result[order[k].index] = percentile;
    i = j + 1;
  }
  return result;
}

export function validCount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export type RankEvidence = {
  contributions: number[];
  coverage: number;
};

export function rankEvidence(values: (number | undefined)[], minimum = 8): RankEvidence | null {
  const positions = values.flatMap((value, index) => validCount(value) ? [index] : []);
  const known = positions.map((index) => values[index]!);
  if (known.length < minimum || known.every((value) => value === known[0])) return null;
  const percentiles = percentileRank(known.map((value) => -value));
  const coverage = known.length / values.length;
  // k / (n + 1) = 0.2: the original k=20 at a ~100-paper cohort, now
  // invariant to the number of candidates. Subtracting the midpoint makes
  // "no observation" exactly zero evidence, not a manufactured zero count.
  const neutral = 1 / (0.2 + 0.5);
  const contributions = values.map(() => 0);
  positions.forEach((position, i) => {
    contributions[position] = coverage * (1 / (0.2 + percentiles[i]) - neutral);
  });
  return { contributions, coverage };
}
