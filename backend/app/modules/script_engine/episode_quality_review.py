"""Deterministic, non-blocking review signals for episode dramatic evidence.

The checks in this module are deliberately phrased as review candidates. They
can show where a draft needs an editor's attention, but they cannot decide that
an episode is dramatically good or bad.
"""

from __future__ import annotations

import math
import re
from typing import Any

from app.modules.master_script.models import DraftMasterScript
from app.modules.script_engine.production_count_utils import (
    episode_production_counts,
)
from app.modules.script_engine.screenplay_duration import estimate_screenplay_duration
from app.script_delivery_contract import (
    EPISODE_DIALOGUE_LINE_MAX,
    EPISODE_DIALOGUE_LINE_MIN,
    EPISODE_RUNTIME_MAX_SECONDS,
    EPISODE_RUNTIME_MIN_SECONDS,
    EPISODE_SCENE_MAX,
    EPISODE_SCENE_MIN,
    EPISODE_SHOT_UNIT_MAX,
    EPISODE_SHOT_UNIT_MIN,
)


_ABSTRACT_MARKERS = (
    "推进当前阶段",
    "推进当前规划节点",
    "推进剧情",
    "取得阶段性结果",
    "承担明确代价",
    "事情变得更复杂",
    "the episode progresses",
    "escalates the pressure",
    "move the story forward",
    "pay the cost",
)

_MAX_EVIDENCE_MATCHES_PER_FIELD = 12
_MAX_REPORTED_DIALOGUE_LINES = 80
_MAX_REPORTED_DIALOGUE_RUNS = 20
_EvidenceRef = tuple[int, str, int]

_DIALOGUE_FUNCTION_RULES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("threat", ("威胁", "否则", "后果", "曝光", "杀了", "threat", "or else")),
    ("correction", ("纠正", "更正", "不是", "错了", "actually", "wrong")),
    ("refusal", ("拒绝", "不能", "不行", "别", "休想", "won't", "can't", "no")),
    ("admission", ("承认", "是我", "我做的", "admit", "i did it")),
    ("lie", ("撒谎", "说谎", "骗你", "谎话", "lie", "lying")),
    (
        "bargain",
        ("条件", "交换", "代价", "讨价", "如果", "就把", "deal", "in exchange"),
    ),
    ("request", ("请求", "要求", "请", "给我", "需要", "please", "need", "give me")),
    (
        "probe",
        ("试探", "真的吗", "你知道", "谁", "为何", "为什么", "why", "who", "really"),
    ),
    (
        "deflection",
        ("转移", "关你什么事", "别问", "换个话题", "none of your business"),
    ),
    ("silence", ("沉默", "停顿", "……", "...", "beat")),
    ("misread", ("误会", "你以为", "原来你", "you think", "misunderstood")),
)


def review_episode_dramatic_evidence(
    draft: DraftMasterScript,
    approved_episode_plan: Any | None = None,
) -> dict[str, Any]:
    """Return bounded review signals for a generated episode.

    Planning summaries are never used as body evidence. A text match means only
    that an editor has a useful place to inspect; it is not semantic proof.
    """

    plan = approved_episode_plan
    units = list(_plan_value(plan, "dramatic_units") or [])
    protagonist_cost = str(_plan_value(plan, "protagonist_cost") or "").strip()
    has_optional_design = bool(units or protagonist_cost)

    scenes = list(draft.scenes)
    scene_body = {
        scene.scene_number: _scene_body_entries(scene)
        for scene in scenes
    }
    unit_reviews: list[dict[str, Any]] = []
    unit_candidate_refs: dict[int, set[_EvidenceRef]] = {}
    for index, unit in enumerate(units):
        trigger = str(_plan_value(unit, "trigger") or "").strip()
        choice = str(_plan_value(unit, "choice") or "").strip()
        consequence = str(_plan_value(unit, "visible_consequence") or "").strip()
        evidence_hint = str(_plan_value(unit, "evidence_hint") or "").strip()
        choice_evidence, choice_evidence_total, choice_refs = _find_body_evidence(
            scene_body,
            choice,
        )
        (
            consequence_evidence,
            consequence_evidence_total,
            consequence_refs,
        ) = _find_body_evidence(
            scene_body,
            consequence,
        )
        hint_evidence, hint_evidence_total, hint_refs = _find_body_evidence(
            scene_body,
            evidence_hint,
        )
        has_distinct_evidence = _has_distinct_evidence(
            choice_refs,
            consequence_refs,
        )
        unit_candidate_refs[index] = choice_refs | consequence_refs | hint_refs
        candidates = sorted({
            evidence["scene_number"]
            for evidence in (
                *choice_evidence,
                *consequence_evidence,
                *hint_evidence,
            )
        })
        unit_reviews.append({
            "unit_index": index,
            "trigger": trigger,
            "choice": choice,
            "visible_consequence": consequence,
            "evidence_hint": evidence_hint or None,
            "candidate_scene_numbers": candidates,
            "choice_evidence": choice_evidence,
            "choice_evidence_total": choice_evidence_total,
            "consequence_evidence": consequence_evidence,
            "consequence_evidence_total": consequence_evidence_total,
            "evidence_hint_matches": hint_evidence,
            "evidence_hint_match_total": hint_evidence_total,
            "evidence_matches_truncated": any(
                (
                    choice_evidence_total > len(choice_evidence),
                    consequence_evidence_total > len(consequence_evidence),
                    hint_evidence_total > len(hint_evidence),
                )
            ),
            "has_distinct_choice_and_consequence_evidence": has_distinct_evidence,
            "status": (
                "candidate_found" if has_distinct_evidence else "review_required"
            ),
            "matching_is_semantic_proof": False,
        })

    cost_evidence, cost_evidence_total, _ = _find_body_evidence(
        scene_body,
        protagonist_cost,
    )
    cost_review = {
        "planned_cost": protagonist_cost or None,
        "candidate_scene_numbers": sorted({
            evidence["scene_number"] for evidence in cost_evidence
        }),
        "evidence": cost_evidence,
        "evidence_total": cost_evidence_total,
        "evidence_truncated": cost_evidence_total > len(cost_evidence),
        "status": (
            "not_provided"
            if not protagonist_cost
            else "candidate_found"
            if cost_evidence
            else "review_required"
        ),
        "matching_is_semantic_proof": False,
    }

    scene_reviews = [
        {
            "scene_number": scene.scene_number,
            "observable_action_count": len(scene.character_actions),
            "has_scene_outcome": bool(
                scene.scene_causality and scene.scene_causality.outcome.strip()
            ),
            "has_body_evidence": bool(scene_body[scene.scene_number]),
            "has_visible_change_candidate": _has_visible_change_candidate(scene),
        }
        for scene in scenes
    ]
    production_review = _production_count_review(draft)
    dialogue_review = _dialogue_function_review(draft)
    segmented_review = _segmented_change_review(
        draft,
        unit_candidate_refs,
    )
    missing_units = sum(
        review["status"] == "review_required" for review in unit_reviews
    )
    visible_change_missing = not any(
        item["has_visible_change_candidate"] for item in scene_reviews
    )
    cost_missing = cost_review["status"] == "review_required"
    design_evidence_status = (
        "not_applicable"
        if not has_optional_design
        else "review_required"
        if missing_units or cost_missing
        else "review_signal_ready"
    )
    review_reasons: list[str] = []
    if missing_units:
        review_reasons.append("dramatic_unit_evidence_missing")
    if cost_missing:
        review_reasons.append("protagonist_cost_evidence_missing")
    if visible_change_missing:
        review_reasons.append("visible_scene_change_missing")
    if production_review["status"] == "warning":
        review_reasons.append("production_count_out_of_range")
    if dialogue_review["status"] == "warning":
        review_reasons.append("dialogue_function_warning")
    if segmented_review["status"] == "review_required":
        review_reasons.append("segmented_change_evidence_missing")
    limitations = [
        "文本候选匹配不能证明人物选择造成了可见后果。",
        (
            "分段检查按正文顺序提供位置型信号，"
            "不能替代编导对段落功能的判断。"
        ),
        (
            "对白功能来自有限关键词，只用于定位重复风险，"
            "不能证明对白的真实功能。"
        ),
        "本报告是编导审阅信号，不是质量评分，也不阻断正文保存。",
    ]
    if not has_optional_design:
        limitations.insert(
            0,
            "没有本集戏剧单位或人物代价设计，已跳过设计证据审阅。",
        )
    return {
        "schema_version": "episode_quality_review.v1",
        "status": "review_required" if review_reasons else "review_signal_ready",
        "review_reasons": review_reasons,
        "design_evidence_status": design_evidence_status,
        "dramatic_unit_count": len(units),
        "candidate_unit_count": len(units) - missing_units,
        "review_required_unit_count": missing_units,
        "protagonist_cost": protagonist_cost or None,
        "protagonist_cost_review": cost_review,
        "unit_reviews": unit_reviews,
        "scene_reviews": scene_reviews,
        "production_count_review": production_review,
        "dialogue_function_review": dialogue_review,
        "segmented_change_review": segmented_review,
        "evidence_match_limit_per_field": _MAX_EVIDENCE_MATCHES_PER_FIELD,
        "limitations": limitations,
    }


def _plan_value(value: Any, field_name: str) -> Any:
    if isinstance(value, dict):
        return value.get(field_name)
    return getattr(value, field_name, None)


def _scene_body_entries(scene: Any) -> list[dict[str, Any]]:
    """Return only performable body units; planning summaries are excluded."""
    entries: list[dict[str, Any]] = []
    entries.extend(
        {
            "kind": "action",
            "index": index,
            "text": value.strip(),
        }
        for index, value in enumerate(scene.character_actions)
        if value and value.strip()
    )
    entries.extend(
        {
            "kind": "dialogue",
            "index": index,
            "text": dialogue.text.strip(),
        }
        for index, dialogue in enumerate(scene.dialogues)
        if dialogue.text and dialogue.text.strip()
    )
    return entries


def _find_body_evidence(
    scene_body: dict[int, list[dict[str, Any]]],
    phrase: str,
) -> tuple[list[dict[str, Any]], int, set[_EvidenceRef]]:
    if not phrase.strip():
        return [], 0, set()
    matches: list[dict[str, Any]] = []
    refs: set[_EvidenceRef] = set()
    total = 0
    for scene_number, entries in scene_body.items():
        for entry in entries:
            if _contains_evidence(entry["text"], phrase):
                total += 1
                refs.add((scene_number, entry["kind"], entry["index"]))
                if len(matches) < _MAX_EVIDENCE_MATCHES_PER_FIELD:
                    matches.append({
                        "scene_number": scene_number,
                        "kind": entry["kind"],
                        "index": entry["index"],
                        "text": entry["text"][:280],
                    })
    return matches, total, refs


def _has_distinct_evidence(
    choice_refs: set[_EvidenceRef],
    consequence_refs: set[_EvidenceRef],
) -> bool:
    return any(
        choice_ref != consequence_ref
        for choice_ref in choice_refs
        for consequence_ref in consequence_refs
    )


def _has_visible_change_candidate(scene: Any) -> bool:
    if not scene.character_actions:
        return False
    outcome = scene.scene_causality.outcome if scene.scene_causality else ""
    if not outcome.strip():
        return False
    normalized_outcome = outcome.casefold()
    return bool(_scene_body_entries(scene)) and not any(
        marker in normalized_outcome for marker in _ABSTRACT_MARKERS
    )


def _production_count_review(draft: DraftMasterScript) -> dict[str, Any]:
    scene_count, dialogue_count, action_count = episode_production_counts(draft)
    duration = estimate_screenplay_duration(draft)
    metrics = {
        "scene_count": scene_count,
        "dialogue_line_count": dialogue_count,
        "observable_action_unit_count": action_count,
        "estimated_duration_seconds": duration.total_seconds,
    }
    bounds = {
        "scene_count": {"minimum": EPISODE_SCENE_MIN, "maximum": EPISODE_SCENE_MAX},
        "dialogue_line_count": {
            "minimum": EPISODE_DIALOGUE_LINE_MIN,
            "maximum": EPISODE_DIALOGUE_LINE_MAX,
        },
        "observable_action_unit_count": {
            "minimum": EPISODE_SHOT_UNIT_MIN,
            "maximum": EPISODE_SHOT_UNIT_MAX,
        },
        "estimated_duration_seconds": {
            "minimum": EPISODE_RUNTIME_MIN_SECONDS,
            "maximum": EPISODE_RUNTIME_MAX_SECONDS,
        },
    }
    alerts: list[dict[str, Any]] = []
    for metric, limit in bounds.items():
        value = metrics[metric]
        if value < limit["minimum"] or value > limit["maximum"]:
            alerts.append({
                "metric": metric,
                "value": value,
                "minimum": limit["minimum"],
                "maximum": limit["maximum"],
                "severity": "warning",
            })
    return {
        "status": "warning" if alerts else "within_range",
        "metrics": metrics,
        "bounds": bounds,
        "alerts": alerts,
        "is_quality_gate": False,
    }


def _dialogue_function_review(draft: DraftMasterScript) -> dict[str, Any]:
    lines: list[dict[str, Any]] = []
    for scene in sorted(draft.scenes, key=lambda item: item.scene_number):
        dialogue_by_index = {
            index: dialogue for index, dialogue in enumerate(scene.dialogues)
        }
        ordered_indices = [
            int(reference.split(":", 1)[1])
            for reference in scene.body_order
            if reference.startswith("dialogue:")
            and reference.split(":", 1)[1].isdigit()
        ]
        if not ordered_indices:
            ordered_indices = list(dialogue_by_index)
        for index in ordered_indices:
            dialogue = dialogue_by_index.get(index)
            if dialogue is None:
                continue
            category, source = _classify_dialogue_function(
                dialogue.intent,
                dialogue.text,
            )
            lines.append({
                "scene_number": scene.scene_number,
                "dialogue_index": index,
                "category": category,
                "classification_source": source,
                "text": dialogue.text[:280],
            })

    category_counts: dict[str, int] = {}
    for line in lines:
        category = line["category"]
        category_counts[category] = category_counts.get(category, 0) + 1
    repeated_runs: list[dict[str, Any]] = []
    start = 0
    while start < len(lines):
        end = start + 1
        while end < len(lines) and lines[end]["category"] == lines[start]["category"]:
            end += 1
        if lines[start]["category"] != "other" and end - start >= 4:
            repeated_runs.append({
                "category": lines[start]["category"],
                "start_sequence": start,
                "end_sequence": end - 1,
                "line_count": end - start,
                "scene_numbers": sorted({
                    line["scene_number"] for line in lines[start:end]
                }),
            })
        start = end
    classified_line_count = sum(line["category"] != "other" for line in lines)
    classified_line_ratio = (
        round(classified_line_count / len(lines), 3) if lines else 0.0
    )
    alerts: list[dict[str, Any]] = []
    repeated_run_count = len(repeated_runs)
    if repeated_run_count:
        alerts.append({
            "type": "repeated_function_run",
            "severity": "warning",
            "run_count": repeated_run_count,
        })
    if len(lines) >= 4 and classified_line_ratio < 0.25:
        alerts.append({
            "type": "low_keyword_classification_coverage",
            "severity": "warning",
            "classified_line_ratio": classified_line_ratio,
        })
    return {
        "status": "warning" if alerts else "within_range",
        "line_count": len(lines),
        "category_counts": category_counts,
        "covered_categories": sorted(
            category for category in category_counts if category != "other"
        ),
        "classified_line_count": classified_line_count,
        "unclassified_line_count": len(lines) - classified_line_count,
        "classified_line_ratio": classified_line_ratio,
        "repeated_run_count": repeated_run_count,
        "repeated_runs": repeated_runs[:_MAX_REPORTED_DIALOGUE_RUNS],
        "repeated_runs_truncated": repeated_run_count > _MAX_REPORTED_DIALOGUE_RUNS,
        "alerts": alerts,
        "reported_line_count": min(len(lines), _MAX_REPORTED_DIALOGUE_LINES),
        "lines": lines[:_MAX_REPORTED_DIALOGUE_LINES],
        "line_details_truncated": len(lines) > _MAX_REPORTED_DIALOGUE_LINES,
        "classification_method": "bounded_keyword_candidates_v1",
        "is_quality_gate": False,
    }


def _classify_dialogue_function(intent: str, text: str) -> tuple[str, str]:
    combined = f"{intent} {text}".casefold()
    for category, markers in _DIALOGUE_FUNCTION_RULES:
        if any(_contains_marker(combined, marker) for marker in markers):
            return category, "intent_or_text"
    return "other", "unclassified"


def _contains_marker(value: str, marker: str) -> bool:
    normalized_marker = marker.casefold()
    if re.search(r"[a-z]", normalized_marker):
        return bool(re.search(
            rf"(?<![a-z0-9]){re.escape(normalized_marker)}(?![a-z0-9])",
            value,
        ))
    return normalized_marker in value


def _segmented_change_review(
    draft: DraftMasterScript,
    unit_candidate_refs: dict[int, set[_EvidenceRef]],
) -> dict[str, Any]:
    ordered_entries: list[dict[str, Any]] = []
    for scene in sorted(draft.scenes, key=lambda item: item.scene_number):
        scene_entries = _ordered_scene_body_entries(scene)
        for position, entry in enumerate(scene_entries):
            ordered_entries.append({
                "scene_number": scene.scene_number,
                "kind": entry["kind"],
                "index": entry["index"],
                "text": entry["text"],
                "is_scene_exit": position == len(scene_entries) - 1,
                "has_scene_outcome_candidate": _has_visible_change_candidate(scene),
            })
    segments: list[dict[str, Any]] = []
    segment_names = ("opening", "complication", "decision", "exit")
    total = len(ordered_entries)
    for segment_index, name in enumerate(segment_names):
        start = math.floor(total * segment_index / 4)
        end = math.floor(total * (segment_index + 1) / 4)
        entries = ordered_entries[start:end]
        scene_numbers = sorted({entry["scene_number"] for entry in entries})
        entry_refs = {
            (entry["scene_number"], entry["kind"], entry["index"])
            for entry in entries
        }
        design_units = [
            unit_index
            for unit_index, candidate_refs in unit_candidate_refs.items()
            if candidate_refs & entry_refs
        ]
        has_scene_exit_outcome = any(
            entry["is_scene_exit"] and entry["has_scene_outcome_candidate"]
            for entry in entries
        )
        has_action = any(entry["kind"] == "action" for entry in entries)
        has_change_candidate = bool(design_units) or has_scene_exit_outcome
        segments.append({
            "name": name,
            "body_start_index": start,
            "body_end_index": end - 1 if end > start else None,
            "body_entry_count": len(entries),
            "scene_numbers": scene_numbers,
            "has_action": has_action,
            "has_scene_exit_outcome_candidate": has_scene_exit_outcome,
            "candidate_unit_indices": sorted(set(design_units)),
            "status": (
                "evidence_candidate"
                if entries and has_action and has_change_candidate
                else "review_required"
            ),
            "position_based_signal": True,
            "matching_is_semantic_proof": False,
        })
    missing_segments = [
        segment["name"]
        for segment in segments
        if segment["status"] == "review_required"
    ]
    return {
        "status": "review_required" if missing_segments else "review_signal_ready",
        "body_entry_count": total,
        "segments": segments,
        "review_required_segments": missing_segments,
        "is_quality_gate": False,
    }


def _ordered_scene_body_entries(scene: Any) -> list[dict[str, Any]]:
    entries = _scene_body_entries(scene)
    by_reference = {
        f"{entry['kind']}:{entry['index']}": entry for entry in entries
    }
    ordered = [
        by_reference[reference]
        for reference in scene.body_order
        if reference in by_reference
    ]
    return ordered or entries


def _contains_evidence(scene_text: str, phrase: str) -> bool:
    normalized_phrase = _normalize(phrase)
    if not normalized_phrase:
        return False
    normalized_scene = _normalize(scene_text)
    if normalized_phrase in normalized_scene:
        return True
    tokens = _tokens(phrase.casefold())
    if len(tokens) < 2:
        return False
    scene_tokens = set(_tokens(scene_text.casefold()))
    matched = len(set(tokens) & scene_tokens)
    return matched >= max(2, math.ceil(len(tokens) * 0.5))


def _normalize(value: str) -> str:
    return re.sub(r"\s+", "", value.casefold())


def _tokens(value: str) -> list[str]:
    tokens: list[str] = []
    for chunk in re.findall(r"[a-z0-9_]{3,}|[\u4e00-\u9fff]{2,}", value):
        if re.fullmatch(r"[\u4e00-\u9fff]+", chunk):
            tokens.extend(chunk[index:index + 2] for index in range(len(chunk) - 1))
        else:
            tokens.append(chunk)
    return list(dict.fromkeys(tokens))
