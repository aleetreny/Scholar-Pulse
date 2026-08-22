"""Day-zero features from arXiv metadata alone: no citations, no external API.

Experiment 1 established that a paper's reference list predicts its future
impact. But a preprint's reference list is not in the arXiv feed: it appears
days or weeks later, once an indexer has parsed the PDF. Everything in this
module is computable from the Atom entry the moment it is published: title,
abstract, author list, categories and timestamp, which is exactly the payload
ScholarPulse already snapshots.

Causality is enforced the same way as in the citation lab: every corpus
statistic (who has published, which words are rising, what counts as a common
phrase) is recomputed from the papers strictly older than the month being
scored. Nothing is fitted on the full corpus and then applied backwards.
"""

from __future__ import annotations

import os
import re
from collections import defaultdict
from pathlib import Path

import numpy as np
import pandas as pd
from scipy import sparse
from sklearn.feature_extraction.text import TfidfVectorizer

DATA = Path(os.environ.get("RESEARCH_DATA", "/workspace/rankdata"))

STOPWORDS = set(
    """a an the of for and or to in on with by from at as is are be been we our this that
    these those it its using use used via towards toward through into over under new can
    which what when how why not no than then also more most other others such both each
    all any some between within without about after before during while but if than very
    single multi based approach method methods model models paper study show shows"""
    .split()
)

# Claim vocabulary: the language authors reach for when they think they have
# something. Each is a rough behavioural signal, not a truth claim.
CLAIM_TERMS = [
    "state-of-the-art", "state of the art", "outperform", "significantly",
    "first", "novel", "we propose", "we introduce", "we present", "surpass",
    "best", "efficient", "simple", "scalable", "large-scale", "real-time",
    "open-source", "we release", "benchmark", "dataset",
]
HEDGE_TERMS = ["may", "might", "could", "suggest", "preliminary", "potential", "appear"]

FEATURES = [
    # team and track record
    "team_size", "author_prior_max", "author_prior_mean", "author_new_frac",
    "author_degree_max", "author_pagerank_max", "author_recency", "author_reach",
    # packaging
    "n_categories", "cross_list", "title_words", "title_has_colon", "abstract_words",
    "abstract_sentences",
    # language
    "claim_score", "hedge_score", "has_numbers", "has_named_system",
    # topical position
    "term_burst_max", "term_burst_mean", "term_rarity", "pair_novelty",
    "distinctiveness", "centroid_similarity",
]


def tokenize(text: str) -> list[str]:
    words = re.findall(r"[a-z][a-z0-9\-]+", text.lower())
    return [w for w in words if w not in STOPWORDS and len(w) > 2]


class CausalCorpus:
    """The arXiv corpus, queryable as of any month without leaking the future."""

    def __init__(self, frame: pd.DataFrame):
        self.frame = frame.sort_values("t").reset_index(drop=True)
        self.t = self.frame["t"].to_numpy()
        self.titles = self.frame["title"].tolist()
        self.abstracts = self.frame["abstract"].tolist()
        self.authors = [list(a) for a in self.frame["authors"]]
        self.tokens = [tokenize(t) for t in self.titles]
        self.cut = np.searchsorted(self.t, np.arange(self.t.max() + 2), side="left")

    def before(self, month: int) -> slice:
        return slice(0, int(self.cut[month]))


def _author_state(corpus: CausalCorpus, month: int) -> dict:
    """Publication history and co-authorship structure as of `month`."""
    history: dict[str, list[int]] = defaultdict(list)
    edges: dict[tuple[str, str], int] = defaultdict(int)
    for idx in range(corpus.before(month).stop):
        names = corpus.authors[idx]
        for name in names:
            history[name].append(int(corpus.t[idx]))
        for i in range(len(names)):
            for j in range(i + 1, len(names)):
                a, b = sorted((names[i], names[j]))
                edges[(a, b)] += 1

    index = {name: i for i, name in enumerate(history)}
    n = len(index)
    if n == 0 or not edges:
        return {"history": history, "index": index, "degree": {}, "pagerank": {}}

    rows, cols, vals = [], [], []
    for (a, b), weight in edges.items():
        rows += [index[a], index[b]]
        cols += [index[b], index[a]]
        vals += [weight, weight]
    adj = sparse.csr_matrix((vals, (rows, cols)), shape=(n, n), dtype=np.float32)

    # Eigenvector-flavoured prestige on the collaboration graph: working with
    # well-connected people counts for more than working with many people.
    out = np.asarray(adj.sum(axis=1)).ravel()
    inv = np.divide(1.0, out, out=np.zeros(n), where=out > 0)
    transition = sparse.diags(inv) @ adj
    rank = np.full(n, 1.0 / n)
    for _ in range(30):
        rank = 0.85 * (transition.T @ rank) + 0.15 / n
    degree = np.asarray((adj > 0).sum(axis=1)).ravel()
    return {
        "history": history,
        "index": index,
        "degree": {name: float(degree[i]) for name, i in index.items()},
        "pagerank": {name: float(rank[i] * n) for name, i in index.items()},
    }


def _term_state(corpus: CausalCorpus, month: int, recent: int = 6, base: int = 24) -> dict:
    """Which words are rising, which are rare, and which pairs are unheard of.

    The burst score is a log rate ratio: how much more often a term appears in
    the last six months than in the year and a half before that, among papers
    the scorer could already have seen. A paper whose title sits on top of
    several rising terms is, empirically, on the wave rather than behind it.
    """
    stop = corpus.before(month).stop
    recent_lo = int(corpus.cut[max(month - recent, 0)])
    base_lo = int(corpus.cut[max(month - base, 0)])

    df_recent: dict[str, int] = defaultdict(int)
    df_base: dict[str, int] = defaultdict(int)
    df_all: dict[str, int] = defaultdict(int)
    pair_seen: set[tuple[str, str]] = set()
    for idx in range(stop):
        terms = set(corpus.tokens[idx])
        for term in terms:
            df_all[term] += 1
            if idx >= recent_lo:
                df_recent[term] += 1
            elif idx >= base_lo:
                df_base[term] += 1
        ordered = sorted(terms)
        for i in range(len(ordered)):
            for j in range(i + 1, len(ordered)):
                pair_seen.add((ordered[i], ordered[j]))

    n_recent = max(stop - recent_lo, 1)
    n_base = max(recent_lo - base_lo, 1)
    burst = {
        term: np.log((df_recent.get(term, 0) + 0.5) / n_recent)
        - np.log((df_base.get(term, 0) + 0.5) / n_base)
        for term in set(df_recent) | set(df_base)
    }
    return {"burst": burst, "df": df_all, "n": max(stop, 1), "pairs": pair_seen}


def build_features(corpus: CausalCorpus, months: list[int]) -> pd.DataFrame:
    rows: list[dict] = []
    for month in months:
        authors = _author_state(corpus, month)
        terms = _term_state(corpus, month)
        history = authors["history"]

        # A TF-IDF view of the recent past, to ask how unlike everything else a
        # new abstract reads. Fitted only on papers already published.
        window_lo = int(corpus.cut[max(month - 6, 0)])
        window_hi = corpus.before(month).stop
        recent_docs = [
            f"{corpus.titles[i]} {corpus.abstracts[i]}" for i in range(window_lo, window_hi)
        ]
        vectorizer = TfidfVectorizer(max_features=20000, stop_words="english", min_df=2)
        matrix = vectorizer.fit_transform(recent_docs) if len(recent_docs) > 50 else None
        centroid = None
        if matrix is not None:
            centroid = np.asarray(matrix.mean(axis=0)).ravel()
            centroid /= max(np.linalg.norm(centroid), 1e-9)

        current = np.where(corpus.t == month)[0]
        for idx in current:
            names = corpus.authors[idx]
            prior = [len([m for m in history.get(name, []) if m < month]) for name in names]
            last_seen = [
                max([m for m in history.get(name, []) if m < month], default=-999)
                for name in names
            ]
            title, abstract = corpus.titles[idx], corpus.abstracts[idx]
            low = f"{title} {abstract}".lower()
            tokens = corpus.tokens[idx]
            bursts = [terms["burst"].get(term, 0.0) for term in tokens] or [0.0]
            rarity = [
                np.log(terms["n"] / (terms["df"].get(term, 0) + 1)) for term in tokens
            ] or [0.0]
            ordered = sorted(set(tokens))
            pairs = [
                (ordered[i], ordered[j])
                for i in range(len(ordered))
                for j in range(i + 1, len(ordered))
            ]
            unseen = sum(1 for pair in pairs if pair not in terms["pairs"])

            similarity = 0.0
            if centroid is not None:
                vec = vectorizer.transform([f"{title} {abstract}"])
                vec = np.asarray(vec.todense()).ravel()
                norm = np.linalg.norm(vec)
                similarity = float(vec @ centroid / norm) if norm > 0 else 0.0

            rows.append(
                {
                    "id": corpus.frame["id"].iloc[idx],
                    "t": month,
                    "team_size": float(len(names)),
                    "author_prior_max": float(np.log1p(max(prior, default=0))),
                    "author_prior_mean": float(np.log1p(np.mean(prior)) if prior else 0.0),
                    "author_new_frac": float(np.mean([p == 0 for p in prior]) if prior else 1.0),
                    "author_degree_max": float(
                        np.log1p(max((authors["degree"].get(n, 0.0) for n in names), default=0.0))
                    ),
                    "author_pagerank_max": float(
                        np.log1p(max((authors["pagerank"].get(n, 0.0) for n in names), default=0.0))
                    ),
                    "author_recency": float(month - max(last_seen, default=-999)),
                    "author_reach": float(
                        np.log1p(sum(authors["degree"].get(n, 0.0) for n in names))
                    ),
                    "n_categories": float(len(corpus.frame["categories"].iloc[idx])),
                    "cross_list": float(len(corpus.frame["categories"].iloc[idx]) > 1),
                    "title_words": float(len(title.split())),
                    "title_has_colon": float(":" in title),
                    "abstract_words": float(len(abstract.split())),
                    "abstract_sentences": float(abstract.count(". ") + 1),
                    "claim_score": float(sum(low.count(term) for term in CLAIM_TERMS)),
                    "hedge_score": float(sum(low.count(term) for term in HEDGE_TERMS)),
                    "has_numbers": float(bool(re.search(r"\d+\.?\d*\s*%", abstract))),
                    "has_named_system": float(
                        bool(re.match(r"^[A-Z][A-Za-z0-9\-]{2,}\s*:", title))
                    ),
                    "term_burst_max": float(np.max(bursts)),
                    "term_burst_mean": float(np.mean(bursts)),
                    "term_rarity": float(np.mean(rarity)),
                    "pair_novelty": float(unseen / max(len(pairs), 1)),
                    "distinctiveness": float(1.0 - similarity),
                    "centroid_similarity": float(similarity),
                }
            )
    return pd.DataFrame(rows)


if __name__ == "__main__":
    frame = pd.read_parquet(DATA / "arxiv_papers.parquet")
    labels = pd.read_parquet(DATA / "top_papers.parquet")
    known = set(labels["id"])
    months = sorted(frame[frame["id"].isin(known)]["t"].unique())
    print(f"corpus={len(frame):,} papers | scoring months {months[0]}..{months[-1]} "
          f"({len(months)} cohorts)")
    corpus = CausalCorpus(frame)
    features = build_features(corpus, [int(m) for m in months])
    features["is_hit"] = features["id"].isin(known).astype(int)
    features.to_parquet(DATA / "arxiv_features.parquet", index=False)
    print(f"features={features.shape[0]:,} rows x {len(FEATURES)} columns | "
          f"hits={int(features['is_hit'].sum())}")
