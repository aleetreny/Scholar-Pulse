"""Causal feature extraction on the hep-th citation graph.

The single rule that governs this file: when scoring a paper at observation time
O, nothing that happened after month O may enter the calculation. A citation
comes into existence when the *citing* paper is submitted, so the graph visible
at O is exactly the set of edges whose source month is <= O, and a paper posted
in month T is scored with the graph as it stood then, not as it stands now.

Violating that rule is the classic way to produce a spectacular-looking impact
predictor that collapses in production, so every feature below is derived from a
time-sliced view and the slicing is done once, centrally.

`window` is the product knob: 0 means "rank it the day it appears", 3 means
"wait a quarter and rank it with whatever early reception exists". Everything
else is held constant so the two are directly comparable.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd
from scipy import sparse

DATA = Path(os.environ.get("RESEARCH_DATA", "/workspace/rankdata"))


@dataclass
class Corpus:
    """The hep-th world, indexed for time-sliced queries."""

    n: int
    t: np.ndarray               # submission month of every paper
    n_months: int
    refs_indptr: np.ndarray     # CSR-style reference lists (paper -> cited papers)
    refs_indices: np.ndarray
    cites_upto: np.ndarray      # [month, paper] citations received by end of month
    pair_keys: np.ndarray       # co-citation events, sorted by (pair, month)
    pair_months: np.ndarray
    ref_slots_upto: np.ndarray  # [month] total reference slots spent so far
    pair_slots_upto: np.ndarray # [month] sum of k(k-1) over papers so far
    ids: np.ndarray


def load_corpus() -> Corpus:
    papers = (
        pd.read_parquet(DATA / "hepth_papers.parquet")
        .sort_values("paper")
        .reset_index(drop=True)
    )
    edges = pd.read_parquet(DATA / "hepth_edges.parquet")

    ids = papers["paper"].to_numpy()
    index = pd.Series(np.arange(len(ids)), index=ids)
    src = index.reindex(edges["src"]).to_numpy()
    dst = index.reindex(edges["dst"]).to_numpy()
    t = papers["t"].to_numpy().astype(np.int32)
    n = len(ids)
    n_months = int(t.max()) + 1

    order = np.argsort(src, kind="stable")
    refs_indices = dst[order].astype(np.int32)
    counts = np.bincount(src, minlength=n)
    refs_indptr = np.concatenate([[0], np.cumsum(counts)]).astype(np.int64)

    # cites_upto[m, j]: citations j had received from papers submitted in month
    # m or earlier. A prefix sum turns every "state of the world at time O"
    # query into an array lookup.
    per_month = np.zeros((n_months, n), dtype=np.int32)
    np.add.at(per_month, (t[src], dst), 1)
    cites_upto = np.cumsum(per_month, axis=0)

    # Co-citation events: every unordered pair of references inside one paper,
    # stamped with that paper's month. Sorting by (pair, month) makes "how often
    # were i and j cited together before O" a double binary search.
    keys: list[np.ndarray] = []
    months: list[np.ndarray] = []
    for p in range(n):
        lo, hi = refs_indptr[p], refs_indptr[p + 1]
        if hi - lo < 2:
            continue
        r = np.unique(refs_indices[lo:hi]).astype(np.int64)
        a, b = np.triu_indices(r.size, k=1)
        keys.append(r[a] * n + r[b])
        months.append(np.full(a.size, t[p], dtype=np.int32))
    pair_keys = np.concatenate(keys)
    pair_months = np.concatenate(months)
    order_pairs = np.lexsort((pair_months, pair_keys))

    k = (refs_indptr[1:] - refs_indptr[:-1]).astype(np.float64)

    return Corpus(
        n=n,
        t=t,
        n_months=n_months,
        refs_indptr=refs_indptr,
        refs_indices=refs_indices,
        cites_upto=cites_upto,
        pair_keys=pair_keys[order_pairs],
        pair_months=pair_months[order_pairs],
        ref_slots_upto=np.cumsum(np.bincount(t, weights=k, minlength=n_months)),
        pair_slots_upto=np.cumsum(np.bincount(t, weights=k * (k - 1), minlength=n_months)),
        ids=ids,
    )


def citations_at(corpus: Corpus, month: int) -> np.ndarray:
    """Citation counts known at the end of `month` (clamped at the edges)."""
    if month < 0:
        return np.zeros(corpus.n, dtype=np.int32)
    return corpus.cites_upto[min(month, corpus.n_months - 1)]


def labels(corpus: Corpus, horizon: int, window: int = 0) -> np.ndarray:
    """Citations received between the observation point and submission+horizon.

    With window=0 this is the full first-`horizon` months of a paper's life —
    the product question, "will this matter within two years?". With window>0 it
    is only the part still in the future at scoring time, which isolates genuine
    prediction from mere observation.
    """
    start = np.minimum(corpus.t + window, corpus.n_months - 1)
    end = np.minimum(corpus.t + horizon, corpus.n_months - 1)
    rows = np.arange(corpus.n)
    return (corpus.cites_upto[end, rows] - corpus.cites_upto[start, rows]).astype(np.float64)


def evaluable_months(corpus: Corpus, horizon: int, warmup: int = 24) -> np.ndarray:
    """Months whose labels are complete and whose features have graph history.

    Papers from the last `horizon` months are right-censored: they have not had
    time to be cited yet, and scoring a ranker on them measures the calendar
    rather than the ranker. The warm-up cuts the opposite end, where the graph
    is too young to have any history to look at.
    """
    return np.arange(warmup, corpus.n_months - horizon)


def _pagerank(adj: sparse.csr_matrix, damping: float = 0.85, iters: int = 40) -> np.ndarray:
    """PageRank over the "is cited by" direction, so mass flows to seminal work."""
    n = adj.shape[0]
    out = np.asarray(adj.sum(axis=1)).ravel()
    inv = np.divide(1.0, out, out=np.zeros(n), where=out > 0)
    transition = sparse.diags(inv) @ adj
    rank = np.full(n, 1.0 / n)
    dangling = out == 0
    for _ in range(iters):
        nxt = damping * (transition.T @ rank + rank[dangling].sum() / n) + (1 - damping) / n
        if np.abs(nxt - rank).sum() < 1e-10:
            return nxt
        rank = nxt
    return rank


def _cocitation_counts(corpus: Corpus, pairs: np.ndarray, month: int) -> np.ndarray:
    """How often each reference pair had already been co-cited before `month`."""
    if pairs.size == 0:
        return np.zeros(0)
    lo = np.searchsorted(corpus.pair_keys, pairs, side="left")
    hi = np.searchsorted(corpus.pair_keys, pairs, side="right")
    out = np.empty(pairs.size)
    for idx in range(pairs.size):
        a, b = lo[idx], hi[idx]
        out[idx] = 0.0 if a == b else np.searchsorted(corpus.pair_months[a:b], month, "left")
    return out


def _novelty_scores(
    corpus: Corpus, refs: np.ndarray, month: int, degrees: np.ndarray, max_refs: int = 40
) -> tuple[float, float, float]:
    """Atypical-combination scores in the spirit of Uzzi et al. (Science, 2013).

    A reference list is a set of pairings of prior ideas. Most pairings are
    conventional; the published finding is that unusually high-impact papers are
    overwhelmingly conventional *with a tail of genuinely novel pairings* — one
    foot in the mainstream, one somewhere nobody has looked.

    Uzzi measured "unusual" against Monte-Carlo rewired networks, far too slow to
    run per paper per month. This uses the analytic configuration-model null
    instead: if papers spent reference slots independently in proportion to how
    cited each work already is, a pair (i, j) would be co-cited

        E[n_ij] = S(O) * d_i * d_j / M(O)^2,

    with M(O) the total reference slots spent by month O, S(O) = sum_p k_p(k_p-1),
    and d the citation counts at O. Counts that small are Poisson, so Var ~ E and
    z = (observed - E) / sqrt(E). Same quantity as the rewiring experiment, in
    closed form, at roughly a millionth of the cost.
    """
    unique = np.unique(refs)
    if unique.size < 2:
        return 0.0, 0.0, 0.0
    if unique.size > max_refs:
        # Deterministic thinning bounds the cost for review articles without
        # biasing which part of the reference list gets inspected.
        step = unique.size / max_refs
        unique = unique[(np.arange(max_refs) * step).astype(int)]
    a, b = np.triu_indices(unique.size, k=1)
    i, j = unique[a].astype(np.int64), unique[b].astype(np.int64)
    keys = np.where(i < j, i * corpus.n + j, j * corpus.n + i)
    observed = _cocitation_counts(corpus, keys, month)

    slots = corpus.ref_slots_upto[max(month - 1, 0)]
    pair_slots = corpus.pair_slots_upto[max(month - 1, 0)]
    if slots <= 0:
        return 0.0, 0.0, 0.0
    expected = np.maximum(pair_slots * degrees[i] * degrees[j] / (slots**2), 1e-6)
    z = (observed - expected) / np.sqrt(expected)
    return float(np.median(z)), float(np.quantile(z, 0.10)), float((z <= 0).mean())


# Grouped by what a deployment would need in order to compute them. The tiers
# are the whole point of the production design: tier 1 needs nothing but the
# paper's own reference list, tier 2 needs a citation graph, tier 3 needs to
# have waited a while.
TIER1_REFS = [
    "n_refs",
    "ref_age_mean",
    "ref_age_min",
    "ref_age_std",
    "frac_refs_fresh6",
    "frac_refs_fresh12",
]
TIER2_GRAPH = [
    "ref_cit_sum",
    "ref_cit_mean",
    "ref_cit_max",
    "ref_vel_sum",
    "ref_vel_mean",
    "ref_vel_max",
    "ref_accel",
    "ref_burst",
    "ref_pr_sum",
    "ref_pr_mean",
    "ref_pr_max",
    "ref_hub_frac",
    "ref_elite_attention",
    "conventionality",
    "novelty_tail",
    "frac_pairs_typical",
]
TIER3_EARLY = ["own_cites", "own_cites_recent", "own_cite_share", "own_elite_cites"]
FEATURES = TIER1_REFS + TIER2_GRAPH + TIER3_EARLY


def build_features(corpus: Corpus, months: np.ndarray, window: int = 0) -> pd.DataFrame:
    """One row per paper submitted in one of `months`, frozen at month T+window."""
    src_all = np.repeat(
        np.arange(corpus.n), corpus.refs_indptr[1:] - corpus.refs_indptr[:-1]
    )
    edge_month = corpus.t[src_all]
    order = np.argsort(edge_month, kind="stable")
    src_sorted, dst_sorted = src_all[order], corpus.refs_indices[order]
    cut = np.searchsorted(edge_month[order], np.arange(corpus.n_months + 2), side="left")

    by_obs: dict[int, np.ndarray] = {}
    for month in months:
        obs = min(int(month) + window, corpus.n_months - 1)
        by_obs.setdefault(obs, []).append(month)
    targets = {obs: np.where(np.isin(corpus.t, ms))[0] for obs, ms in by_obs.items()}

    rows: list[dict] = []
    for obs in sorted(targets):
        # Graph as of the end of month obs-1 for the "prior world", plus the
        # papers' own reference lists which are public at submission.
        upto = cut[obs]
        adj = sparse.csr_matrix(
            (np.ones(upto, dtype=np.float32), (src_sorted[:upto], dst_sorted[:upto])),
            shape=(corpus.n, corpus.n),
        )
        pagerank = _pagerank(adj)

        degrees = citations_at(corpus, obs - 1).astype(np.float64)
        vel12 = degrees - citations_at(corpus, obs - 13).astype(np.float64)
        recent6 = degrees - citations_at(corpus, obs - 7).astype(np.float64)
        prior6 = (
            citations_at(corpus, obs - 7).astype(np.float64)
            - citations_at(corpus, obs - 13).astype(np.float64)
        )
        existing = corpus.t < obs
        hub_cut = np.quantile(degrees[existing], 0.99) if existing.any() else np.inf
        hub = degrees >= max(hub_cut, 1.0)
        # How much attention the field's most-cited papers are paying to a work:
        # one sparse product gives it for every node at once.
        elite_attention = np.asarray(adj[hub].sum(axis=0)).ravel()

        for paper in targets[obs]:
            submitted = int(corpus.t[paper])
            lo, hi = corpus.refs_indptr[paper], corpus.refs_indptr[paper + 1]
            refs = corpus.refs_indices[lo:hi]
            own = float(degrees[paper]) if window > 0 else 0.0
            own_recent = float(recent6[paper]) if window > 0 else 0.0
            row = {"paper": paper, "t": submitted, "obs": obs}
            row.update({name: 0.0 for name in FEATURES})
            row["own_cites"] = np.log1p(own)
            row["own_cites_recent"] = np.log1p(own_recent)
            row["own_elite_cites"] = np.log1p(float(elite_attention[paper])) if window > 0 else 0.0
            if refs.size:
                ages = (submitted - corpus.t[refs]).astype(np.float64)
                cits, velocity = degrees[refs], vel12[refs]
                conv, tail, typical = _novelty_scores(corpus, refs, obs, degrees)
                row.update(
                    {
                        "n_refs": float(refs.size),
                        "ref_age_mean": float(ages.mean()),
                        "ref_age_min": float(ages.min()),
                        "ref_age_std": float(ages.std()),
                        "frac_refs_fresh6": float((ages <= 6).mean()),
                        "frac_refs_fresh12": float((ages <= 12).mean()),
                        "ref_cit_sum": float(np.log1p(cits.sum())),
                        "ref_cit_mean": float(np.log1p(cits).mean()),
                        "ref_cit_max": float(np.log1p(cits.max())),
                        "ref_vel_sum": float(np.log1p(max(velocity.sum(), 0))),
                        "ref_vel_mean": float(np.log1p(np.maximum(velocity, 0)).mean()),
                        "ref_vel_max": float(np.log1p(max(velocity.max(), 0))),
                        "ref_accel": float(
                            np.log1p(max(recent6[refs].sum(), 0))
                            - np.log1p(max(prior6[refs].sum(), 0))
                        ),
                        "ref_burst": float(
                            np.max((recent6[refs] + 1) / (prior6[refs] + 1))
                        ),
                        "ref_pr_sum": float(np.log1p(pagerank[refs].sum() * corpus.n)),
                        "ref_pr_mean": float(np.log1p(pagerank[refs].mean() * corpus.n)),
                        "ref_pr_max": float(np.log1p(pagerank[refs].max() * corpus.n)),
                        "ref_hub_frac": float(hub[refs].mean()),
                        "ref_elite_attention": float(np.log1p(elite_attention[refs].mean())),
                        "conventionality": conv,
                        "novelty_tail": tail,
                        "frac_pairs_typical": typical,
                        # Share of the attention its own reference cluster is
                        # getting: a paper cited as often as the works it builds
                        # on is punching above its age.
                        "own_cite_share": float(
                            np.log1p(own) - np.log1p(np.median(cits))
                        ) if window > 0 else 0.0,
                    }
                )
            rows.append(row)

    frame = pd.DataFrame(rows).fillna(0.0)
    return frame[["paper", "t", "obs", *FEATURES]]


if __name__ == "__main__":
    import sys

    horizon = int(sys.argv[1]) if len(sys.argv) > 1 else 24
    corpus = load_corpus()
    months = evaluable_months(corpus, horizon=horizon)
    print(f"corpus: {corpus.n:,} papers, {corpus.n_months} months, "
          f"{corpus.pair_keys.size / 1e6:.1f}M co-citation events")
    for window in [0, 1, 3, 6, 12]:
        features = build_features(corpus, months, window=window)
        features.to_parquet(DATA / f"hepth_features_w{window}.parquet", index=False)
        print(f"window={window:>2}mo -> {features.shape[0]:,} rows x "
              f"{features.shape[1] - 3} features")
