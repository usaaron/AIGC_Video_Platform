"""Small, side-effect-free helpers used while compiling planning text.

Keeping these helpers outside the orchestration service makes their behavior
easy to review without changing the service's public API.  The service keeps
compatibility wrappers so callers and existing tests do not need to change.
"""

from __future__ import annotations

import re
from collections.abc import Iterable


def normalize_planning_punctuation(value: str) -> str:
    normalized = re.sub(r"\s+", " ", value).strip()
    normalized = re.sub(r"。+\s*[；;]+", "；", normalized)
    normalized = re.sub(r"[；;]+\s*。+", "。", normalized)
    normalized = re.sub(r"。{2,}", "。", normalized)
    normalized = re.sub(r"[；;]{2,}", "；", normalized)
    normalized = re.sub(r"。+\s*[，,]+", "，", normalized)
    return re.sub(r"[，,]+\s*。+", "。", normalized)


def bounded_planning_text(value: str, maximum: int) -> str:
    normalized = normalize_planning_punctuation(value)
    if len(normalized) <= maximum:
        return normalized
    return normalized[: maximum - 1].rstrip("；，。 ") + "。"


def planning_clause(value: str) -> str:
    normalized = re.sub(r"\s+", " ", value).strip()
    return re.sub(r"[，,。；;：:！？!?、\s]+$", "", normalized)


def join_planning_clauses(values: Iterable[str]) -> str:
    clauses = [
        clause
        for value in values
        if (clause := planning_clause(str(value)))
    ]
    return "；".join(clauses)
