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
from app.modules.script_engine.episode_presence import episode_scene_presence_issues
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
        if not 2 <= len(english) <= 80 or not re.fullmatch(r"[A-Za-z][A-Za-z0-9 &'’.,:;!?\-]*", english):
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


def validate_episode_setup_payoff_references(
    plans: list[EpisodePlanGenerationItem], *, node: StoryPlanNode, story_bible: StoryBible,
) -> None:
    """New episode refs reuse approved identities; scene outcomes are not new IDs."""
    allowed = set(node.setup_refs) | set(node.payoff_refs) | set(story_bible.major_setup_payoff_refs)
    for item in plans:
        for field in ("setup_refs", "payoff_refs"):
            unknown = [ref for ref in getattr(item, field) if ref not in allowed]
            if unknown:
                raise StoryPlanningInputError(
                    f"Episode {item.episode_number} {field} must copy approved setup/payoff references "
                    f"verbatim; do not paraphrase, split clauses, or use current actions as reference IDs: {unknown!r}. "
                    "Keep current actions in episode_payoff or scene_execution_plan; use [] when no approved reference applies."
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

    if getattr(node, "episode_developments", []):
        from app.modules.script_engine.episode_development_contract import validate_episode_developments
        validate_episode_developments(node)
        ownership = {entry.episode_number: entry for entry in node.episode_developments}
        for item in plans:
            expected = ownership[item.episode_number]
            for field in ("entry_state", "exit_state", "source_turning_points", "source_unit_story_beats"):
                if getattr(item, field) != getattr(expected, field):
                    raise StoryPlanningInputError(
                        f"Episode {item.episode_number} must preserve its approved episode_developments.{field}; "
                        "revise the actual scene events to fit the assigned episode, not just its references."
                    )

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
    character_names = {entry.character_ref: entry.name for entry in story_bible.character_registry}
    for item in plans:
        presence_issues = episode_scene_presence_issues(item, character_names=character_names)
        if presence_issues:
            raise StoryPlanningInputError(
                f"Episode {item.episode_number} 当前出场限制与场景人物冲突；"
                "请核对场内人物和已批准边界，保留历史与调查对象引用："
                + ", ".join(presence_issues)
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
    # The ordered terminal event defines this leaf's settlement boundary.
    # Claiming it in an earlier transport chunk exhausts the approved story and
    # forces later chunks to repeat it or trespass into the next leaf.
    terminal_beat = node.unit_story_beats[-1] if node.unit_story_beats else None
    if terminal_beat and any(
        terminal_beat in item.source_unit_story_beats
        and item.episode_number != node.planned_end_episode
        for item in plans
    ):
        raise StoryPlanningInputError(
            f"The terminal unit-story beat must be enacted and assigned in Episode {node.planned_end_episode}, "
            "not at an earlier transport-chunk boundary. Revise the actual event chain, "
            "not just its source references."
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
