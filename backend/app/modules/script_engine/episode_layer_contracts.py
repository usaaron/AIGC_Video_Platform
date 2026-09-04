from __future__ import annotations

import re
from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.script_delivery_contract import (
    ending_mode_requires_hook,
    EPISODE_DIALOGUE_LINE_MAX,
    EPISODE_DIALOGUE_LINE_MIN,
    EPISODE_RUNTIME_MAX_SECONDS,
    EPISODE_RUNTIME_MIN_SECONDS,
    EPISODE_SCENE_MAX,
    EPISODE_SCENE_MIN,
    EPISODE_SHOT_UNIT_MAX,
    EPISODE_SHOT_UNIT_MIN,
)


class EpisodeHookCategory(str, Enum):
    question = "疑问悬念"
    payoff_escalation = "爽点升级"
    reversal = "事实反转"
    relationship_shift = "关系变化"
    forced_choice = "强制选择"
    countdown = "倒计时"
    danger_escalation = "危机升级"


class EpisodePacingLayerContract(BaseModel):
    model_config = ConfigDict(extra="forbid")

    duration_seconds: int = Field(ge=EPISODE_RUNTIME_MIN_SECONDS, le=EPISODE_RUNTIME_MAX_SECONDS)
    scene_count: int = Field(ge=EPISODE_SCENE_MIN, le=EPISODE_SCENE_MAX)
    shot_count: int = Field(ge=EPISODE_SHOT_UNIT_MIN, le=EPISODE_SHOT_UNIT_MAX)
    dialogue_line_count: int = Field(
        ge=EPISODE_DIALOGUE_LINE_MIN,
        le=EPISODE_DIALOGUE_LINE_MAX,
    )
    average_shot_interval_seconds: float = Field(gt=0)
    dialogue_lines_per_minute: float = Field(gt=0)
    information_progression_count: int = Field(ge=1)
    information_progression_per_minute: float = Field(gt=0)
    meets_contract: bool


class EpisodeHookLayerContract(BaseModel):
    model_config = ConfigDict(extra="forbid")

    category: EpisodeHookCategory
    ending_hook_count: int = Field(ge=0, le=1)
    planned_hook_beat_count: int = Field(ge=0)
    planned_hook_beats_per_minute: float = Field(ge=0)
    has_next_episode_obligation: bool
    payoff_target_episode: int | None = Field(default=None, ge=1, le=2_000)
    meets_contract: bool


class EpisodeStoryLayerContract(BaseModel):
    model_config = ConfigDict(extra="forbid")

    causal_step_count: int = Field(ge=0, le=5)
    distinct_causal_step_count: int = Field(ge=0, le=5)
    continuity_anchor_count: int = Field(ge=0)
    character_count: int = Field(ge=0)
    story_line_count: int = Field(ge=0)
    local_resolution_planned: bool
    escalation_planned: bool
    causal_chain_complete: bool
    meets_contract: bool


class EpisodeThreeLayerContract(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: str = Field(default="episode_three_layer_contract.v1")
    pacing: EpisodePacingLayerContract
    hook: EpisodeHookLayerContract
    story: EpisodeStoryLayerContract
    meets_contract: bool


def compile_episode_three_layer_contract(item: Any) -> EpisodeThreeLayerContract:
    """Compile roadmap prose into deterministic contracts without another LLM call."""

    duration = int(item.target_duration_seconds)
    scenes = list(item.scene_execution_plan or [])
    progression_values = [
        item.protagonist_decision,
        item.reveal,
        item.episode_payoff,
        item.pressure_escalation,
        item.exit_state,
        *item.source_turning_points,
        *item.source_unit_story_beats,
        *(scene.turn_or_reveal for scene in scenes),
    ]
    progression_count = len(_distinct_narrative_values(progression_values))
    pacing_meets_contract = (
        EPISODE_RUNTIME_MIN_SECONDS <= duration <= EPISODE_RUNTIME_MAX_SECONDS
        and EPISODE_SCENE_MIN <= item.planned_scene_count <= EPISODE_SCENE_MAX
        and EPISODE_SHOT_UNIT_MIN <= item.planned_shot_count <= EPISODE_SHOT_UNIT_MAX
        and EPISODE_DIALOGUE_LINE_MIN
        <= item.planned_dialogue_line_count
        <= EPISODE_DIALOGUE_LINE_MAX
        and progression_count >= 4
    )
    pacing = EpisodePacingLayerContract(
        duration_seconds=duration,
        scene_count=item.planned_scene_count,
        shot_count=item.planned_shot_count,
        dialogue_line_count=item.planned_dialogue_line_count,
        average_shot_interval_seconds=round(duration / item.planned_shot_count, 2),
        dialogue_lines_per_minute=round(
            item.planned_dialogue_line_count * 60 / duration,
            2,
        ),
        information_progression_count=progression_count,
        information_progression_per_minute=round(progression_count * 60 / duration, 2),
        meets_contract=pacing_meets_contract,
    )

    requires_hook = ending_mode_requires_hook(getattr(item, "ending_mode", None))
    hook_values = (
        [
            item.reveal,
            item.pressure_escalation,
            *(scene.turn_or_reveal for scene in scenes),
            item.cliffhanger,
        ]
        if requires_hook
        else []
    )
    hook_beat_count = len(_distinct_narrative_values(hook_values))
    has_cliffhanger = bool(str(item.cliffhanger or "").strip())
    has_obligation = bool(str(item.next_episode_obligation or "").strip())
    has_resolution = bool(str(item.episode_payoff or "").strip()) and bool(
        str(item.exit_state or "").strip()
    )
    hook = EpisodeHookLayerContract(
        category=classify_episode_hook(item.ending_hook_type, item.cliffhanger),
        ending_hook_count=1 if requires_hook and has_cliffhanger else 0,
        planned_hook_beat_count=hook_beat_count,
        planned_hook_beats_per_minute=round(hook_beat_count * 60 / duration, 2),
        has_next_episode_obligation=has_obligation,
        payoff_target_episode=item.hook_payoff_target_episode,
        meets_contract=(
            has_cliffhanger and has_obligation and hook_beat_count >= 1
            if requires_hook
            else has_resolution
        ),
    )

    causal_values = [
        item.central_conflict,
        item.protagonist_decision,
        item.episode_payoff,
        item.pressure_escalation,
        item.exit_state,
    ]
    causal_step_count = sum(bool(str(value or "").strip()) for value in causal_values)
    distinct_causal_step_count = len(_distinct_narrative_values(causal_values))
    local_resolution_planned = bool(str(item.episode_payoff or "").strip())
    escalation_planned = bool(str(item.pressure_escalation or "").strip())
    causal_chain_complete = causal_step_count == 5 and distinct_causal_step_count >= 4
    story = EpisodeStoryLayerContract(
        causal_step_count=causal_step_count,
        distinct_causal_step_count=distinct_causal_step_count,
        continuity_anchor_count=len({
            *item.continuity_requirements,
            *item.source_turning_points,
            *item.source_unit_story_beats,
            *item.setup_refs,
            *item.payoff_refs,
        }),
        character_count=len(set(item.character_refs)),
        story_line_count=len(set(item.story_line_refs)),
        local_resolution_planned=local_resolution_planned,
        escalation_planned=escalation_planned,
        causal_chain_complete=causal_chain_complete,
        meets_contract=(
            causal_chain_complete
            and local_resolution_planned
            and escalation_planned
            and bool(item.character_refs)
        ),
    )
    return EpisodeThreeLayerContract(
        pacing=pacing,
        hook=hook,
        story=story,
        meets_contract=(
            pacing.meets_contract
            and hook.meets_contract
            and story.meets_contract
        ),
    )


def classify_episode_hook(
    ending_hook_type: str | None,
    cliffhanger: str | None,
) -> EpisodeHookCategory:
    rules = (
        (EpisodeHookCategory.reversal, r"反转|翻转|揭穿|真相|身份|原来|竟然"),
        (EpisodeHookCategory.payoff_escalation, r"爽点|打脸|胜利|反击|兑现|夺回|救出|赢得"),
        (EpisodeHookCategory.relationship_shift, r"关系|背叛|决裂|分道|信任|同盟|婚姻|亲子|恋人"),
        (EpisodeHookCategory.forced_choice, r"抉择|选择|二选一|必须决定|只能选"),
        (EpisodeHookCategory.countdown, r"倒计时|限时|截止|最后\d|仅剩|即将关闭"),
        (EpisodeHookCategory.question, r"疑问|谜|谁|为何|为什么|是否|未知|问号"),
        (EpisodeHookCategory.danger_escalation, r"危机|威胁|追杀|暴露|压力|因果|危险|失控"),
    )
    # The explicit hook label is the authorial intent. Only inspect the hook
    # prose when the label cannot be mapped, so incidental words such as
    # "真相" do not overwrite a deliberate relationship or choice hook.
    for candidate in (ending_hook_type, cliffhanger):
        text = str(candidate or "").strip()
        if not text:
            continue
        for category, pattern in rules:
            if re.search(pattern, text, re.IGNORECASE):
                return category
    return EpisodeHookCategory.danger_escalation


def _distinct_narrative_values(values: list[str | None]) -> set[str]:
    return {
        normalized
        for value in values
        if (normalized := _normalize_narrative_value(value))
    }


def _normalize_narrative_value(value: str | None) -> str:
    if not value:
        return ""
    return re.sub(r"[^\w\u3400-\u9fff]+", "", value.casefold())
