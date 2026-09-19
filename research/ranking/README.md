# Ranking review, September 2026

The current ranker is `pulse-v2`. This directory distinguishes retrospective
research from prospective evidence about the live application.

## Corrections to the previous study

The original account is preserved in [legacy-study.md](legacy-study.md). Two
problems prevent treating its dense-memory numbers as causal deployment evidence:

- `memoryFor(..., dense=true)` included every submission before a weekly build,
  including its target papers. Target papers therefore supplied their own author
  histories. The reported 0% newcomer share was not independent evidence of
  historical coverage. The replay now excludes current target IDs from all memory
  arms; previous numbers have not been relabeled as results of this correction.
- The replay fetched current reference counts and current arXiv metadata for old
  papers. Neither immutable first-version bibliographies nor day-zero indexing
  availability was observed. A production replay cannot reconstruct those facts
  from a later API response.

The 2017–2018 curated-landmark metadata calibration also does not calibrate
fused rankings in every current discipline. V2 retains that model as a prior,
but removes the probability claim and historical lift from the live interface.
Its approximate collaborator statistic is still batch-dependent. This limitation
is explicit rather than disguised as an exact coauthor graph.

## What changes in v2

- Per-display-category cohorts include cross-listed papers. No unrelated-field pool.
- External lanes rank on a shared percentile scale. Their weight is observed
  coverage; missing counts contribute zero centered evidence, not zero citations.
- Citations are compared inside 28-day publication-age buckets. A bucket needs at
  least eight valid observations and variation before it contributes.
- Once a paper is at least 28 days old, the citation lane's weight is 4. This was
  selected from the small grid below; younger papers retain weight 1.
- Existing newcomer comparison/reservations are retained. The percentile is
  within the corresponding newcomer/established comparison group. Ties in input
  evidence remain tied; unrounded standing and a stable ID order prevent rounded
  scores or source ordering from silently changing the page.
- Explanations include actual reference/citation contributions, and distinguish
  a cohort having a lane from an individual paper having an observation.

For lane coverage c and descending within-known percentile p, its centered
contribution is `c * (1 / (0.2 + p) - 1 / 0.7)`. Unknown observations contribute
zero. The metadata lane uses the same transform at full coverage. This extends
[RRF](https://research.google/pubs/reciprocal-rank-fusion-outperforms-condorcet-and-individual-rank-learning-methods/)
with explicit common scaling and coverage weights; the original paper does not
establish the value of these extensions for scientific impact.

## Reproducible fusion experiment

Source: [SNAP hep-th](https://snap.stanford.edu/data/cit-HepTh.html), a public
citation graph. The source is not committed; its SHA-256 is recorded in
[fusion-validation.json](fusion-validation.json). After rejecting undecodable or
time-inconsistent edges: 27,761 nodes, 351,864 edges, 943 excluded edges.

Protocol:

1. Count observed citations through publication month + 1. Grade **additional**
   citations in months + 2 through + 24. No future citation enters an input.
2. Five fixed coverage scenarios simulate index missingness with deterministic,
   independent ID hashes for references and citations.
3. Select a reception multiplier from `[1, 2, 4]` on **1993–1995** cohorts only.
   All their 24-month labels complete before January 1998. Mean NDCG@10 across
   the five scenarios was 0.6335, 0.6404, 0.6432; multiplier 4 was selected.
4. Compare against the former partial-lane fusion on **1998–April 2001**, 40
   cohorts and 9,348 papers with complete 24-month horizons. Use logarithmic
   citation gain in NDCG@10; report paired monthly bootstrap intervals.

| Reference coverage | Citation coverage | Old fusion | V2 fusion | Paired difference, 95% interval |
| --- | --- | --- | --- | --- |
| 100% | 100% | 0.792 | 0.852 | +0.060 [0.045, 0.075] |
| 75% | 75% | 0.753 | 0.819 | +0.066 [0.053, 0.081] |
| 100% | 25% | 0.655 | 0.672 | +0.017 [0.006, 0.030] |
| 25% | 100% | 0.820 | 0.858 | +0.038 [0.025, 0.052] |
| 25% | 25% | 0.671 | 0.675 | +0.004 [-0.017, 0.023] |

**Rejected candidate:** equal-weight coverage fusion lost 0.040 NDCG@10 when
citation coverage was 25% and references complete. Its full results are retained
in the JSON. Those evaluation results were examined before the training grid
above was run; this is retrospective evidence, **not a blinded holdout**.

This experiment compares **two external lanes**, omitting the metadata model
because the graph contains no author/title features. It does not validate the
complete production system, newborn papers or transfer to other disciplines.
Publication months are decoded from IDs, and bibliographies in the static graph
may contain later revisions. Random missingness is not the same as real index
selection. Bootstrap intervals describe this protocol; they cannot remove those
limitations or dependence between citations across neighboring months.

```bash
mkdir -p data/review-corpora
curl -fL https://snap.stanford.edu/data/cit-HepTh.txt.gz \
  -o data/review-corpora/cit-HepTh.txt.gz
node research/ranking/check_fusion.mjs
# Refit the generated reception multiplier using the same fixed protocol:
node research/ranking/check_fusion.mjs --export
```

The command writes detailed cohort results under the ignored data directory.
`fusion-model.generated.ts` records the training grid and source hash; the
metadata coefficients in `model.generated.ts` are unchanged.

## Prospective evaluation

The legacy log's first date, **2026-08-23T15:06:47.298Z**, is preserved, and its
first eligible evaluation is **2026-11-21T15:06:47.298Z**. Each new version needs
its own 90-day follow-up. A Saturday workflow runs the evaluator and retains the
JSON report as an Actions artifact; immature cohorts cause no external queries.

V2 logs all candidates, displayed positions and three baselines on the identical
candidate set: the former formula, newest-first and reference-count order. The
former-formula comparator uses the new per-category candidates and current
as-of-build memory; it is not a reconstruction of what the old website displayed.
Full candidates avoid the biased NDCG that would result from grading only the
old log's oversampled head. New entries keep initial citations only when actually
observed in the ranking run; stale cached counts cannot serve as that baseline.

The evaluator reports every discipline separately and keeps versions separate.
For V2 the outcome is future citation **gain**, not the cumulative count that
already influenced the predictor. It requires at least 80% outcome/baseline
coverage, complete original top-ten outcomes in every arm, and at least five
observed positive papers. Missing observations and downward index corrections
are excluded and counted through coverage. Legacy rows retain their sampling
weights and are evaluated by within-field AUC and band lift. Expanded control
weights never count as extra independent positives.

Reports remain diagnostic: daily builds overlap and cross-listed papers appear
in multiple disciplines. They must not be treated as independent replication or
pooled raw cross-field citation counts. A future significance analysis should
cluster at least by calendar block and account for shared papers.

## Sources and tooling

- Hirako, Sasano & Takeda (2023), [Realistic Citation Count Prediction Task for Newly Published Papers](https://aclanthology.org/2023.findings-eacl.84/): motivates strict temporal information boundaries.
- Cormack, Clarke & Büttcher (2009), [Reciprocal rank fusion](https://research.google/pubs/reciprocal-rank-fusion-outperforms-condorcet-and-individual-rank-learning-methods/): rank fusion baseline.
- Abramo, D'Angelo & Felici (2019), [Predicting long-term publication impact through a combination of early citations and journal impact factor](https://arxiv.org/abs/1909.08907): prediction varies with exposure time and discipline; no journal prestige signal was added here.
- [SNAP hep-th dataset](https://snap.stanford.edu/data/cit-HepTh.html): the experiment's graph and provenance.
- Kassis, Agarwal, He, Patel & Brueckner (2026), [Scientific Agent Skills](https://doi.org/10.48550/arXiv.2609.00065): procedural literature-lookup tooling used during the review; not evidence for this ranker's effectiveness.

Sources checked on 19 September 2026.
