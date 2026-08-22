# Ranking research

Offline study behind the pivot from a chronological feed to a ranked preview of
the recent papers most likely to matter. Nothing in this directory runs in
production; it exists to decide what production should do, and to leave the
evidence auditable.

**It shipped.** `export_model.py` refits the study on the subset of signals a
static build can actually compute and writes the coefficients into
`apps/web/src/lib/ranking/model.generated.ts`. The scoring itself lives in
`apps/web/src/lib/ranking/`, runs at build time in
`apps/web/scripts/rank-snapshots.mjs`, and is covered by `npm test` in
`apps/web`. Regenerate the model rather than hand-editing it.

## The question

A paper's impact is measured in citations, and a paper that appeared this
morning has none. So the whole product rests on one empirical claim: that the
metadata visible on day zero already carries a usable signal about what a paper
will become. These experiments test that claim, on real papers, against real
outcomes, and then try to break the result.

## Corpora

Three public sources, none redistributed here. `fetch_data.sh` pulls each from
its own home.

| Corpus | Size | What it provides |
| --- | --- | --- |
| hep-th citation graph (KDD Cup 2003 / SNAP) | 27,770 arXiv papers, 351,864 citations, 1992–2003 | Hard ground truth. arXiv ids of that era encode the submission month, so every paper *and every citation* is timestamped and the world can be replayed month by month. |
| arXiv metadata sample | 41,000 papers, 1993–2018 | Title, abstract, authors, categories, date: the same payload ScholarPulse already snapshots. |
| UKP Lab curated hits | 198 papers (93 inside the sample above; 87 in scope after category filtering) | Papers that demonstrably mattered in cs.LG / cs.CL, 2017-05 → 2018-03, with measured citation counts. |

## Protocol

Every number is produced under a constraint a deployment actually faces.

- **Time-sliced features.** A citation exists from the moment the *citing* paper
  is posted, so scoring a paper submitted in month T uses only edges with source
  month < T. The slicing happens once, centrally, in `hepth_features.py`.
- **Rolling-origin validation.** To score test month T, training uses only
  cohorts whose labels were already complete at T (months m with m + horizon ≤ T).
  A random split would let 2001 teach the model how to rank 1998.
- **Cohort-relative everything.** Comparisons happen inside one month's batch;
  the target is a paper's percentile among its peers, not its raw count, so the
  model cannot win by learning the calendar.
- **Bootstrap over cohorts, not papers.** Papers within a month share a graph
  state and a topic mix, so months are the independent replicates.

## Files

| File | Role |
| --- | --- |
| `fetch_data.sh` | Download the three corpora. |
| `backtest_deployed.mjs` | Replay the site's weekly job over a period old enough to have outcomes, and grade it. |
| `prepare_data.py` | Normalise them into parquet; validates the month decoding. |
| `hepth_features.py` | Causal features on the citation graph, at any observation window. |
| `arxiv_features.py` | Day-zero features from arXiv metadata alone. |
| `metrics.py` | NDCG, precision@k, lift, paired bootstrap. |
| `models.py` | Heuristics, ridge, Poisson GLM, gradient boosting, pairwise learning-to-rank, reciprocal rank fusion. |
| `run_hepth.py` | E1–E7: cold start, observation window, mixed-age boards, tier ablation, horizons, stability, feature selection. |
| `run_arxiv.py` | E8: same question on modern arXiv metadata. |
| `run_audit.py` | E10–E12: where the signal lives, calibration, robustness. |
| `run_final.py` | E13–E15: the fixes, and whether they work. |
| `export_model.py` | Refit on the deployable signals; emit the shipped model. |

`backtest_deployed.mjs` is the only file here that imports the deployed code
rather than describing it, and the only one whose corpus is 2026 rather than
2018. It exists because everything above answers "does this work in
principle" and none of it answers "does the thing on the site work".

```bash
RESEARCH_DATA=/workspace/rankdata ./research/ranking/fetch_data.sh
cd research/ranking
python prepare_data.py && python hepth_features.py && python arxiv_features.py
python run_hepth.py && python run_arxiv.py && python run_audit.py && python run_final.py
python export_model.py          # writes apps/web/src/lib/ranking/model.generated.ts
```

Runtime is about seven minutes end to end on four cores.

## What shipped, and what it cost

The deployed model is not the best model in this study; it is the best model
that can be computed from an Atom feed and defended a year from now.

| Variant | AUC | lift@10 | Why not this one |
| --- | --- | --- | --- |
| All 24 research features, unconstrained | 0.835 | 8.2× | Four features cannot be computed, or cannot be afforded (see below). |
| 20 deployable features, unconstrained | 0.806 | 4.7× | Six coefficients pointed against their own univariate direction: cancellation artefacts that hold only while the corpus correlations do. |
| **12 deployable features, non-negative** | **0.789** | **6.2×** | **Shipped.** Each signal is pre-oriented and its weight pinned at or above zero, so nothing can cancel, the fit survives a change of cohort, and every score decomposes into readable contributions. lift@10 is *higher* than the unconstrained variant's. |

Four of the twenty-four are excluded before fitting. Co-authorship PageRank and
the two TF-IDF distinctiveness measures need the whole graph or a fitted
vectoriser, neither of which survives a static build. `pair_novelty` is
excluded for a different reason worth recording: it is cheap to compute and
expensive to *remember*. Tracking which word pairs have been seen together
needs a set that grows to ~11 MB of state carried between builds, and the
signal sits at AUC 0.503, which is noise. Dropping it improved every metric (AUC 0.788
→ 0.789, lift@10 6.00× → 6.15×) and cut the memory file from 5.4 MB to 1.1 MB.

Eight of the remaining twenty were then given zero weight by the fit and are
not shipped either: claim language, hedging, `has_numbers`, `cross_list`,
`abstract_sentences`, `term_burst_max`, and both raw author-productivity counts.

## What came out

1. **Cold-start ranking works.** On hep-th, ranking a month's submissions on day
   zero reaches NDCG@10 = 0.67 against 0.36 for random ordering; the top ten
   collect 3.0× the citations of an average paper from the same month.
   ΔNDCG@10 = +0.31 [+0.28, +0.35] over 52 held-out months.
2. **The reference list beats the citation graph.** Six features derived from
   what a paper cites (how many, how recent, how spread out) scored 0.687,
   *higher* than all 26 features together (0.658). PageRank, co-citation
   z-scores and velocity added noise, not signal. Greedy selection independently
   converged on four reference-list features and nothing else.
3. **Waiting is the strongest lever.** A one-month observation window lifts
   NDCG@10 from 0.658 to 0.732; three months to 0.823; six to 0.870. On a
   rolling board the width trades freshness against discrimination: 4.4× lift
   at one month, 8.8× at three, 14.0× at six, 21.9× at twelve, and three
   months is where 91% of the top ten already falls in its cohort's top decile.
4. **Atypical combinations did not replicate here.** The Uzzi et al. novelty and
   conventionality z-scores, computed against an analytic configuration-model
   null, ranked below random on their own and were dropped by feature selection.
   Age-normalising a mixed-age board did not help either, at any width; it
   costs a steady ~0.05 NDCG (0.861 → 0.821 at three months, 0.951 → 0.894 at
   twenty-four). The label is already age-invariant, so there was no bias to
   correct and the division only added variance.
5. **On modern arXiv metadata, authorship carries the signal.** AUC 0.836
   [0.801, 0.869]; the top ten of a month are 9.6× enriched in papers that
   became landmarks. Author signals alone score 0.818; content signals alone
   0.690; writing style is close to noise.
6. **Which makes the naive model a reputation detector.** The best-connected 10%
   of authors take 60% of the board. Hits by unknown authors land at the 49th
   percentile, a coin flip, against the 88th for established ones.
7. **The fix is nearly free.** Ranking newcomers in their own lane on content
   signals and reserving 30% of slots costs 0.03 AUC and raises outsider hits
   from the 49th to the 73rd percentile, while *improving* recall@25.
8. **Publish tiers, not positions.** Bagging does not damp input noise (every
   replica reads the same perturbed inputs). Under 5% jitter a strict top-10
   keeps 71% of its members; tier assignment keeps 95%.
9. **The score can be shown honestly.** After isotonic calibration the predicted
   and observed hit rates agree band by band and the ordering is monotone.
10. **Chronological ordering is indistinguishable from shuffling.** Within a
    month's feed, newest-first scores AUC 0.483 against 0.502 for a random
    shuffle, and put zero landmark papers in the top ten across eleven months.

## What it does in production

Everything above is 2017-18 data and a curated label. `backtest_deployed.mjs`
asks the narrower question: the weekly job is replayed over February and March
2026 in cs.LG, cs.CL and hep-th, scoring each cohort with the deployed ranker
on what a build standing in that week could have known, and grading it against
the citations those papers had by August 2026. Twenty-seven cohorts, 2,576
papers, five to six months of accrual.

The label is not the study's label and the numbers are not comparable to it.
"Became a demonstrable reference in its field" was a 1.4% event in a curated
list; here 52% of papers have at least one citation, the cohort's top decile
starts at four, and 0.7% reach twenty. What can be compared is rankers against
each other on the same cohorts.

| Ranker | NDCG@10 | lift@10 | P@10 | AUC (top decile) |
| --- | --- | --- | --- | --- |
| **as deployed** (signals + reference lane) | **0.414** [0.374, 0.458] | **1.68x** [1.35, 2.06] | 0.237 | 0.598 [0.573, 0.621] |
| reference count alone | 0.417 [0.370, 0.474] | 1.63x [1.35, 1.99] | 0.222 | 0.594 [0.559, 0.629] |
| the twelve signals alone | 0.317 [0.284, 0.353] | 1.44x [1.11, 1.86] | 0.181 | 0.578 [0.554, 0.602] |
| random shuffle | 0.339 [0.293, 0.383] | 1.22x [0.98, 1.49] | 0.178 | 0.530 [0.501, 0.561] |
| newest first | 0.258 [0.225, 0.290] | 1.03x [0.79, 1.32] | 0.115 | 0.493 [0.454, 0.534] |

Three things fall out of that table, in descending order of how much they hurt.

1. **The feed does beat the feed it replaced, and the margin is real.**
   ΔNDCG@10 = +0.156 [+0.106, +0.205] over newest-first, better in 85% of
   cohorts. E10's finding survives contact with 2026: chronological ordering is
   worse than a shuffle.
2. **Nearly all of it is the reference count.** Sorting the cohort by nothing
   but the length of its bibliography scores 0.417 against the full system's
   0.414. The twelve signals, the cohort percentiles, the non-negative fit, the
   newcomer lane and the reciprocal-rank fusion together add nothing that
   survives a confidence interval. The lane the study called strongest is
   carrying the product, and the model the README explains at length is along
   for the ride.
3. **On their own, the twelve signals rank below a shuffle.** 0.317 against
   0.339 on NDCG@10, and 0.181 against 0.178 on precision@10. They order the
   whole list slightly better than chance (AUC 0.578 against 0.530), but the
   head of the list, which is the only part the product shows, is not better
   than random.

The reason is coverage, and it is fixable. The site ingests a hundred papers
per category per week, roughly 14% of these three fields, so 44% of every
cohort consists of papers whose authors it has never seen. Inside that pool all
four author signals are constant and drop out, which leaves title length,
whether the title has a colon, and abstract length holding 78% of what still
moves the ranking. Fold the whole corpus into the memory instead, changing
nothing else, and the same twelve signals go from below a shuffle to clearly
above it:

| Ranker | NDCG@10 | lift@10 | AUC (top decile) | AUC (>=20 citations) |
| --- | --- | --- | --- | --- |
| the twelve signals, site's ingestion (44% newcomers) | 0.317 | 1.44x | 0.578 | 0.698 |
| the twelve signals, whole corpus (0% newcomers) | 0.393 | 1.60x | 0.637 | 0.800 |
| as deployed, whole corpus | 0.476 | 2.03x | 0.648 | 0.822 |

So the model is not broken. It is starved. What it needs is not a better fit,
it is a memory that has seen the field.
