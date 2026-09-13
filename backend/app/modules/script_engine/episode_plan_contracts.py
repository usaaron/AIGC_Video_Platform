"""Deterministic roadmap boundaries and approved-event allocation."""

from __future__ import annotations

import re
from collections import Counter

from app.modules.script_engine.long_story_models import (
    EpisodePlanGenerationItem,
    EpisodePlanItemDraftRequest,
    StoryBible,
    StoryPlanNode,
)
from app.modules.script_engine.planning_errors import StoryPlanningInputError
from app.script_delivery_contract import EndingMode, ending_mode_requires_hook


_EPISODE_TITLE_REPORT_PREFIXES = (
    "完成", "确认", "建立", "推进", "实现", "确保", "通过", "围绕", "利用",
    "依据", "确立", "落实", "直面", "处理", "追踪", "揭露", "启动", "形成",
    "将", "把", "在", "为",
)
_EPISODE_TITLE_PLANNING_SUFFIXES = (
    "目标", "任务", "计划", "阶段", "结果", "机制", "节点", "行动", "基础", "方向",
)


def episode_title_quality_issues(value: str | None) -> list[str]:
    title = re.sub(r"\s+", " ", value or "").strip()
    issues: list[str] = []
    parts = [part.strip() for part in title.split("｜")]
    if len(parts) == 2:
        english, chinese = parts
        if not 2 <= len(english) <= 80 or not re.fullmatch(r"[A-Za-z][A-Za-z0-9 &'’\-]*", english):
            issues.append("english_format")
        title = re.sub(r"\s+", "", chinese)
    elif len(parts) == 1:
        title = parts[0].replace(" ", "")
    else:
        return ["format"]
    if not 3 <= len(title) <= 10:
        issues.append("length")
    if re.search(r"[\d０-９，,。；;！？!?：:、·—–\-（）()【】\[\]《》]", title):
        issues.append("format")
    if title.startswith(_EPISODE_TITLE_REPORT_PREFIXES):
        issues.append("report_prefix")
    if title.endswith(_EPISODE_TITLE_PLANNING_SUFFIXES):
        issues.append("planning_suffix")
    if title in {"本集待命名", "本集关键行动", "关键行动", "剧情推进"}:
        issues.append("placeholder")
    return issues


def episode_title_identity(value: str | None) -> str:
    """Return the comparable title core for duplicate detection."""

    title = re.sub(r"\s+", " ", value or "").strip()
    parts = [part.strip() for part in title.split("｜")]
    if len(parts) == 2:
        title = parts[1]
    return re.sub(r"\s+", "", title).casefold()


def validate_episode_plan_predecessor(
    payload: EpisodePlanItemDraftRequest,
    *,
    node: StoryPlanNode,
) -> None:
    predecessor = payload.predecessor_plan
    if predecessor is None:
        return
    assert node.planned_start_episode is not None
    expected_episode = node.planned_start_episode - 1
    if expected_episode < 1 or predecessor.episode_number != expected_episode:
        raise StoryPlanningInputError(
            "Episode roadmap predecessor checkpoint must be the episode "
            "immediately before the approved leaf range."
        )


def _validate_approved_event_distribution(
    approved: list[str],
    assigned: list[str],
    *,
    require_complete: bool,
    label: str,
) -> None:
    counts = Counter(assigned)
    allowed = set(approved)
    missing = [value for value in approved if not counts[value]] if require_complete else []
    duplicated = [value for value in approved if counts[value] > 1]
    unknown = [value for value in assigned if value not in allowed]
    details = [
        name + "=" + repr(values)
        for name, values in (
            ("missing", missing),
            ("duplicated", duplicated),
            ("unknown", unknown),
        )
        if values
    ]
    if details:
        raise StoryPlanningInputError(
            f"Episode Plans must distribute every approved {label} "
            "verbatim exactly once; " + "; ".join(details)
        )


def validate_episode_plan_prefix(
    plans: list[EpisodePlanGenerationItem],
    *,
    node: StoryPlanNode,
    story_bible: StoryBible,
    require_complete: bool,
) -> None:
    if node.planned_start_episode is None or node.planned_end_episode is None:
        raise StoryPlanningInputError("Episode-ready node must define an episode range.")
    expected_end = (
        node.planned_end_episode + 1
        if require_complete
        else min(node.planned_end_episode + 1, node.planned_start_episode + len(plans))
    )
    expected_numbers = list(range(node.planned_start_episode, expected_end))
    actual_numbers = [item.episode_number for item in plans]
    if actual_numbers != expected_numbers:
        qualifier = "leaf range" if require_complete else "accepted prefix"
        raise StoryPlanningInputError(
            f"Episode Plans must cover the {qualifier} exactly in episode order."
        )
    if not plans:
        return

    # Prefixes must enforce the same finale boundary as complete roadmaps.
    # LongStoryService separately verifies the global project-ending boundary.
    misplaced_finales = [
        item.episode_number
        for item in plans
        if item.ending_mode != EndingMode.serial_hook
        and item.episode_number != node.planned_end_episode
    ]
    if misplaced_finales:
        raise StoryPlanningInputError(
            "season_finale/series_finale 只能出现在当前已批准剧情段的最后一集；"
            f" misplaced episodes={misplaced_finales!r}"
        )
    allowed_characters = set(story_bible.character_refs)
    if any(not allowed_characters.issuperset(item.character_refs) for item in plans):
        raise StoryPlanningInputError(
            "Episode Plan character_refs must exist in the Story Bible."
        )
    allowed_story_lines = {item.story_line_id for item in story_bible.story_lines}
    if any(
        not item.story_line_refs
        or not allowed_story_lines.issuperset(item.story_line_refs)
        for item in plans
    ):
        raise StoryPlanningInputError(
            "Every Episode roadmap item must reference at least one approved Story line."
        )
    for field, approved, label in (
        ("source_turning_points", node.turning_points, "segment turning point"),
        ("source_unit_story_beats", node.unit_story_beats, "unit-story beat"),
    ):
        _validate_approved_event_distribution(
            approved,
            [value for item in plans for value in getattr(item, field)],
            require_complete=require_complete,
            label=label,
        )


def episode_plan_diversity_issues(
    plans: list[EpisodePlanGenerationItem],
    *,
    focus_episode_number: int,
) -> list[str]:
    """Return exact-copy quality issues introduced by the focused episode.

    These checks intentionally remain narrow and deterministic. They trigger a
    compact creative repair, but never replace the hard planning contracts above.
    """

    focused = next(
        (
            item
            for item in plans
            if item.episode_number == focus_episode_number
        ),
        None,
    )
    if focused is None:
        return []
    earlier = [
        item
        for item in plans
        if item.episode_number < focus_episode_number
    ]

    issues: list[str] = []
    title = focused.episode_title or ""
    if title != "本集待命名":
        if episode_title_quality_issues(title):
            issues.append("episode_title")
        if episode_title_identity(title) in {
            episode_title_identity(item.episode_title or "")
            for item in earlier
            if item.episode_title not in {None, "本集待命名"}
        } and "episode_title" not in issues:
            issues.append("episode_title")
    if ending_mode_requires_hook(focused.ending_mode) and episode_title_identity(focused.cliffhanger) in {
        episode_title_identity(item.cliffhanger)
        for item in earlier
        if ending_mode_requires_hook(item.ending_mode)
    }:
        issues.append("cliffhanger")
    if episode_title_identity(focused.episode_payoff) in {
        episode_title_identity(item.episode_payoff) for item in earlier
    }:
        issues.append("episode_payoff")
    return issues


def episode_event_assignments(
    values: list[str],
    *,
    start_episode: int,
    end_episode: int,
) -> dict[int, list[str]]:
    episode_count = end_episode - start_episode + 1
    assignments = {
        episode_number: []
        for episode_number in range(start_episode, end_episode + 1)
    }
    if not values:
        return assignments
    for index, value in enumerate(values):
        target_offset = min(
            episode_count - 1,
            index * episode_count // len(values),
        )
        assignments[start_episode + target_offset].append(value)
    return assignments


def episode_item_event_assignment(
    values: list[str],
    *,
    accepted_plans: list[EpisodePlanGenerationItem],
    field_name: str,
    start_episode: int,
    end_episode: int,
    episode_number: int,
) -> list[str]:
    compiled = episode_event_assignments(
        values,
        start_episode=start_episode,
        end_episode=end_episode,
    )
    prefix_matches_compiled = all(
        getattr(item, field_name) == compiled[item.episode_number]
        for item in accepted_plans
    )
    if prefix_matches_compiled:
        return compiled[episode_number]

    used = {
        value
        for item in accepted_plans
        for value in getattr(item, field_name)
    }
    remaining = [value for value in values if value not in used]
    remaining_assignments = episode_event_assignments(
        remaining,
        start_episode=episode_number,
        end_episode=end_episode,
    )
    return remaining_assignments[episode_number]


def episode_source_assignments(
    node: StoryPlanNode,
    *,
    accepted_plans: list[EpisodePlanGenerationItem],
    episode_number: int,
) -> dict[str, list[str]]:
    assert node.planned_start_episode is not None
    assert node.planned_end_episode is not None
    return {
        field: episode_item_event_assignment(
            values,
            accepted_plans=accepted_plans,
            field_name=field,
            start_episode=node.planned_start_episode,
            end_episode=node.planned_end_episode,
            episode_number=episode_number,
        )
        for field, values in (
            ("source_turning_points", node.turning_points),
            ("source_unit_story_beats", node.unit_story_beats),
        )
    }
