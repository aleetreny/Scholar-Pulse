"""Experiment suite on modern arXiv metadata: the data ScholarPulse already has.

The citation lab answered "is future impact predictable at all". This one asks
the harder product question: predictable *from the Atom feed alone*, on the day
the paper appears, before any indexer has touched it.

Ground truth is a curated set of 93 papers that turned out to matter in cs.LG
and cs.CL between 2017-05 and 2018-03 (PPO, Progressive GANs, AlphaZero,
CheXNet, ...), located inside a 41,000-paper corpus. The unlabelled remainder
certainly contains further hits, so every absolute number here is pessimistic,
but it is pessimistic identically for every ranker, so the comparisons hold.

Validation is leave-one-month-out: a model scoring May 2017 is trained only on
the other months, never on its own cohort.

Run:  python research/ranking/run_arxiv.py
"""

from __future__ import annotations

import os
from pathlib import Path

import numpy as np
import pandas as pd
from arxiv_features import FEATURES
from metrics import bootstrap_ci, paired_test
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from sklearn.preprocessing import StandardScaler

DATA = Path(os.environ.get("RESEARCH_DATA", "/workspace/rankdata"))
RESULTS = DATA / "results"
ML_CATEGORIES = {"cs.LG", "cs.CL", "stat.ML"}


def cohort_metrics(scores: np.ndarray, hits: np.ndarray, ks=(10, 25, 50)) -> dict:
    out: dict[str, float] = {}
    if hits.sum() == 0 or hits.sum() == hits.size:
        return {"auc": np.nan, **{f"recall@{k}": np.nan for k in ks},
                **{f"lift@{k}": np.nan for k in ks}, "median_pct": np.nan}
    out["auc"] = float(roc_auc_score(hits, scores))
    order = np.argsort(-scores, kind="stable")
    ranked = hits[order]
    base = hits.mean()
    for k in ks:
        k = min(k, hits.size)
        out[f"recall@{k}"] = float(ranked[:k].sum() / hits.sum())
        out[f"lift@{k}"] = float(ranked[:k].mean() / base)
    # Where the known hits land, as a percentile of the cohort (1.0 = top).
    percentile = 1.0 - (np.argsort(np.argsort(-scores)) / hits.size)
    out["median_pct"] = float(np.median(percentile[hits == 1]))
    return out


class Logit:
    name = "logistic"

    def __init__(self):
        self.scaler, self.model = StandardScaler(), LogisticRegression(
            max_iter=2000, class_weight="balanced", C=0.5
        )

    def fit(self, X, y):
        self.model.fit(self.scaler.fit_transform(X), y)
        return self

    def score(self, X):
        return self.model.decision_function(self.scaler.transform(X))


class GBClassifier:
    name = "gbm"

    def __init__(self, seed=0):
        self.model = HistGradientBoostingClassifier(
            max_depth=3, learning_rate=0.05, max_iter=250,
            min_samples_leaf=30, l2_regularization=1.0, random_state=seed,
            class_weight="balanced",
        )

    def fit(self, X, y):
        self.model.fit(X, y)
        return self

    def score(self, X):
        return self.model.predict_proba(X)[:, 1]


class SingleFeature:
    """One column, oriented on the training fold.

    The orientation is decided by AUC, not by comparing group means. These
    features are heavy-tailed and the two disagree: a mean-based sign flipped
    `pair_novelty` and reported it at 0.420, an apparently strong negative
    signal; oriented properly it sits at 0.503, which is noise.
    """

    def __init__(self, column, name):
        self.column, self.name, self.sign = column, f"feat:{name}", 1.0

    def fit(self, X, y):
        column = X[:, self.column]
        if np.std(column) > 0 and 0 < y.sum() < y.size:
            self.sign = 1.0 if roc_auc_score(y, column) >= 0.5 else -1.0
        return self

    def score(self, X):
        return self.sign * X[:, self.column]


class RandomRanker:
    name = "random"

    def __init__(self, seed=0):
        self.rng = np.random.default_rng(seed)

    def fit(self, X, y):
        return self

    def score(self, X):
        return self.rng.random(X.shape[0])


def evaluate(model_factory, frame, columns) -> pd.DataFrame:
    """Leave-one-month-out: the cohort being scored never appears in training."""
    X = frame[columns].to_numpy(float)
    y = frame["is_hit"].to_numpy()
    months = frame["t"].to_numpy()
    rows = []
    for month in np.unique(months):
        train, test = months != month, months == month
        if y[train].sum() < 5 or y[test].sum() == 0:
            continue
        model = model_factory().fit(X[train], y[train])
        rows.append({"t": int(month), "n": int(test.sum()), "hits": int(y[test].sum()),
                     **cohort_metrics(model.score(X[test]), y[test])})
    return pd.DataFrame(rows)


def summarise(name: str, table: pd.DataFrame) -> dict:
    out = {"ranker": name, "cohorts": len(table)}
    for metric in ["auc", "recall@25", "lift@25", "lift@10", "median_pct"]:
        mean, lo, hi = bootstrap_ci(table[metric].to_numpy())
        out[metric] = mean
        if metric in ("auc", "lift@25"):
            out[f"{metric}_lo"], out[f"{metric}_hi"] = lo, hi
    return out


def main() -> None:
    RESULTS.mkdir(parents=True, exist_ok=True)
    frame = pd.read_parquet(DATA / "arxiv_features.parquet")
    papers = pd.read_parquet(DATA / "arxiv_papers.parquet")[["id", "categories"]]
    frame = frame.merge(papers, on="id", how="left")
    in_scope = frame["categories"].apply(lambda c: bool(ML_CATEGORIES & set(c)))
    print(f"all candidates: {len(frame):,} ({frame['is_hit'].sum()} hits, "
          f"{frame['is_hit'].mean():.2%} base rate)")
    print(f"machine-learning listings only: {in_scope.sum():,} "
          f"({frame.loc[in_scope, 'is_hit'].sum()} hits, "
          f"{frame.loc[in_scope, 'is_hit'].mean():.2%} base rate)")

    for scope_name, subset in [("ML listings", frame[in_scope].reset_index(drop=True)),
                               ("whole feed", frame)]:
        rows, tables = [], {}
        contenders = [(RandomRanker, "random")]
        contenders += [
            ((lambda i=i, n=n: SingleFeature(i, n)), f"feat:{n}") for i, n in enumerate(FEATURES)
        ]
        contenders += [(Logit, "logistic"), (GBClassifier, "gbm")]
        for factory, name in contenders:
            table = evaluate(factory, subset, FEATURES)
            if table.empty:
                continue
            tables[name] = table
            rows.append(summarise(name, table))
        summary = pd.DataFrame(rows).sort_values("auc", ascending=False)
        print(f"\n=== {scope_name}: finding tomorrow's landmarks in today's feed ===")
        print(
            summary[["ranker", "auc", "auc_lo", "auc_hi", "recall@25", "lift@25",
                     "lift@10", "median_pct", "cohorts"]]
            .head(16)
            .to_string(index=False, float_format=lambda v: f"{v:7.3f}")
        )
        print("    (weakest signals)")
        print(
            summary[["ranker", "auc", "recall@25", "lift@25"]]
            .tail(4)
            .to_string(index=False, float_format=lambda v: f"{v:7.3f}")
        )
        best = summary["ranker"].iloc[0]
        stat = paired_test(tables[best]["auc"].to_numpy(), tables["random"]["auc"].to_numpy())
        print(f"    {best} vs random: dAUC {stat['delta']:+.3f} "
              f"[{stat['lo']:+.3f},{stat['hi']:+.3f}] P(better)={stat['p_better']:.3f} "
              f"over {stat['n_cohorts']} months")
        summary.to_csv(RESULTS / f"e8_arxiv_{scope_name.replace(' ', '_')}.csv", index=False)


if __name__ == "__main__":
    main()
