"""Ranking metrics and the resampling machinery used to compare rankers.

Everything here is cohort-aware. A "cohort" is one batch of papers that the
product would show together (in practice: everything submitted in the same
month). Scoring across cohorts would be cheating, because an older paper has
had more time to accumulate citations; all comparisons stay inside a cohort and
are then averaged across cohorts.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy import stats


def dcg(gains: np.ndarray) -> float:
    return float(np.sum(gains / np.log2(np.arange(2, gains.size + 2))))


def ndcg_at_k(scores: np.ndarray, labels: np.ndarray, k: int) -> float:
    """Normalised discounted cumulative gain with gain = log1p(citations).

    The log gain matters: citation counts are heavy-tailed, and a raw-count
    gain would make NDCG a referendum on whether the single biggest hit was
    caught, drowning out everything else.
    """
    if scores.size == 0:
        return np.nan
    k = min(k, scores.size)
    gains = np.log1p(labels)
    order = np.argsort(-scores, kind="stable")
    ideal = np.argsort(-gains, kind="stable")
    best = dcg(gains[ideal][:k])
    return dcg(gains[order][:k]) / best if best > 0 else np.nan


def precision_at_k(scores: np.ndarray, labels: np.ndarray, k: int, quantile: float) -> float:
    """Share of the top-k that belongs to the cohort's top `quantile` by citations."""
    if scores.size < 2:
        return np.nan
    k = min(k, scores.size)
    threshold = np.quantile(labels, quantile)
    hit = labels >= max(threshold, 1)
    if hit.sum() == 0:
        return np.nan
    order = np.argsort(-scores, kind="stable")[:k]
    return float(hit[order].mean())


def lift_at_k(scores: np.ndarray, labels: np.ndarray, k: int) -> float:
    """Mean citations of the top-k divided by the cohort mean.

    The number a reader actually feels: "the papers this page shows me are N
    times more cited than a paper picked at random from the same day."
    """
    if scores.size < 2 or labels.mean() <= 0:
        return np.nan
    k = min(k, scores.size)
    order = np.argsort(-scores, kind="stable")[:k]
    return float(labels[order].mean() / labels.mean())


def spearman(scores: np.ndarray, labels: np.ndarray) -> float:
    if scores.size < 3 or np.all(labels == labels[0]) or np.all(scores == scores[0]):
        return np.nan
    return float(stats.spearmanr(scores, labels).statistic)


def hit_rate_top1(scores: np.ndarray, labels: np.ndarray, k: int) -> float:
    """Does the top-k contain the single most-cited paper of the cohort?"""
    if scores.size < 2:
        return np.nan
    k = min(k, scores.size)
    order = np.argsort(-scores, kind="stable")[:k]
    return float(labels[order].max() >= labels.max())


@dataclass
class CohortResult:
    ndcg10: float
    ndcg20: float
    p_at_10: float
    lift10: float
    spearman: float
    top1_in_10: float
    size: int


def score_cohort(scores: np.ndarray, labels: np.ndarray) -> CohortResult:
    return CohortResult(
        ndcg10=ndcg_at_k(scores, labels, 10),
        ndcg20=ndcg_at_k(scores, labels, 20),
        p_at_10=precision_at_k(scores, labels, 10, 0.90),
        lift10=lift_at_k(scores, labels, 10),
        spearman=spearman(scores, labels),
        top1_in_10=hit_rate_top1(scores, labels, 10),
        size=int(scores.size),
    )


def bootstrap_ci(
    values: np.ndarray, n_boot: int = 4000, alpha: float = 0.05, seed: int = 0
) -> tuple[float, float, float]:
    """Mean and percentile CI, resampling *cohorts* rather than papers.

    Cohorts are the independent replicates here: papers inside a month share a
    graph state and a topic mix, so resampling papers would understate the
    uncertainty badly.
    """
    values = values[~np.isnan(values)]
    if values.size == 0:
        return np.nan, np.nan, np.nan
    rng = np.random.default_rng(seed)
    draws = rng.choice(values, size=(n_boot, values.size), replace=True).mean(axis=1)
    return (
        float(values.mean()),
        float(np.quantile(draws, alpha / 2)),
        float(np.quantile(draws, 1 - alpha / 2)),
    )


def paired_test(a: np.ndarray, b: np.ndarray, n_boot: int = 4000, seed: int = 0) -> dict:
    """Paired bootstrap on the per-cohort difference a - b.

    Paired because both rankers see exactly the same cohorts; the shared
    month-to-month variance cancels, which is what makes small but consistent
    gains detectable at all.
    """
    mask = ~(np.isnan(a) | np.isnan(b))
    diff = a[mask] - b[mask]
    if diff.size == 0:
        return {"delta": np.nan, "lo": np.nan, "hi": np.nan, "p_better": np.nan}
    rng = np.random.default_rng(seed)
    draws = rng.choice(diff, size=(n_boot, diff.size), replace=True).mean(axis=1)
    return {
        "delta": float(diff.mean()),
        "lo": float(np.quantile(draws, 0.025)),
        "hi": float(np.quantile(draws, 0.975)),
        "p_better": float((draws > 0).mean()),
        "n_cohorts": int(diff.size),
    }
