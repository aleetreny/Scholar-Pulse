from __future__ import annotations

from collections import Counter
from collections.abc import Iterable
from dataclasses import dataclass
import json
import re
from typing import Any


CATEGORY_TOKEN_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9.-]*")
KNOWN_BARE_TOKENS = frozenset({"cs", "stat", "math", "physics", "econ", "eess", "nlin"})


@dataclass(frozen=True)
class TopicGroup:
    key: str
    label: str
    description: str
    exact_tokens: frozenset[str] = frozenset()
    prefix_tokens: tuple[str, ...] = ()

    def matches(self, category: str) -> bool:
        normalized = category.strip().lower()
        if normalized in self.exact_tokens:
            return True
        return any(normalized.startswith(prefix) for prefix in self.prefix_tokens)


TOPIC_GROUPS: tuple[TopicGroup, ...] = (
    TopicGroup(
        key="ai-ml",
        label="AI & Machine Learning",
        description="Learning, neural methods, inference",
        exact_tokens=frozenset({"cs.ai", "cs.lg", "stat.ml", "cs.ne"}),
    ),
    TopicGroup(
        key="vision-language",
        label="Vision, Language & Information",
        description="Vision, language, retrieval, multimedia",
        exact_tokens=frozenset(
            {
                "cs.cv",
                "cs.cl",
                "cs.ir",
                "eess.iv",
                "cs.mm",
                "cs.hc",
                "cs.si",
                "cs.cy",
                "cs.dl",
                "cs.gr",
            }
        ),
    ),
    TopicGroup(
        key="systems-software",
        label="Systems, Security & Software",
        description="Software, security, networks, databases",
        exact_tokens=frozenset(
            {
                "cs.cr",
                "cs.se",
                "cs.ni",
                "cs.dc",
                "cs.db",
                "cs.os",
                "cs.pl",
                "cs.ar",
                "cs.ce",
                "cs.et",
                "cs.ma",
                "cs.pf",
                "cs.oh",
            }
        ),
    ),
    TopicGroup(
        key="robotics-control",
        label="Robotics, Control & Signal",
        description="Robotics, control, signal and audio",
        exact_tokens=frozenset({"cs.ro", "cs.sy", "eess.sy", "eess.sp", "cs.sd", "eess.as"}),
    ),
    TopicGroup(
        key="math-stats",
        label="Mathematics, Statistics & Theory",
        description="Theory, optimization, probability, inference",
        exact_tokens=frozenset(
            {
                "cs.lo",
                "cs.dm",
                "cs.cc",
                "cs.gt",
                "cs.cg",
                "cs.ds",
                "cs.it",
                "cs.fl",
                "cs.na",
                "cs.sc",
                "cs.ms",
            }
        ),
        prefix_tokens=("math.", "stat."),
    ),
    TopicGroup(
        key="bio-complex",
        label="Biology, Medicine & Complex Systems",
        description="Quantitative biology, medicine and complex systems",
        exact_tokens=frozenset(
            {
                "q-bio",
                "physics.bio-ph",
                "physics.med-ph",
                "physics.soc-ph",
                "physics.data-an",
                "adap-org",
                "chao-dyn",
            }
        ),
        prefix_tokens=("q-bio.", "nlin."),
    ),
    TopicGroup(
        key="space-high-energy",
        label="Space, High-Energy & Nuclear",
        description="Astronomy, particle, relativity and nuclear physics",
        exact_tokens=frozenset(
            {
                "astro-ph",
                "gr-qc",
                "hep-ex",
                "hep-ph",
                "hep-th",
                "hep-lat",
                "nucl-ex",
                "nucl-th",
                "physics.space-ph",
            }
        ),
        prefix_tokens=("astro-ph.", "hep-", "nucl-"),
    ),
    TopicGroup(
        key="physics-quantum",
        label="Physics, Materials & Quantum",
        description="Core physics, materials, optics and quantum science",
        exact_tokens=frozenset(
            {
                "quant-ph",
                "math-ph",
                "cond-mat",
                "acc-phys",
                "ao-sci",
                "cmp-lg",
                "mtrl-th",
                "supr-con",
                "patt-sol",
                "solv-int",
                "funct-an",
                "bayes-an",
                "chem-ph",
                "atom-ph",
                "plasm-ph",
            }
        ),
        prefix_tokens=("physics.", "cond-mat."),
    ),
    TopicGroup(
        key="econ-finance",
        label="Economics & Finance",
        description="Economics, markets and quantitative finance",
        exact_tokens=frozenset({"q-fin"}),
        prefix_tokens=("q-fin.", "econ."),
    ),
    TopicGroup(
        key="other",
        label="Other & Interdisciplinary",
        description="Smaller or cross-disciplinary areas",
    ),
)

TOPIC_GROUPS_BY_KEY = {group.key: group for group in TOPIC_GROUPS}


def _is_valid_category_token(token: str) -> bool:
    normalized = token.strip().lower()
    if not normalized:
        return False
    if "." in normalized or "-" in normalized:
        return True
    return normalized in KNOWN_BARE_TOKENS


def normalize_category_tokens(value: Any) -> list[str]:
    seen: set[str] = set()
    tokens: list[str] = []

    def append_token(raw_token: str) -> None:
        token = raw_token.strip()
        lowered = token.lower()
        if not _is_valid_category_token(lowered) or lowered in seen:
            return
        seen.add(lowered)
        tokens.append(token)

    def visit(item: Any) -> None:
        if item is None:
            return

        if isinstance(item, str):
            text = item.strip()
            if not text:
                return
            if text.startswith("[") and text.endswith("]"):
                try:
                    parsed = json.loads(text)
                except json.JSONDecodeError:
                    parsed = None
                if isinstance(parsed, list):
                    visit(parsed)
                    return

            for token in CATEGORY_TOKEN_PATTERN.findall(text):
                append_token(token)
            return

        if isinstance(item, Iterable) and not isinstance(item, (bytes, bytearray, dict)):
            for child in item:
                visit(child)
            return

        visit(str(item))

    visit(value)
    return tokens


def topic_key_for_category(category: str) -> str:
    for group in TOPIC_GROUPS[:-1]:
        if group.matches(category):
            return group.key
    return TOPIC_GROUPS[-1].key


def topic_keys_for_categories(categories: Iterable[str]) -> list[str]:
    keys = {topic_key_for_category(category) for category in normalize_category_tokens(list(categories))}
    return [group.key for group in TOPIC_GROUPS if group.key in keys]


def topic_labels_for_categories(categories: Iterable[str]) -> list[str]:
    return [TOPIC_GROUPS_BY_KEY[key].label for key in topic_keys_for_categories(categories)]


def build_taxonomy_options(category_values: Iterable[Iterable[str]]) -> list[dict[str, str | int]]:
    counts: Counter[str] = Counter()
    for categories in category_values:
        for key in set(topic_keys_for_categories(categories)):
            counts[key] += 1

    options: list[dict[str, str | int]] = []
    for group in TOPIC_GROUPS:
        count = counts.get(group.key, 0)
        if count <= 0:
            continue
        options.append(
            {
                "label": group.label,
                "value": group.key,
                "description": group.description,
                "count": int(count),
            }
        )
    return options


def taxonomy_match(categories: Iterable[str], tokens: list[str]) -> bool:
    if not tokens:
        return True

    normalized_categories = normalize_category_tokens(list(categories))
    normalized_category_values = [category.lower() for category in normalized_categories]
    topic_keys = set(topic_keys_for_categories(normalized_categories))

    for token in tokens:
        normalized = token.strip().lower()
        if not normalized:
            continue
        if normalized in topic_keys:
            return True
        if any(category == normalized or category.startswith(f"{normalized}.") for category in normalized_category_values):
            return True
    return False