"""Audit: where the signal really comes from, and how the ranker fails.

A ranker that scores well on a benchmark and cannot be shipped is worth nothing,
so this file attacks the winning model from three directions.

  E10  reputation vs content: is this predicting good papers, or famous
       authors? And if it is the latter, what does it systematically miss?
  E11  calibration: can the score be shown to a reader as a number that means
       something, rather than an arbitrary quantity that only sorts?
  E12  robustness: how much does the published top-10 move when a feature goes
       missing, when inputs are noisy, or when the model is retrained on a
       different slice of history?

Run:  python research/ranking/run_audit.py
"""

from __future__ import annotations

import os
from pathlib import Path

import numpy as np
import pandas as pd
from arxiv_features import FEATURES
from metrics import bootstrap_ci
from run_arxiv import ML_CATEGORIES, GBClassifier, Logit, cohort_metrics, evaluate, summarise
from scipy.stats import kendalltau

DATA = Path(os.environ.get("RESEARCH_DATA", "/workspace/rankdata"))
RESULTS = DATA / "results"

AUTHOR_FEATURES = [
    "team_size", "author_prior_max", "author_prior_mean", "author_new_frac",
    "author_degree_max", "author_pagerank_max", "author_recency", "author_reach",
]
CONTENT_FEATURES = [f for f in FEATURES if f not in AUTHOR_FEATURES]


def load() -> pd.DataFrame:
    frame = pd.read_parquet(DATA / "arxiv_features.parquet")
    papers = pd.read_parquet(DATA / "arxiv_papers.parquet")[["id", "categories", "title"]]
    frame = frame.merge(papers, on="id", how="left")
    keep = frame["categories"].apply(lambda c: bool(ML_CATEGORIES & set(c)))
    return frame[keep].reset_index(drop=True)


def fitted_scores(frame: pd.DataFrame, columns: list[str], factory=Logit) -> np.ndarray:
    """Out-of-fold scores for every paper, under leave-one-month-out."""
    X = frame[columns].to_numpy(float)
    y = frame["is_hit"].to_numpy()
    months = frame["t"].to_numpy()
    scores = np.full(len(frame), np.nan)
    for month in np.unique(months):
        train, test = months != month, months == month
        if y[train].sum() < 5:
            continue
        scores[test] = factory().fit(X[train], y[train]).score(X[test])
    return scores


def experiment_reputation(frame: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for label, columns, factory in [
        ("all signals", FEATURES, Logit),
        ("author signals only", AUTHOR_FEATURES, Logit),
        ("content signals only", CONTENT_FEATURES, Logit),
        ("content only (gbm)", CONTENT_FEATURES, GBClassifier),
    ]:
        rows.append(summarise(label, evaluate(factory, frame, columns)))
    summary = pd.DataFrame(rows)
    print("\n=== E10a where the signal lives ===")
    print(summary[["ranker", "auc", "auc_lo", "auc_hi", "recall@25", "lift@25", "lift@10"]]
          .to_string(index=False, float_format=lambda v: f"{v:7.3f}"))

    # Who ends up on the board, and who never does.
    scores = fitted_scores(frame, FEATURES)
    frame = frame.assign(score=scores)
    rows_conc = []
    for _month, block in frame.groupby("t"):
        block = block.dropna(subset=["score"])
        if block.empty:
            continue
        elite_cut = block["author_reach"].quantile(0.90)
        top = block.nlargest(25, "score")
        rows_conc.append(
            {
                "share_elite_in_top25": float((top["author_reach"] >= elite_cut).mean()),
                "share_elite_in_cohort": float((block["author_reach"] >= elite_cut).mean()),
                "share_newcomer_in_top25": float((top["author_new_frac"] == 1.0).mean()),
                "share_newcomer_in_cohort": float((block["author_new_frac"] == 1.0).mean()),
            }
        )
    concentration = pd.DataFrame(rows_conc).mean()
    print("\n=== E10b concentration: who the board actually shows ===")
    print(f"    top-10% by collaboration reach: {concentration['share_elite_in_cohort']:.1%} of the "
          f"feed, {concentration['share_elite_in_top25']:.1%} of the board "
          f"({concentration['share_elite_in_top25'] / max(concentration['share_elite_in_cohort'], 1e-9):.1f}x over-represented)")
    print(f"    papers where every author is new: {concentration['share_newcomer_in_cohort']:.1%} of "
          f"the feed, {concentration['share_newcomer_in_top25']:.1%} of the board")

    # The failure that matters: hits by people with no track record. The
    # percentile is taken against the whole month's feed, since ranking hits only
    # against other hits would answer a different and far easier question.
    scored = frame.dropna(subset=["score"]).copy()
    scored["pct"] = scored.groupby("t")["score"].rank(pct=True)
    hits = scored[scored["is_hit"] == 1]
    outsider = hits["author_prior_max"] <= np.log1p(2)
    print("\n=== E10c recall on outsider hits (percentile within the whole month) ===")
    print(f"    hits from established authors : median percentile "
          f"{hits.loc[~outsider, 'pct'].median():.3f}  (n={int((~outsider).sum())})")
    print(f"    hits from unknown authors     : median percentile "
          f"{hits.loc[outsider, 'pct'].median():.3f}  (n={int(outsider.sum())})")
    if outsider.sum():
        missed = hits.loc[outsider].nsmallest(3, "pct")[["title", "pct"]]
        print("    worst-ranked outsider hits:")
        for _, row in missed.iterrows():
            print(f"      p{row['pct']:.2f}  {row['title'][:78]}")
    return summary


def experiment_calibration(frame: pd.DataFrame) -> None:
    """Does a higher score mean a genuinely higher chance of mattering?"""
    scores = fitted_scores(frame, FEATURES)
    frame = frame.assign(score=scores).dropna(subset=["score"])
    frame["pulse"] = frame.groupby("t")["score"].rank(pct=True)
    bins = [0, 0.5, 0.8, 0.9, 0.95, 0.99, 1.0]
    frame["band"] = pd.cut(frame["pulse"], bins=bins, include_lowest=True)
    table = frame.groupby("band", observed=True).agg(
        papers=("is_hit", "size"), hits=("is_hit", "sum"), rate=("is_hit", "mean")
    )
    table["lift"] = table["rate"] / frame["is_hit"].mean()
    print("\n=== E11 calibration: hit rate by score band ===")
    print(table.to_string(float_format=lambda v: f"{v:8.4f}"))
    monotone = table["rate"].is_monotonic_increasing
    print(f"    monotone in the score: {monotone}")


def experiment_robustness(frame: pd.DataFrame) -> None:
    base = fitted_scores(frame, FEATURES)
    frame = frame.assign(base=base).dropna(subset=["base"])

    def overlap_at_k(a: np.ndarray, b: np.ndarray, groups: np.ndarray, k: int = 10) -> float:
        shares = []
        for group in np.unique(groups):
            mask = groups == group
            top_a = set(np.argsort(-a[mask])[:k])
            top_b = set(np.argsort(-b[mask])[:k])
            shares.append(len(top_a & top_b) / k)
        return float(np.mean(shares))

    months = frame["t"].to_numpy()
    print("\n=== E12a leave-one-feature-out: how much does the board move? ===")
    drops = []
    for feature in FEATURES:
        scores = fitted_scores(frame, [f for f in FEATURES if f != feature])
        drops.append(
            {
                "removed": feature,
                "overlap@10": overlap_at_k(frame["base"].to_numpy(), scores, months),
                "kendall": float(kendalltau(frame["base"], scores).statistic),
            }
        )
    drop_table = pd.DataFrame(drops).sort_values("overlap@10")
    print(drop_table.head(6).to_string(index=False, float_format=lambda v: f"{v:7.3f}"))
    print(f"    median overlap@10 across all 24 single-feature removals: "
          f"{drop_table['overlap@10'].median():.3f}")

    print("\n=== E12b input noise: multiplicative jitter on every feature ===")
    rng = np.random.default_rng(0)
    X = frame[FEATURES].to_numpy(float)
    for sigma in [0.05, 0.10, 0.25]:
        overlaps = []
        for seed in range(5):
            rng = np.random.default_rng(seed)
            noisy = frame.copy()
            noisy[FEATURES] = X * rng.normal(1.0, sigma, X.shape)
            overlaps.append(
                overlap_at_k(frame["base"].to_numpy(), fitted_scores(noisy, FEATURES), months)
            )
        mean, lo, hi = bootstrap_ci(np.array(overlaps), n_boot=500)
        print(f"    sigma={sigma:.2f}  top-10 overlap {mean:.3f} [{lo:.3f},{hi:.3f}]")

    print("\n=== E12c missing author history (a new author, or an unmatched name) ===")
    for rate in [0.10, 0.25, 0.50]:
        overlaps, aucs = [], []
        for seed in range(5):
            rng = np.random.default_rng(seed)
            broken = frame.copy()
            mask = rng.random(len(frame)) < rate
            broken.loc[mask, AUTHOR_FEATURES] = 0.0
            scores = fitted_scores(broken, FEATURES)
            overlaps.append(overlap_at_k(frame["base"].to_numpy(), scores, months))
            per_month = [
                cohort_metrics(scores[months == m], frame["is_hit"].to_numpy()[months == m])["auc"]
                for m in np.unique(months)
            ]
            aucs.append(np.nanmean(per_month))
        print(f"    {rate:.0%} of papers with no author history: "
              f"top-10 overlap {np.mean(overlaps):.3f}, AUC {np.mean(aucs):.3f}")


def main() -> None:
    RESULTS.mkdir(parents=True, exist_ok=True)
    frame = load()
    print(f"audit corpus: {len(frame):,} papers, {int(frame['is_hit'].sum())} known hits, "
          f"{frame['t'].nunique()} months")
    experiment_reputation(frame).to_csv(RESULTS / "e10_reputation.csv", index=False)
    experiment_calibration(frame)
    experiment_robustness(frame)


if __name__ == "__main__":
    main()
