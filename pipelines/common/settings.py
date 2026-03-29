from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field, ValidationError
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = Field(..., alias="DATABASE_URL")
    data_dir: Path = Field(default=Path("data"), alias="DATA_DIR")

    arxiv_base_url: str = Field(default="http://export.arxiv.org/api/query", alias="ARXIV_BASE_URL")
    arxiv_page_size: int = Field(default=200, alias="ARXIV_PAGE_SIZE")
    arxiv_delay_seconds: float = Field(default=3.0, alias="ARXIV_DELAY_SECONDS")
    arxiv_overlap_hours: int = Field(default=48, alias="ARXIV_OVERLAP_HOURS")
    arxiv_max_retries: int = Field(default=5, alias="ARXIV_MAX_RETRIES")

    taxonomy_default: str = Field(default="cs,stat,physics", alias="TAXONOMY_DEFAULT")

    embedding_model_name: str = Field(default="BAAI/bge-m3", alias="EMBEDDING_MODEL_NAME")
    embedding_model_version: str = Field(default="bge-m3", alias="EMBEDDING_MODEL_VERSION")
    embedding_dimension: int = Field(default=1024, alias="EMBEDDING_DIMENSION")
    embedding_shard_size: int = Field(default=2000, alias="EMBEDDING_SHARD_SIZE")
    latest_window_days: int = Field(default=7, alias="LATEST_WINDOW_DAYS")

    random_seed: int = Field(default=42, alias="RANDOM_SEED")
    metrics_knn_k: int = Field(default=10, alias="METRICS_KNN_K")

    map_sample_points: int = Field(default=150000, alias="MAP_SAMPLE_POINTS")
    map_viewport_cap: int = Field(default=20000, alias="MAP_VIEWPORT_CAP")
    map_density_bins: int = Field(default=160, alias="MAP_DENSITY_BINS")
    map_umap_neighbors: int = Field(default=30, alias="MAP_UMAP_NEIGHBORS")
    map_umap_min_dist: float = Field(default=0.05, alias="MAP_UMAP_MIN_DIST")

    similarity_pca_dim: int = Field(default=256, alias="SIMILARITY_PCA_DIM")
    similarity_hnsw_m: int = Field(default=16, alias="SIMILARITY_HNSW_M")
    similarity_hnsw_ef_construction: int = Field(default=200, alias="SIMILARITY_HNSW_EF_CONSTRUCTION")
    similarity_hnsw_ef_search: int = Field(default=80, alias="SIMILARITY_HNSW_EF_SEARCH")
    similarity_candidate_k: int = Field(default=200, alias="SIMILARITY_CANDIDATE_K")
    similarity_top_k: int = Field(default=20, alias="SIMILARITY_TOP_K")

    enrichment_batch_size: int = Field(default=200, alias="ENRICHMENT_BATCH_SIZE")
    enrichment_timeout_seconds: int = Field(default=30, alias="ENRICHMENT_TIMEOUT_SECONDS")

    prefect_api_url: str = Field(default="http://localhost:4200/api", alias="PREFECT_API_URL")
    log_level: str = Field(default="INFO", alias="LOG_LEVEL")

    model_config = SettingsConfigDict(env_file=".env", case_sensitive=False, extra="ignore")

    @property
    def taxonomy_tokens(self) -> list[str]:
        return [token.strip() for token in self.taxonomy_default.split(",") if token.strip()]


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    try:
        settings = Settings()
    except ValidationError as exc:
        raise RuntimeError(f"Invalid environment configuration: {exc}") from exc

    for subdir in ("raw", "interim", "processed", "external"):
        (settings.data_dir / subdir).mkdir(parents=True, exist_ok=True)

    return settings
