from __future__ import annotations

from apps.dashboard.taxonomy import (
    build_taxonomy_options,
    normalize_category_tokens,
    taxonomy_match,
    topic_key_for_category,
    topic_labels_for_categories,
)


def test_normalize_category_tokens_handles_numpy_style_strings() -> None:
    raw = ["['cs.AI' 'cs.LG' 'stat.ML']", "['physics.optics' 'quant-ph']"]

    assert normalize_category_tokens(raw) == [
        "cs.AI",
        "cs.LG",
        "stat.ML",
        "physics.optics",
        "quant-ph",
    ]


def test_topic_key_for_category_maps_major_domains() -> None:
    assert topic_key_for_category("cs.AI") == "ai-ml"
    assert topic_key_for_category("cs.CV") == "vision-language"
    assert topic_key_for_category("cs.RO") == "robotics-control"
    assert topic_key_for_category("math.ST") == "math-stats"
    assert topic_key_for_category("physics.optics") == "physics-quantum"
    assert topic_key_for_category("astro-ph.SR") == "space-high-energy"
    assert topic_key_for_category("q-bio.NC") == "bio-complex"
    assert topic_key_for_category("q-fin.GN") == "econ-finance"


def test_topic_labels_for_categories_collapses_raw_values() -> None:
    categories = ["['cs.CV' 'cs.LG' 'stat.ML']", "['physics.optics' 'quant-ph']"]

    assert topic_labels_for_categories(categories) == [
        "AI & Machine Learning",
        "Vision, Language & Information",
        "Physics, Materials & Quantum",
    ]


def test_build_taxonomy_options_returns_small_readable_groups() -> None:
    category_values = [
        ["['cs.AI' 'cs.LG']"],
        ["['cs.CV' 'cs.CL']"],
        ["['physics.optics' 'quant-ph']"],
        ["['q-fin.GN']"],
    ]

    options = build_taxonomy_options(category_values)

    assert [option["value"] for option in options] == [
        "ai-ml",
        "vision-language",
        "physics-quantum",
        "econ-finance",
    ]
    assert options[0]["label"] == "AI & Machine Learning"
    assert options[0]["count"] == 1


def test_taxonomy_match_supports_group_tokens_and_legacy_raw_tokens() -> None:
    categories = normalize_category_tokens(["['cs.AI' 'cs.LG' 'stat.ML']"])

    assert taxonomy_match(categories, ["ai-ml"])
    assert taxonomy_match(categories, ["cs"])
    assert taxonomy_match(categories, ["cs.AI"])
    assert not taxonomy_match(categories, ["physics-quantum"])