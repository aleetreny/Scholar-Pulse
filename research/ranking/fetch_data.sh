#!/usr/bin/env bash
# Fetch the three public corpora the ranking experiments run on.
#
# None of them is redistributed here: this script pulls each from its public
# home so the experiments can be reproduced without shipping datasets in the
# repository. Total download is roughly 80 MB.
#
#   usage:  RESEARCH_DATA=/somewhere ./research/ranking/fetch_data.sh
set -euo pipefail

DATA="${RESEARCH_DATA:-/workspace/rankdata}"
WORK="${RESEARCH_WORK:-/workspace/corpora}"
mkdir -p "$DATA" "$WORK"

clone() { # clone <owner/repo> <dir>
  if [ ! -d "$2/.git" ]; then
    GIT_LFS_SKIP_SMUDGE=1 git clone --depth 1 "https://github.com/$1" "$2"
  fi
}

# 1. hep-th citation graph: 27,770 arXiv papers, 352,807 citations, 1992-2003.
#    Released for the 2003 KDD Cup, redistributed by SNAP; this mirror carries
#    the edge list. Node ids are arXiv ids, which encode the submission month.
if [ ! -f "$DATA/cit-HepTh.txt.gz" ]; then
  git clone --depth 1 --filter=blob:none --no-checkout \
    https://github.com/apachecn/data "$WORK/apachecn-data"
  git -C "$WORK/apachecn-data" show HEAD:graph/cit-HepTh.txt.gz > "$DATA/cit-HepTh.txt.gz"
fi

# 2. 41,000 arXiv papers with title, abstract, authors, categories and date.
clone neelshah18/arxivdata "$WORK/arxivdata"

# 3. 198 papers curated as high-impact in cs.LG and cs.CL, with citation counts
#    (UKP Lab, "Predicting Research Trends from arXiv", 2018).
clone UKPLab/refresh2018-predicting-trends-from-arxiv "$WORK/ukp-trends"

echo "corpora ready under $WORK, artefacts under $DATA"
echo "next: python research/ranking/prepare_data.py"
