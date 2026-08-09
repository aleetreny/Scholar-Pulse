"""Experiment suite on hep-th: 27,770 real arXiv papers, 352k real citations.

Protocol throughout: rolling-origin temporal validation. For a test month T the
model may only be trained on cohorts whose labels were already complete at T,
i.e. months m with m + horizon <= T. That is the constraint a real deployment
lives under — you cannot train on outcomes you have not observed — and it is far
stricter than a random split, which would happily let 2001 teach the model how
to rank 1998.

  E1  cold start: rank a month's submissions on day zero
  E2  the value of waiting: how much a 1/3/6/12-month observation window buys
  E3  the real product view: ranking a rolling window of mixed-age papers
  E4  tier ablation: what each class of data source is actually worth
  E5  horizon robustness: 12 / 24 / 36-month definitions of impact
  E6  stability: fold-by-fold, is the result an average or a fluke?

Run:  python research/ranking/run_hepth.py
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import numpy as np
import pandas as pd
from hepth_features import (
    FEATURES,
    TIER1_REFS,
    TIER2_GRAPH,
    evaluable_months,
    labels,
    load_corpus,
)
from metrics import bootstrap_ci, paired_test, score_cohort
from models import (
    GBRanker,
    PairwiseLTR,
    PoissonRanker,
    RandomRanker,
    RankFusion,
    RidgeRanker,
    SingleFeature,
    cohort_percentile,
)

DATA = Path(os.environ.get("RESEARCH_DATA", "/workspace/rankdata"))
RESULTS = DATA / "results"


def make_folds(months: np.ndarray, horizon: int, n_folds: int = 5, min_train: int = 12):
    """Contiguous test blocks, each trained only on fully-observed earlier months."""
    start, end = int(months.min()), int(months.max()) + 1
    first_test = start + min_train + horizon
    edges = np.linspace(min(first_test, end - 1), end, n_folds + 1).astype(int)
    folds = []
    for lo, hi in zip(edges[:-1], edges[1:], strict=False):
        train = np.arange(start, lo - horizon)
        test = np.arange(lo, hi)
        if hi > lo and train.size >= min_train:
            folds.append((train, test))
    return folds


def evaluate(ranker, frame, X, y, folds):
    """Per-cohort metrics for one ranker under the rolling-origin protocol."""
    months = frame["t"].to_numpy()
    records = []
    for train_months, test_months in folds:
        tr, te = np.isin(months, train_months), np.isin(months, test_months)
        if tr.sum() < 200 or te.sum() == 0:
            continue
        ranker.fit(X[tr], cohort_percentile(y[tr], months[tr]), months[tr])
        scores = ranker.score(X[te], months[te])
        for cohort in np.unique(months[te]):
            mask = months[te] == cohort
            records.append({"t": int(cohort), **score_cohort(scores[mask], y[te][mask]).__dict__})
    return pd.DataFrame(records)


def summarise(name: str, table: pd.DataFrame) -> dict:
    out = {"ranker": name, "cohorts": len(table)}
    for metric in ["ndcg10", "p_at_10", "lift10", "spearman", "top1_in_10"]:
        mean, lo, hi = bootstrap_ci(table[metric].to_numpy())
        out[metric], out[f"{metric}_lo"], out[f"{metric}_hi"] = mean, lo, hi
    return out


def show(title: str, summary: pd.DataFrame, columns: list[str] | None = None) -> None:
    columns = columns or ["ranker", "ndcg10", "ndcg10_lo", "ndcg10_hi", "p_at_10",
                          "lift10", "spearman", "top1_in_10", "cohorts"]
    print(f"\n=== {title} ===")
    print(summary[columns].to_string(index=False, float_format=lambda v: f"{v:7.3f}"))


def learned_models() -> list:
    return [RidgeRanker(), PoissonRanker(), GBRanker(), PairwiseLTR()]


# ---------------------------------------------------------------- E1 + E4 + E6

def experiment_cold_start(corpus, horizon: int = 24) -> tuple[pd.DataFrame, dict]:
    months = evaluable_months(corpus, horizon=horizon)
    frame = pd.read_parquet(DATA / "hepth_features_w0.parquet")
    frame = frame[frame["t"].isin(months)].reset_index(drop=True)
    y = labels(corpus, horizon)[frame["paper"].to_numpy()]
    folds = make_folds(months, horizon)

    print(f"\nE1  cold start | horizon={horizon}mo  papers={len(frame):,}  "
          f"cohorts={frame['t'].nunique()}")
    print(f"    label: mean={y.mean():.1f} median={np.median(y):.0f} "
          f"p90={np.quantile(y, .9):.0f} max={y.max():.0f} zero={np.mean(y == 0):.1%}")
    print("    folds: " + ", ".join(
        f"[{tr.min()}-{tr.max()}]->[{te.min()}-{te.max()}]" for tr, te in folds))

    X = frame[FEATURES].to_numpy(float)
    tables = {}
    rows = []
    for ranker in [RandomRanker(), *[SingleFeature(i, n) for i, n in enumerate(FEATURES)],
                   *learned_models()]:
        table = evaluate(ranker, frame, X, y, folds)
        if not table.empty:
            tables[ranker.name] = table
            rows.append(summarise(ranker.name, table))
    fusion = RankFusion(learned_models(), name="fusion(all-4)")
    tables[fusion.name] = evaluate(fusion, frame, X, y, folds)
    rows.append(summarise(fusion.name, tables[fusion.name]))

    summary = pd.DataFrame(rows).sort_values("ndcg10", ascending=False)
    show(f"E1 cold-start ranking quality, {horizon}-month impact", summary)

    print("\n    paired bootstrap vs random (same cohorts, difference resampled):")
    for name in summary["ranker"].head(6):
        stat = paired_test(tables[name]["ndcg10"].to_numpy(), tables["random"]["ndcg10"].to_numpy())
        print(f"      {name:<26} dNDCG@10 {stat['delta']:+.3f} "
              f"[{stat['lo']:+.3f},{stat['hi']:+.3f}]  P(better)={stat['p_better']:.3f}")

    # E4 — how much of that comes from each tier of data source.
    tiers = {
        "T1 reference list only": TIER1_REFS,
        "T2 + citation graph": TIER1_REFS + TIER2_GRAPH,
        "T2 graph signals alone": TIER2_GRAPH,
    }
    tier_rows = []
    for label_, columns in tiers.items():
        Xt = frame[columns].to_numpy(float)
        table = evaluate(GBRanker(), frame, Xt, y, folds)
        tier_rows.append(summarise(f"{label_} ({len(columns)}f)", table))
    show("E4 tier ablation (gradient boosting, same folds)", pd.DataFrame(tier_rows))

    # E6 — is the headline an average of consistent folds or one lucky block?
    best = summary["ranker"].iloc[0]
    per_fold = tables[best].assign(
        fold=pd.cut(tables[best]["t"], bins=[f[1].min() - 1 for f in folds] + [10**6],
                    labels=[f"fold{i + 1}" for i in range(len(folds))])
    )
    print(f"\n=== E6 stability of {best} across folds ===")
    print(per_fold.groupby("fold", observed=True)[["ndcg10", "lift10", "p_at_10"]]
          .agg(["mean", "count"]).to_string(float_format=lambda v: f"{v:6.3f}"))

    return summary, tables


# ------------------------------------------------------------------------- E2

def experiment_window(corpus, horizon: int = 24) -> pd.DataFrame:
    """How much does waiting buy? Reported two ways, because they answer different questions."""
    months = evaluable_months(corpus, horizon=horizon)
    folds = make_folds(months, horizon)
    rows = []
    for window in [0, 1, 3, 6, 12]:
        frame = pd.read_parquet(DATA / f"hepth_features_w{window}.parquet")
        frame = frame[frame["t"].isin(months)].reset_index(drop=True)
        X = frame[FEATURES].to_numpy(float)
        papers = frame["paper"].to_numpy()
        for framing, y in [
            ("total impact by T+h", labels(corpus, horizon)[papers]),
            ("future only, after T+w", labels(corpus, horizon, window=window)[papers]),
        ]:
            table = evaluate(GBRanker(), frame, X, y, folds)
            summary = summarise(f"w={window:>2}mo | {framing}", table)
            summary["window"], summary["framing"] = window, framing
            rows.append(summary)
    summary = pd.DataFrame(rows)
    show(f"E2 value of an observation window ({horizon}-month impact)",
         summary.sort_values(["framing", "window"]),
         ["ranker", "ndcg10", "ndcg10_lo", "ndcg10_hi", "p_at_10", "lift10", "spearman"])
    return summary


# ------------------------------------------------------------------------- E3

def experiment_mixed_age(corpus, horizon: int = 24, width: int = 3) -> pd.DataFrame:
    """The view the product actually renders: one board, several ages at once.

    A "top recent papers" board covers a rolling window, so the papers on it are
    not the same age. Ranking that board by raw citations is a systematic bias in
    favour of whatever happens to be oldest. The fix is to divide by how many
    citations a paper of that age should have by now — the accumulation curve —
    and rank by the residual. This measures how large the bias is and how much
    of it the correction recovers.
    """
    months = evaluable_months(corpus, horizon=horizon, warmup=36)
    truth_all = labels(corpus, horizon)

    def accrued(papers: np.ndarray, at: np.ndarray) -> np.ndarray:
        """Citations each paper had collected between submission and month `at`."""
        end = np.minimum(at, corpus.n_months - 1)
        start = np.maximum(corpus.t[papers] - 1, 0)
        return (
            corpus.cites_upto[end, papers] - corpus.cites_upto[start, papers]
        ).astype(float)

    per_board = []
    for obs in months:
        candidates = np.where((corpus.t <= obs) & (corpus.t > obs - width))[0]
        if candidates.size < 30:
            continue
        age = (obs - corpus.t[candidates]).astype(int)
        seen = accrued(candidates, np.full(candidates.size, obs))

        # The accumulation curve: mean citations a paper has by age a. Fitted
        # only on papers already complete at obs, so the correction a live system
        # would apply is exactly the one measured here.
        history = np.where(corpus.t <= obs - width - horizon)[0]
        if history.size == 0:
            # A window wide enough to swallow the warm-up leaves no completed
            # papers to fit the curve on. Fall back to no correction rather
            # than dividing by a mean of nothing.
            curve = dict.fromkeys(np.unique(age), 1.0)
        else:
            curve = {
                a: max(float(accrued(history, corpus.t[history] + a).mean()), 1e-6)
                for a in np.unique(age)
            }
        expected = np.array([curve[a] for a in age])
        truth = truth_all[candidates]

        per_board.append(
            {
                "raw": score_cohort(seen, truth).__dict__,
                "normalised": score_cohort(seen / expected, truth).__dict__,
                "age_only": score_cohort(age.astype(float), truth).__dict__,
                "newest_first": score_cohort(-age.astype(float), truth).__dict__,
            }
        )

    rows = [
        summarise(label_, pd.DataFrame([board[key] for board in per_board]))
        for key, label_ in [
            ("normalised", "citations / expected-at-age (fitness)"),
            ("raw", "raw citations so far"),
            ("age_only", "oldest first (bias probe)"),
            ("newest_first", "newest first (today's product)"),
        ]
    ]
    summary = pd.DataFrame(rows)
    show(f"E3 mixed-age board, {width}-month rolling window", summary)
    return summary


# ------------------------------------------------------------------------- E5

def experiment_horizons(corpus) -> pd.DataFrame:
    rows = []
    for horizon in [12, 24, 36]:
        months = evaluable_months(corpus, horizon=horizon)
        frame = pd.read_parquet(DATA / "hepth_features_w0.parquet")
        frame = frame[frame["t"].isin(months)].reset_index(drop=True)
        y = labels(corpus, horizon)[frame["paper"].to_numpy()]
        X = frame[FEATURES].to_numpy(float)
        folds = make_folds(months, horizon)
        for ranker in [RandomRanker(), GBRanker(), PairwiseLTR()]:
            table = evaluate(ranker, frame, X, y, folds)
            summary = summarise(f"h={horizon}mo | {ranker.name}", table)
            summary["horizon"] = horizon
            rows.append(summary)
    summary = pd.DataFrame(rows)
    show("E5 robustness to the definition of impact", summary)
    return summary


# ------------------------------------------------------------------------- E7

def experiment_selection(corpus, horizon: int = 24) -> pd.DataFrame:
    """Greedy forward selection, then confirmation on a period selection never saw.

    Adding features monotonically improved nothing in E4 — the full set scored
    *worse* than the reference-list subset — so the question is which handful of
    signals actually carries the result. Selection runs on the early folds only;
    the last two folds are locked away and used once, at the end, so the reported
    number is not the maximum of a search.
    """
    months = evaluable_months(corpus, horizon=horizon)
    frame = pd.read_parquet(DATA / "hepth_features_w0.parquet")
    frame = frame[frame["t"].isin(months)].reset_index(drop=True)
    y = labels(corpus, horizon)[frame["paper"].to_numpy()]
    folds = make_folds(months, horizon)
    search_folds, holdout_folds = folds[:3], folds[3:]

    def quality(columns: list[str], use_folds) -> float:
        X = frame[columns].to_numpy(float)
        table = evaluate(GBRanker(), frame, X, y, use_folds)
        return float(np.nanmean(table["ndcg10"])) if not table.empty else np.nan

    chosen: list[str] = []
    remaining = list(FEATURES)
    trace = []
    best_so_far = -np.inf
    while remaining:
        scored = [(quality(chosen + [c], search_folds), c) for c in remaining]
        score, winner = max(scored)
        if score <= best_so_far + 1e-4:
            break
        best_so_far = score
        chosen.append(winner)
        remaining.remove(winner)
        trace.append({"step": len(chosen), "added": winner, "search_ndcg10": score})
        if len(chosen) >= 8:
            break

    print("\n=== E7 greedy forward selection (search folds only) ===")
    for step in trace:
        print(f"    {step['step']}. +{step['added']:<24} NDCG@10 {step['search_ndcg10']:.3f}")

    rows = []
    for label_, columns in [
        (f"selected ({len(chosen)}f)", chosen),
        (f"all features ({len(FEATURES)}f)", FEATURES),
        (f"reference list only ({len(TIER1_REFS)}f)", TIER1_REFS),
        ("n_refs alone (1f)", ["n_refs"]),
    ]:
        X = frame[columns].to_numpy(float)
        rows.append(summarise(label_, evaluate(GBRanker(), frame, X, y, holdout_folds)))
    summary = pd.DataFrame(rows)
    show("E7 confirmation on held-out later period (never used for selection)", summary)
    print(f"    selected palette: {chosen}")
    return summary.assign(selected=", ".join(chosen))


def main() -> None:
    RESULTS.mkdir(parents=True, exist_ok=True)
    corpus = load_corpus()
    print(f"corpus: {corpus.n:,} papers | {corpus.n_months} months | "
          f"{corpus.pair_keys.size / 1e6:.1f}M co-citation events")

    summary, _ = experiment_cold_start(corpus)
    summary.to_csv(RESULTS / "e1_cold_start.csv", index=False)
    experiment_window(corpus).to_csv(RESULTS / "e2_window.csv", index=False)
    pd.concat(
        [experiment_mixed_age(corpus, width=w).assign(width=w) for w in [1, 3, 6, 12, 24]]
    ).to_csv(RESULTS / "e3_mixed_age.csv", index=False)
    experiment_horizons(corpus).to_csv(RESULTS / "e5_horizons.csv", index=False)
    experiment_selection(corpus).to_csv(RESULTS / "e7_selection.csv", index=False)
    print(json.dumps({"written": sorted(p.name for p in RESULTS.glob("*.csv"))}))


if __name__ == "__main__":
    main()
