"""Fit the shippable model and write it into the web app.

The research models were free to use anything the corpora contained. A
deployment is not: it can only compute what the arXiv Atom feed plus its own
accumulated history give it. This script refits on exactly that subset and
exports the result, so the coefficients the site runs on are measured, not
invented.

Three deliberate differences from the research fit:

* Features are **rank-transformed inside the cohort** before the model sees
  them, instead of standardised. Percentiles are unitless, so coefficients
  fitted on a 41,000-paper corpus from 2017 still mean something applied to a
  snapshot of 100 papers from this week — which a mean and a standard deviation
  fitted on the old corpus would not.

* Three features are dropped because a static build cannot compute them
  honestly: co-authorship PageRank (needs the whole graph in memory) and the
  two TF-IDF distinctiveness measures (need a fitted vectoriser). The cost is
  reported rather than hidden.

* Every feature is **pre-oriented to point upwards, and the weights are
  constrained to be non-negative.** Fitting all 21 freely produced a model held
  together by cancellation: `cross_list` at -2.20 against `n_categories` at
  +1.65, and author signals fighting each other despite every one of them being
  positive on its own — six of twenty-one coefficients pointed against their own
  univariate direction. Those pairs are near-duplicates, so an unconstrained fit
  splits one effect into two large opposing weights. That scores well on the
  corpus it was fitted on and comes apart on any cohort whose correlations
  differ, which is every cohort a deployment will ever see.

  Orienting each feature by its own direction and then forbidding negative
  weights turns the score into a weighted vote among signals that all point the
  same way. Cancellation becomes impossible by construction, the weights survive
  a change in correlation structure, and — not incidentally — every paper's
  score decomposes into non-negative contributions, which is what makes an
  honest "why is this here?" explanation possible in the interface.

Output: apps/web/src/lib/ranking/model.generated.ts

It is emitted as TypeScript rather than JSON so that the same module resolves
identically in the Next bundler and in the bare Node process that builds the
snapshots, with no JSON import attributes and no loader configuration in
either — and so the shape is type-checked at build time.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import numpy as np
import pandas as pd
from arxiv_features import FEATURES
from metrics import bootstrap_ci
from models import cohort_rank_transform
from run_arxiv import ML_CATEGORIES, cohort_metrics
from scipy.optimize import minimize
from scipy.special import expit
from sklearn.isotonic import IsotonicRegression
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score

DATA = Path(os.environ.get("RESEARCH_DATA", "/workspace/rankdata"))
ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "apps/web/src/lib/ranking/model.generated.ts"

# Needs the full co-authorship graph, or a fitted vectoriser, neither of which
# survives a static build.
NOT_DEPLOYABLE = {"author_pagerank_max", "distinctiveness", "centroid_similarity"}
DEPLOYABLE = [f for f in FEATURES if f not in NOT_DEPLOYABLE]

C_GRID = [0.05, 0.1, 0.25, 0.5, 1.0]


def load() -> pd.DataFrame:
    frame = pd.read_parquet(DATA / "arxiv_features.parquet")
    papers = pd.read_parquet(DATA / "arxiv_papers.parquet")[["id", "categories"]]
    frame = frame.merge(papers, on="id", how="left")
    keep = frame["categories"].apply(lambda c: bool(ML_CATEGORIES & set(c)))
    return frame[keep].reset_index(drop=True)


def fit_free(Xr: np.ndarray, y: np.ndarray, C: float) -> np.ndarray:
    """Unconstrained logistic fit, for comparison only."""
    model = LogisticRegression(max_iter=4000, class_weight="balanced", C=C,
                               fit_intercept=False)
    model.fit(Xr, y)
    return model.coef_.ravel()


def fit_nonneg(Xr: np.ndarray, y: np.ndarray, C: float) -> np.ndarray:
    """Class-balanced L2 logistic regression with the weights pinned to w >= 0.

    scikit-learn has no bounded solver, but the objective is smooth and convex,
    so L-BFGS-B with a lower bound of zero solves it exactly and in milliseconds
    at this size. The analytic gradient is supplied so the optimiser does not
    have to difference its way there.
    """
    n, d = Xr.shape
    positive = y == 1
    weight = np.where(
        positive,
        0.5 * n / max(positive.sum(), 1),
        0.5 * n / max((~positive).sum(), 1),
    )
    signed = np.where(positive, 1.0, -1.0)

    def objective(w: np.ndarray):
        margin = -signed * (Xr @ w)
        loss = float(np.sum(weight * np.logaddexp(0.0, margin)) + 0.5 * w @ w / C)
        grad = Xr.T @ (weight * -signed * expit(margin)) + w / C
        return loss, grad

    result = minimize(objective, np.zeros(d), jac=True, method="L-BFGS-B",
                      bounds=[(0.0, None)] * d)
    return result.x


def orientations(Xr: np.ndarray, y: np.ndarray) -> np.ndarray:
    """+1 if the feature rises with hits on its own, -1 if it falls."""
    return np.array([
        1.0 if roc_auc_score(y, Xr[:, j]) >= 0.5 else -1.0
        for j in range(Xr.shape[1])
    ])


def cross_validate(frame: pd.DataFrame, columns: list[str], C: float,
                   nonneg: bool = True) -> pd.DataFrame:
    """Leave-one-month-out: the month being scored never trains the model.

    The orientation of each feature is decided inside the training fold too —
    reading it off the whole corpus would leak the held-out month's direction.
    """
    X = frame[columns].to_numpy(float)
    y = frame["is_hit"].to_numpy()
    months = frame["t"].to_numpy()
    rows = []
    for month in np.unique(months):
        train, test = months != month, months == month
        if y[train].sum() < 5 or y[test].sum() == 0:
            continue
        Xtr = cohort_rank_transform(X[train], months[train])
        Xte = cohort_rank_transform(X[test], months[test])
        if nonneg:
            sign = orientations(Xtr, y[train])
            coef = fit_nonneg(Xtr * sign, y[train], C)
            scores = (Xte * sign) @ coef
        else:
            scores = Xte @ fit_free(Xtr, y[train], C)
        rows.append(cohort_metrics(scores, y[test]))
    return pd.DataFrame(rows)


def mean_auc(frame: pd.DataFrame, columns: list[str], C: float, nonneg=True) -> float:
    table = cross_validate(frame, columns, C, nonneg)
    return float(np.nanmean(table["auc"])) if not table.empty else float("nan")


def main() -> None:
    frame = load()
    y = frame["is_hit"].to_numpy()
    months = frame["t"].to_numpy()
    print(f"corpus: {len(frame):,} papers, {int(y.sum())} known hits, "
          f"{frame['t'].nunique()} months")

    Xall = cohort_rank_transform(frame[DEPLOYABLE].to_numpy(float), months)
    sign = orientations(Xall, y)

    print("\n=== why the weights are constrained ===")
    free = fit_free(Xall, y, 0.5)
    conflicts = [n for n, w, s in zip(DEPLOYABLE, free, sign, strict=True)
                 if np.sign(w) != s and abs(w) > 1e-3]
    print(f"  fitting all {len(DEPLOYABLE)} freely: {len(conflicts)} coefficients point")
    print(f"  against their own univariate direction — {', '.join(conflicts)}")
    print("  those are cancellation artefacts and do not survive a change of cohort.")

    print("\n=== picking the regularisation strength (non-negative fit) ===")
    scores = {}
    for candidate in C_GRID:
        scores[candidate] = mean_auc(frame, DEPLOYABLE, candidate)
        print(f"  C={candidate:<5} AUC {scores[candidate]:.3f}")
    C = max(scores, key=lambda k: scores[k])

    print("\n=== what each variant is worth (leave-one-month-out) ===")
    variants = [
        ("all 24 research features, free", FEATURES),
        (f"{len(DEPLOYABLE)} deployable, free", DEPLOYABLE),
    ]
    for label, columns in variants:
        table = cross_validate(frame, columns, C, nonneg=False)
        auc, lo, hi = bootstrap_ci(table["auc"].to_numpy())
        print(f"  {label:<34} AUC {auc:.3f} [{lo:.3f},{hi:.3f}]  "
              f"lift@10 {np.nanmean(table['lift@10']):5.2f}x  "
              f"lift@25 {np.nanmean(table['lift@25']):5.2f}x")
    table = cross_validate(frame, DEPLOYABLE, C)
    auc, lo, hi = bootstrap_ci(table["auc"].to_numpy())
    print(f"  {f'{len(DEPLOYABLE)} deployable, non-negative':<34} AUC {auc:.3f} "
          f"[{lo:.3f},{hi:.3f}]  lift@10 {np.nanmean(table['lift@10']):5.2f}x  "
          f"lift@25 {np.nanmean(table['lift@25']):5.2f}x   <- shipped")

    coef = fit_nonneg(Xall * sign, y, C)
    # A weight that rounds to nothing is a feature the model declined to use;
    # keeping it would only add a moving part with no effect on the ordering.
    keep = coef > 1e-3
    chosen = [n for n, k in zip(DEPLOYABLE, keep, strict=True) if k]
    weights = {
        name: round(float(w * s), 5)
        for name, w, s, k in zip(DEPLOYABLE, coef, sign, keep, strict=True) if k
    }

    print(f"\n=== exported weights ({len(chosen)} of {len(DEPLOYABLE)} used) ===")
    for name, weight in sorted(weights.items(), key=lambda kv: -abs(kv[1])):
        direction = "higher is better" if weight > 0 else "lower is better"
        print(f"  {name:<22} {abs(weight):6.3f}  {direction:<17} "
              f"{'#' * int(round(abs(weight) * 12))}")
    dropped = [n for n, k in zip(DEPLOYABLE, keep, strict=True) if not k]
    if dropped:
        print(f"  unused: {', '.join(dropped)}")

    X = frame[chosen].to_numpy(float)

    # Calibration: percentile of the score inside its cohort -> probability the
    # paper turns out to matter. Fitted out-of-fold, so it describes held-out
    # behaviour rather than the training fit.
    oof = np.full(len(frame), np.nan)
    for month in np.unique(months):
        train, test = months != month, months == month
        if y[train].sum() < 5:
            continue
        Xtr = cohort_rank_transform(X[train], months[train])
        fold_sign = orientations(Xtr, y[train])
        fold = fit_nonneg(Xtr * fold_sign, y[train], C)
        oof[test] = (cohort_rank_transform(X[test], months[test]) * fold_sign) @ fold
    valid = ~np.isnan(oof)
    percentile = pd.Series(oof[valid]).groupby(months[valid]).rank(pct=True).to_numpy()
    iso = IsotonicRegression(out_of_bounds="clip", y_min=0.0, y_max=1.0)
    iso.fit(percentile, y[valid])
    grid = np.linspace(0, 1, 41)
    calibration = [[round(float(x), 4), round(float(v), 6)]
                   for x, v in zip(grid, iso.predict(grid), strict=True)]

    print("\n=== calibration ===")
    for x in (0.5, 0.9, 0.99, 1.0):
        print(f"  percentile {x:>5.2f} -> P(becomes a reference) "
              f"{float(iso.predict([x])[0]):.4f}")

    final = cross_validate(frame, chosen, C)
    auc, lo, hi = bootstrap_ci(final["auc"].to_numpy())
    payload = {
        "version": 1,
        "note": "Fitted by research/ranking/export_model.py. Do not hand-edit.",
        "trainedOn": {
            "corpus": "41k arXiv metadata sample, cs.LG / cs.CL / stat.ML listings",
            "papers": int(len(frame)),
            "positives": int(y.sum()),
            "months": int(frame["t"].nunique()),
            "window": "2017-05 to 2018-03",
        },
        "validation": {
            "protocol": "leave-one-month-out",
            "auc": round(auc, 4),
            "aucLow": round(lo, 4),
            "aucHigh": round(hi, 4),
            "liftAt10": round(float(np.nanmean(final["lift@10"])), 3),
            "liftAt25": round(float(np.nanmean(final["lift@25"])), 3),
        },
        "inputs": "features rank-transformed to percentiles within the cohort",
        "regularisation": {"penalty": "l2", "C": C},
        "weights": weights,
        "calibration": calibration,
        "baseRate": round(float(y.mean()), 6),
    }
    body = json.dumps(payload, indent=2)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        "// Generated by research/ranking/export_model.py — do not edit by hand.\n"
        "//\n"
        "// Weights apply to features rank-transformed to percentiles within the\n"
        "// cohort. They were fitted with non-negative coefficients on pre-oriented\n"
        "// signals, so no two can cancel and every paper's score decomposes into\n"
        "// readable contributions. Regenerate after changing the feature set:\n"
        "//\n"
        "//   python research/ranking/export_model.py\n"
        "\n"
        'import type { Signals } from "./signals.ts";\n'
        "\n"
        "export type RankingModel = {\n"
        "  version: number;\n"
        "  note: string;\n"
        "  trainedOn: {\n"
        "    corpus: string;\n"
        "    papers: number;\n"
        "    positives: number;\n"
        "    months: number;\n"
        "    window: string;\n"
        "  };\n"
        "  validation: {\n"
        "    protocol: string;\n"
        "    auc: number;\n"
        "    aucLow: number;\n"
        "    aucHigh: number;\n"
        "    liftAt10: number;\n"
        "    liftAt25: number;\n"
        "  };\n"
        "  inputs: string;\n"
        "  regularisation: { penalty: string; C: number };\n"
        "  weights: Partial<Record<keyof Signals, number>>;\n"
        "  /** [percentile, share of papers at that percentile that became references] */\n"
        "  calibration: readonly (readonly [number, number])[];\n"
        "  baseRate: number;\n"
        "};\n"
        "\n"
        f"export const RANKING_MODEL = {body} as const satisfies RankingModel;\n",
    )
    print(f"\nwrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
