# Project: ScholarPulse — Geometric Intelligence of Scientific Frontiers

## 1. Project Vision

**ScholarPulse** is an autonomous tech scouting and scientific discovery tool. It leverages the **topology of embedding spaces** to measure progress, saturation, and interdisciplinary opportunities within scientific literature. The system moves beyond traditional keyword searches to focus on the dynamic evolution of knowledge fields through time-based vector analysis.

## 2. Data Sourcing and Scope

- **Main Source:** ArXiv API.
- **Data Scope:** Extraction of metadata (Title, Date, Categories) and **Abstracts**.
- **Justification:** Abstracts will be used exclusively for the global mapping due to their high semantic density and technical cleanliness. Full-text PDF downloads are reserved for "surgical" gap analysis only.

## 3. Embedding Architecture and Processing

To achieve superior semantic resolution, the project utilizes state-of-the-art models processed on **Google Colab (GPU)**.

- **Embedding Model:** `BAAI/bge-m3`.
  - **Advantage:** Supports long-context (8k tokens), ranks at the top of the MTEB benchmark, and provides significantly sharper cluster separation.
- **Execution Environment:** Google Colab with Google Drive persistence for storing `.npy` matrices.
- **Strategy:** Embedding normalization to optimize Cosine Similarity calculations.

## 4. Non-Generative Thematic Classification

Thematic identification is performed via **BERTopic** and deterministic clustering algorithms:

1.  **Dimensionality Reduction:** UMAP (Uniform Manifold Approximation and Projection).
2.  **Clustering:** HDBSCAN to detect variable-density groups.
3.  **Semantic Labeling (c-TF-IDF):** Mathematical extraction of the keywords defining each cluster without LLM intervention.

## 5. The Physics of Knowledge: Mathematical Metrics

The core of the analysis lies in measuring how points (papers) move and evolve within the vector space:

- **Momentum and Acceleration:** Measuring the change in paper density within specific regions per unit of time ($\Delta \text{Density} / \Delta t$).
- **Cluster Entropy (Semantic Consensus):** Calculating vector dispersion to measure the level of consensus or fragmentation within a discipline.
- **Semantic Drift:** Measuring the displacement of a technology's "center of mass" (centroid) between Year $T$ and Year $T-1$.
- **Infiltration Coefficient:** Analyzing density at the borders between clusters to detect interdisciplinary hybridization (Cross-pollination).

## 6. "Wild" Inference Layer (AWS Bedrock)

Once **Gaps** (low-density spaces between clusters with high infiltration) are identified mathematically, the **AWS Bedrock API** is triggered for final interpretation:

- **Task:** Send the abstracts of the "frontier papers" to a high-performance model (e.g., Claude 3.5/4).
- **Output:** A strategic synthesis report describing the potential research hypothesis or technology that could fill that specific semantic void.

## 7. Visualization and Deliverables

- **Quarto Document:** A dynamic technical report featuring time-lapse animations of the "knowledge cloud."
- **Interactive Dashboard:** Plotly charts to monitor the acceleration and drift curves of each technological sector.
