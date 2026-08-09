# Ranking research

Offline study behind the proposed pivot: turning ScholarPulse from a
chronological feed into a ranked preview of the recent papers most likely to
matter. Nothing here runs in production; it exists to decide what production
should do, and to leave the evidence auditable.

## The question

A paper's impact is measured in citations, and a paper that appeared this
morning has none. So the whole product rests on one empirical claim: that the
metadata visible on day zero already carries a usable signal about what a paper
will become. These experiments test that claim, on real papers, against real
outcomes, and then try to break the result.

## Corpora

Three public sources, none redistributed here — `fetch_data.sh` pulls each from
its own home.

| Corpus | Size | What it provides |
| --- | --- | --- |
| hep-th citation graph (KDD Cup 2003 / SNAP) | 27,770 arXiv papers, 351,864 citations, 1992–2003 | Hard ground truth. arXiv ids of that era encode the submission month, so every paper *and every citation* is timestamped and the world can be replayed month by month. |
| arXiv metadata sample | 41,000 papers, 1993–2018 | Title, abstract, authors, categories, date — the same payload ScholarPulse already snapshots. |
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
| `prepare_data.py` | Normalise them into parquet; validates the month decoding. |
| `hepth_features.py` | Causal features on the citation graph, at any observation window. |
| `arxiv_features.py` | Day-zero features from arXiv metadata alone. |
| `metrics.py` | NDCG, precision@k, lift, paired bootstrap. |
| `models.py` | Heuristics, ridge, Poisson GLM, gradient boosting, pairwise learning-to-rank, reciprocal rank fusion. |
| `run_hepth.py` | E1–E7: cold start, observation window, mixed-age boards, tier ablation, horizons, stability, feature selection. |
| `run_arxiv.py` | E8: same question on modern arXiv metadata. |
| `run_audit.py` | E10–E12: where the signal lives, calibration, robustness. |
| `run_final.py` | E13–E15: the fixes, and whether they work. |

```bash
RESEARCH_DATA=/workspace/rankdata ./research/ranking/fetch_data.sh
cd research/ranking
python prepare_data.py && python hepth_features.py && python arxiv_features.py
python run_hepth.py && python run_arxiv.py && python run_audit.py && python run_final.py
```

Runtime is about seven minutes end to end on four cores.

## What came out

1. **Cold-start ranking works.** On hep-th, ranking a month's submissions on day
   zero reaches NDCG@10 = 0.67 against 0.36 for random ordering; the top ten
   collect 3.0× the citations of an average paper from the same month.
   ΔNDCG@10 = +0.31 [+0.28, +0.35] over 52 held-out months.
2. **The reference list beats the citation graph.** Six features derived from
   what a paper cites (how many, how recent, how spread out) scored 0.687 —
   *higher* than all 26 features together (0.658). PageRank, co-citation
   z-scores and velocity added noise, not signal. Greedy selection independently
   converged on four reference-list features and nothing else.
3. **Waiting is the strongest lever.** A one-month observation window lifts
   NDCG@10 from 0.658 to 0.732; three months to 0.823; six to 0.870. On a
   rolling board the width trades freshness against discrimination — 4.4× lift
   at one month, 8.8× at three, 14.0× at six, 21.9× at twelve — and three
   months is where 91% of the top ten already falls in its cohort's top decile.
4. **Atypical combinations did not replicate here.** The Uzzi et al. novelty and
   conventionality z-scores, computed against an analytic configuration-model
   null, ranked below random on their own and were dropped by feature selection.
   Age-normalising a mixed-age board did not help either, at any width — it
   costs a steady ~0.05 NDCG (0.861 → 0.821 at three months, 0.951 → 0.894 at
   twenty-four). The label is already age-invariant, so there was no bias to
   correct and the division only added variance.
5. **On modern arXiv metadata, authorship carries the signal.** AUC 0.836
   [0.801, 0.869]; the top ten of a month are 9.6× enriched in papers that
   became landmarks. Author signals alone score 0.818; content signals alone
   0.690; writing style is close to noise.
6. **Which makes the naive model a reputation detector.** The best-connected 10%
   of authors take 60% of the board. Hits by unknown authors land at the 49th
   percentile — a coin flip — against the 88th for established ones.
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
    shuffle — and put zero landmark papers in the top ten across eleven months.
