"""The candidate rankers, from one-line heuristics to learning-to-rank.

Every ranker exposes the same two methods so the evaluation harness can treat
them identically, and so that "a constant" and "a gradient-boosted ensemble"
are held to exactly the same standard.

Two design choices apply to all the learned models:

* The target is the paper's **percentile inside its own cohort**, not its raw
  citation count. Citation volume drifts with the size of the field and the age
  of the archive; a model trained on raw counts spends most of its capacity
  learning the calendar. Percentiles delete the trend and leave the only
  question that matters: among the papers posted the same month, which ones
  stand out?
* Features are rank-transformed per cohort before the linear models see them.
  Bibliometric features are heavy-tailed enough that a single review article
  with 562 references would otherwise dominate the fit.
"""

from __future__ import annotations

import numpy as np
from scipy.stats import rankdata, spearmanr
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.linear_model import LogisticRegression, PoissonRegressor, Ridge


def cohort_percentile(values: np.ndarray, cohorts: np.ndarray) -> np.ndarray:
    """Rank inside each cohort, mapped to (0, 1)."""
    out = np.empty(values.size)
    for cohort in np.unique(cohorts):
        mask = cohorts == cohort
        out[mask] = rankdata(values[mask]) / (mask.sum() + 1)
    return out


def cohort_rank_transform(matrix: np.ndarray, cohorts: np.ndarray) -> np.ndarray:
    out = np.empty_like(matrix, dtype=float)
    for cohort in np.unique(cohorts):
        mask = cohorts == cohort
        block = matrix[mask]
        out[mask] = np.apply_along_axis(rankdata, 0, block) / (mask.sum() + 1)
    return out


class Ranker:
    name = "base"

    def fit(self, X, y, cohorts):  # noqa: N803
        return self

    def score(self, X, cohorts):  # noqa: N803
        raise NotImplementedError


class RandomRanker(Ranker):
    """The floor. Any ranker that cannot beat this is decoration."""

    name = "random"

    def __init__(self, seed: int = 0):
        self.rng = np.random.default_rng(seed)

    def score(self, X, cohorts):  # noqa: N803
        return self.rng.random(X.shape[0])


class SingleFeature(Ranker):
    """One column, used alone. The ablation that shows what each signal is worth.

    The orientation is *learned* from the training folds rather than assumed.
    Guessing signs by intuition is how a genuinely strong signal gets written off:
    reference age looks like noise if you rank oldest-first, and turns into one
    of the best predictors in the corpus the moment you flip it.
    """

    def __init__(self, column: int, name: str):
        self.column, self.name, self.sign = column, f"feat:{name}", 1.0

    def fit(self, X, y, cohorts):  # noqa: N803
        column = X[:, self.column]
        if np.std(column) > 0:
            rho = spearmanr(column, y).statistic
            self.sign = -1.0 if (rho is not None and rho < 0) else 1.0
        return self

    def score(self, X, cohorts):  # noqa: N803
        return self.sign * X[:, self.column]


class RidgeRanker(Ranker):
    name = "ridge"

    def __init__(self, alpha: float = 1.0):
        self.model = Ridge(alpha=alpha)

    def fit(self, X, y, cohorts):  # noqa: N803
        self.model.fit(cohort_rank_transform(X, cohorts), y)
        return self

    def score(self, X, cohorts):  # noqa: N803
        return self.model.predict(cohort_rank_transform(X, cohorts))


class PoissonRanker(Ranker):
    """Counts are counts: a log-link Poisson GLM on the raw citation total.

    Included as the "textbook correct" model for count data, to check whether
    the percentile reframing actually buys anything over modelling the counts
    the way a statistician would out of the box.
    """

    name = "poisson"

    def __init__(self, alpha: float = 1e-3):
        self.model = PoissonRegressor(alpha=alpha, max_iter=500)

    def fit(self, X, y, cohorts):  # noqa: N803
        self.model.fit(cohort_rank_transform(X, cohorts), y)
        return self

    def score(self, X, cohorts):  # noqa: N803
        return self.model.predict(cohort_rank_transform(X, cohorts))


class GBRanker(Ranker):
    name = "gbm"

    def __init__(self, seed: int = 0, **kwargs):
        params = dict(
            max_depth=3,
            learning_rate=0.06,
            max_iter=300,
            min_samples_leaf=40,
            l2_regularization=1.0,
            early_stopping=False,
            random_state=seed,
        )
        params.update(kwargs)
        self.model = HistGradientBoostingRegressor(**params)

    def fit(self, X, y, cohorts):  # noqa: N803
        self.model.fit(X, y)
        return self

    def score(self, X, cohorts):  # noqa: N803
        return self.model.predict(X)


class PairwiseLTR(Ranker):
    """RankNet with a linear scorer, fitted in closed form as logistic regression.

    Sample pairs of papers from the same cohort; the model only ever sees the
    difference x_i - x_j and has to say which one ends up more cited. Because
    the scorer is linear, P(i beats j) = sigma(w . (x_i - x_j)), which is exactly
    logistic regression on differences with no intercept. So the pairwise
    ranking objective everyone associates with LambdaMART is available here in
    a convex, twenty-line, fully reproducible form.

    Pairs are weighted by how far apart the two papers are in the outcome, which
    is the cheap stand-in for LambdaRank's NDCG-derived gradients: getting the
    runaway hit above an also-ran matters more than sorting two nobodies.
    """

    name = "pairwise-ltr"

    def __init__(self, pairs_per_cohort: int = 3000, seed: int = 0, C: float = 1.0):
        self.pairs_per_cohort, self.seed, self.C = pairs_per_cohort, seed, C
        self.model = LogisticRegression(C=C, fit_intercept=False, max_iter=2000)

    def fit(self, X, y, cohorts):  # noqa: N803
        Xr = cohort_rank_transform(X, cohorts)
        rng = np.random.default_rng(self.seed)
        diffs, targets, weights = [], [], []
        for cohort in np.unique(cohorts):
            idx = np.where(cohorts == cohort)[0]
            if idx.size < 4:
                continue
            a = rng.choice(idx, self.pairs_per_cohort)
            b = rng.choice(idx, self.pairs_per_cohort)
            keep = y[a] != y[b]
            a, b = a[keep], b[keep]
            if a.size == 0:
                continue
            sign = np.where(y[a] > y[b], 1.0, 0.0)
            diffs.append(Xr[a] - Xr[b])
            targets.append(sign)
            weights.append(np.abs(y[a] - y[b]))
        self.model.fit(np.vstack(diffs), np.concatenate(targets),
                       sample_weight=np.concatenate(weights))
        return self

    def score(self, X, cohorts):  # noqa: N803
        return cohort_rank_transform(X, cohorts) @ self.model.coef_.ravel()


class RankFusion(Ranker):
    """Reciprocal rank fusion over several rankers.

    RRF scores an item as sum 1/(k + rank_m) across models m. It ignores each
    model's raw scale, which is precisely what you want when combining a
    PageRank, a z-score and a count: no calibration step, no scale to tune, and
    a single outlier in one component cannot hijack the consensus.
    """

    name = "fusion"

    def __init__(self, members: list[Ranker], k: int = 20, name: str = "fusion"):
        self.members, self.k, self.name = members, k, name

    def fit(self, X, y, cohorts):  # noqa: N803
        for member in self.members:
            member.fit(X, y, cohorts)
        return self

    def score(self, X, cohorts):  # noqa: N803
        total = np.zeros(X.shape[0])
        for member in self.members:
            scores = member.score(X, cohorts)
            for cohort in np.unique(cohorts):
                mask = cohorts == cohort
                ranks = rankdata(-scores[mask], method="average")
                total[mask] += 1.0 / (self.k + ranks)
        return total
