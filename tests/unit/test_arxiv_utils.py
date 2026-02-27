from __future__ import annotations

from pipelines.common.hash_utils import deterministic_content_hash
from pipelines.ingestion.arxiv_utils import parse_arxiv_identifier



def test_parse_arxiv_identifier_modern() -> None:
    parsed = parse_arxiv_identifier("http://arxiv.org/abs/2401.01234v2")
    assert parsed.base_id == "2401.01234"
    assert parsed.version == 2
    assert parsed.paper_version_id == "2401.01234v2"



def test_parse_arxiv_identifier_legacy() -> None:
    parsed = parse_arxiv_identifier("math/0301234v1")
    assert parsed.base_id == "math/0301234"
    assert parsed.version == 1



def test_deterministic_content_hash_stable() -> None:
    first = deterministic_content_hash("Title", "Abstract", ["cs.AI", "stat.ML"])
    second = deterministic_content_hash(" title ", "abstract", ["stat.ML", "cs.AI"])
    assert first == second
