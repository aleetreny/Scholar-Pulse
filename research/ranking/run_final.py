"""Fixing what the audit broke, and measuring whether the fixes actually work.

The audit left three concrete defects in the winning model:

  1. 60% of the board went to the best-connected 10% of authors, and papers by
     unknown authors landed at the 16th percentile — the model buries outsider
     hits like FEVER and "One pixel attack".
  2. A 5% jitter on the inputs replaced three of the top ten. A board that
     reshuffles under noise that small is not reporting a finding, it is
     reporting sampling error.
  3. The score was not monotone in hit rate, so it could not honestly be shown
     to a reader as a number.

Each fix is proposed, implemented, and then measured against the defect it is
supposed to repair *and* against the accuracy it might cost.

Run:  python research/ranking/run_final.py
"""

from __future__ import annotations

import os
from pathlib import Path

import numpy as np
import pandas as pd
from arxiv_features import FEATURES
from run_arxiv import ML_CATEGORIES, Logit, cohort_metrics
from run_audit import CONTENT_FEATURES
from sklearn.isotonic import IsotonicRegression

DATA = Path(os.environ.get("RESEARCH_DATA", "/workspace/rankdata"))
RESULTS = DATA / "results"


def load() -> pd.DataFrame:
    frame = pd.read_parquet(DATA / "arxiv_features.parquet")
    papers = pd.read_parquet(DATA / "arxiv_papers.parquet")[["id", "categories", "title"]]
    frame = frame.merge(papers, on="id", how="left")
    keep = frame["categories"].apply(lambda c: bool(ML_CATEGORIES & set(c)))
    return frame[keep].reset_index(drop=True)


class Bagged:
    """Rank aggregation over bootstrap replicas.

    Each replica sees a resampled training set, so each produces a slightly
    different ordering; averaging the *ranks* (not the scores) keeps any single
    unstable model from moving the board, and the spread across replicas is a
    free, honest uncertainty estimate for each paper's position.
    """

    name = "bagged-logistic"

    def __init__(self, n: int = 25, seed: int = 0):
        self.n, self.seed = n, seed
        self.models: list = []

    def fit(self, X, y):
        rng = np.random.default_rng(self.seed)
        positives = np.where(y == 1)[0]
        negatives = np.where(y == 0)[0]
        for _ in range(self.n):
            # Resample positives and negatives separately: with 87 hits in
            # 6,366 papers, an unstratified bootstrap would sometimes draw a
            # replica with almost no positives at all.
            idx = np.concatenate(
                [
                    rng.choice(positives, positives.size, replace=True),
                    rng.choice(negatives, negatives.size, replace=True),
                ]
            )
            self.models.append(Logit().fit(X[idx], y[idx]))
        return self

    def score(self, X):
        from scipy.stats import rankdata

        ranks = np.zeros(X.shape[0])
        for model in self.models:
            ranks += rankdata(model.score(X)) / X.shape[0]
        return ranks / len(self.models)

    def spread(self, X) -> np.ndarray:
        from scipy.stats import rankdata

        stack = np.vstack([rankdata(m.score(X)) / X.shape[0] for m in self.models])
        return stack.std(axis=0)


def stratified_interleave(
    frame: pd.DataFrame, scores: np.ndarray, quota: float = 0.3
) -> np.ndarray:
    """Two lanes, one board.

    Papers by authors with a track record and papers by authors without one are
    ranked in separate lanes and then interleaved, with `quota` of the slots
    reserved for the second lane. Inside each lane the ordering is unchanged, so
    nothing is being scored more generously; the reservation only stops one lane
    from taking every slot. Newcomer papers are ranked on content alone, because
    their author features are all zero and carry no information to compare on.

    Returned values are a synthetic score, monotone in the interleaved position,
    so the same metrics apply without special-casing.
    """
    out = np.zeros(len(frame))
    newcomer = frame["author_prior_max"].to_numpy() <= np.log1p(2)
    for month in frame["t"].unique():
        mask = (frame["t"] == month).to_numpy()
        idx = np.where(mask)[0]
        established = idx[~newcomer[idx]]
        fresh = idx[newcomer[idx]]
        established = established[np.argsort(-scores[established])]
        fresh = fresh[np.argsort(-scores[fresh])]
        order: list[int] = []
        i = j = 0
        while i < established.size or j < fresh.size:
            take_fresh = (
                j < fresh.size
                and (i >= established.size or (len(order) + 1) * quota > j + 0.5)
            )
            if take_fresh:
                order.append(fresh[j])
                j += 1
            else:
                order.append(established[i])
                i += 1
        out[np.array(order)] = np.linspace(1.0, 0.0, len(order))
    return out


def out_of_fold(frame: pd.DataFrame, columns: list[str], factory, noise: float = 0.0,
                seed: int = 0) -> np.ndarray:
    X = frame[columns].to_numpy(float)
    if noise > 0:
        X = X * np.random.default_rng(seed).normal(1.0, noise, X.shape)
    y = frame["is_hit"].to_numpy()
    months = frame["t"].to_numpy()
    scores = np.full(len(frame), np.nan)
    for month in np.unique(months):
        train, test = months != month, months == month
        if y[train].sum() < 5:
            continue
        scores[test] = factory().fit(X[train], y[train]).score(X[test])
    return scores


def report(frame: pd.DataFrame, scores: np.ndarray, label: str) -> dict:
    months = frame["t"].to_numpy()
    y = frame["is_hit"].to_numpy()
    per_month = [
        cohort_metrics(scores[months == m], y[months == m])
        for m in np.unique(months)
        if y[months == m].sum() > 0
    ]
    table = pd.DataFrame(per_month)
    pct = pd.Series(scores).groupby(months).rank(pct=True).to_numpy()
    newcomer = frame["author_prior_max"].to_numpy() <= np.log1p(2)
    elite_cut = frame.groupby("t")["author_reach"].transform(lambda s: s.quantile(0.90))
    elite = (frame["author_reach"] >= elite_cut).to_numpy()
    top25 = np.zeros(len(frame), bool)
    for month in np.unique(months):
        mask = months == month
        idx = np.where(mask)[0]
        top25[idx[np.argsort(-scores[idx])[:25]]] = True
    return {
        "ranker": label,
        "auc": float(np.nanmean(table["auc"])),
        "recall@25": float(np.nanmean(table["recall@25"])),
        "lift@25": float(np.nanmean(table["lift@25"])),
        "lift@10": float(np.nanmean(table["lift@10"])),
        "outsider_hit_pct": float(np.median(pct[(y == 1) & newcomer])),
        "insider_hit_pct": float(np.median(pct[(y == 1) & ~newcomer])),
        "elite_share_top25": float(elite[top25].mean()),
        "newcomer_share_top25": float(newcomer[top25].mean()),
    }


def main() -> None:
    RESULTS.mkdir(parents=True, exist_ok=True)
    frame = load()
    print(f"corpus: {len(frame):,} papers, {int(frame['is_hit'].sum())} hits, "
          f"{frame['t'].nunique()} months")

    plain = out_of_fold(frame, FEATURES, Logit)
    bagged = out_of_fold(frame, FEATURES, Bagged)
    content = out_of_fold(frame, CONTENT_FEATURES, Logit)

    rows = [
        report(frame, plain, "logistic (audit baseline)"),
        report(frame, bagged, "bagged rank aggregation"),
        report(frame, content, "content signals only"),
    ]
    for quota in [0.2, 0.3, 0.4]:
        blended = np.where(
            frame["author_prior_max"].to_numpy() <= np.log1p(2), content, bagged
        )
        rows.append(
            report(
                frame,
                stratified_interleave(frame, blended, quota=quota),
                f"bagged + newcomer lane ({quota:.0%})",
            )
        )
    summary = pd.DataFrame(rows)
    print("\n=== E13 accuracy vs. concentration, after the fixes ===")
    print(summary.to_string(index=False, float_format=lambda v: f"{v:7.3f}"))

    print("\n=== E14 stability under input noise (top-10 overlap with the clean board) ===")

    def overlap(a, b, months, k=10):
        shares = []
        for month in np.unique(months):
            mask = months == month
            top_a = set(np.argsort(-a[mask])[:k])
            top_b = set(np.argsort(-b[mask])[:k])
            shares.append(len(top_a & top_b) / k)
        return float(np.mean(shares))

    months = frame["t"].to_numpy()
    for sigma in [0.05, 0.10, 0.25]:
        plain_o = np.mean([
            overlap(plain, out_of_fold(frame, FEATURES, Logit, noise=sigma, seed=s), months)
            for s in range(5)
        ])
        bag_o = np.mean([
            overlap(bagged, out_of_fold(frame, FEATURES, Bagged, noise=sigma, seed=s), months)
            for s in range(5)
        ])
        print(f"    sigma={sigma:.2f}  single model {plain_o:.3f}   bagged {bag_o:.3f}   "
              f"({bag_o - plain_o:+.3f})")

    print("\n=== E14b tiers instead of positions ===")
    print("    Bagging averages away *model* variance, but every replica reads the")
    print("    same perturbed inputs, so it cannot damp *input* noise — E14 shows")
    print("    exactly that. If the ordering inside the head of the list is not")
    print("    stable, the honest fix is to stop publishing an ordering there.")
    tier_edges = [0, 0.90, 0.99, 1.0]
    tier_names = ["rest", "notable", "headline"]

    def tiers(scores: np.ndarray) -> np.ndarray:
        out = np.empty(scores.size, dtype=object)
        for month in np.unique(months):
            mask = months == month
            pct = pd.Series(scores[mask]).rank(pct=True)
            out[mask] = pd.cut(pct, tier_edges, labels=tier_names,
                               include_lowest=True).astype(str)
        return out

    base_tiers = tiers(bagged)
    for sigma in [0.05, 0.10, 0.25]:
        agree, order_overlap = [], []
        for seed in range(5):
            noisy = out_of_fold(frame, FEATURES, Bagged, noise=sigma, seed=seed)
            agree.append(float((tiers(noisy) == base_tiers).mean()))
            order_overlap.append(overlap(bagged, noisy, months))
        print(f"    sigma={sigma:.2f}  tier agreement {np.mean(agree):.3f}   "
              f"strict top-10 overlap {np.mean(order_overlap):.3f}")

    print("\n=== E14c what a chronological feed scores (today's product) ===")
    papers = pd.read_parquet(DATA / "arxiv_papers.parquet")[["id", "day"]]
    day = frame.merge(papers, on="id", how="left")["day"].to_numpy(float)
    print(pd.DataFrame([
        report(frame, -day, "newest first"),
        report(frame, day, "oldest first"),
        report(frame, np.random.default_rng(0).random(len(frame)), "shuffled"),
        report(frame, bagged, "bagged model"),
    ])[["ranker", "auc", "recall@25", "lift@25", "lift@10"]].to_string(
        index=False, float_format=lambda v: f"{v:7.3f}"))

    print("\n=== E15 calibration after isotonic regression, on held-out months ===")
    y = frame["is_hit"].to_numpy()
    calibrated = np.full(len(frame), np.nan)
    for month in np.unique(months):
        train, test = months != month, months == month
        pct_train = pd.Series(bagged[train]).rank(pct=True).to_numpy()
        iso = IsotonicRegression(out_of_bounds="clip", y_min=0, y_max=1)
        iso.fit(pct_train, y[train])
        calibrated[test] = iso.predict(pd.Series(bagged[test]).rank(pct=True).to_numpy())
    band = pd.cut(pd.Series(bagged).groupby(months).rank(pct=True),
                  [0, 0.5, 0.9, 0.99, 1.0], include_lowest=True)
    table = pd.DataFrame({"band": band, "hit": y, "predicted": calibrated}).groupby(
        "band", observed=True
    ).agg(papers=("hit", "size"), observed=("hit", "mean"), predicted=("predicted", "mean"))
    print(table.to_string(float_format=lambda v: f"{v:9.4f}"))
    print(f"    monotone in observed hit rate: {table['observed'].is_monotonic_increasing}")

    summary.to_csv(RESULTS / "e13_final.csv", index=False)


if __name__ == "__main__":
    main()
