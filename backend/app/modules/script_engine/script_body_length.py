from dataclasses import dataclass


PREFERRED_MIN_RATIO = 0.80
PREFERRED_MAX_RATIO = 1.20
# Truncation and insufficient development are separate diagnostics. Neither
# authorizes padding or a new length-only repair loop.
TRUNCATION_FLOOR_RATIO = 0.25
BODY_SCALE_POLICY = "effective_body_80_120_v1"
BODY_SCALE_WARNING_PREFIX = "body_below_preferred_minimum:"


@dataclass(frozen=True)
class ScriptBodyLengthGuidance:
    reference_characters: int
    preferred_min_characters: int
    preferred_max_characters: int
    truncation_floor_characters: int


def script_body_length_guidance(reference_characters: int) -> ScriptBodyLengthGuidance:
    """Turn a series-average reference into broad, plot-first episode guardrails."""
    reference = max(1, round(reference_characters))
    return ScriptBodyLengthGuidance(
        reference_characters=reference,
        preferred_min_characters=max(1, round(reference * PREFERRED_MIN_RATIO)),
        preferred_max_characters=max(1, round(reference * PREFERRED_MAX_RATIO)),
        truncation_floor_characters=max(1, round(reference * TRUNCATION_FLOOR_RATIO)),
    )


def script_body_scale_prompt(guidance: ScriptBodyLengthGuidance) -> str:
    """One scale contract for full/compact first drafts and bounded repairs."""
    return (
        f"【正文规模合同】首稿瞄准reference={guidance.reference_characters}个有效字，"
        f"正常范围{guidance.preferred_min_characters}-{guidance.preferred_max_characters}（80–120%）。"
        "只统计scenes.character_actions与dialogues.text：NFKC规范化后计Unicode字母和数字，"
        "包括汉字；标点、空白、标题、场景说明、梗概、译文、表演意图、人物档案、状态账本和分镜均不计入。"
        f"低于{guidance.preferred_min_characters}是正文规模未达标，不能以剧情已完整或超过"
        f"{guidance.truncation_floor_characters}截断线宣称完全合格；80%是预警下沿，不是每集写作目标。"
        "写前按批准场景职责安排实际行动、阻力、人物回应和可见后果；写清谁在何处对谁或什么做了什么、"
        "对方怎样应对、导致什么可观察变化，不把真实因果过程压成摘要或孤立手势。"
        "口播字数、正文有效字数和成片时长是不同约束；动作不是旁白，不能把reference全部写成对白。"
        "保持25–35条有真实交流目的的对白、15–20个有效动作单元和75–115秒；"
        "只展开既有动作中必要的空间关系、物件操作、阻挡与后果，动作和对白可自然并行，"
        "必须先后发生的操作、阅读和反应仍要留时间，不得默认全部并行或修改估时数值掩盖超时。"
        "不得堆手势、空镜、同义重述、已知事实、规则播报或新增剧情凑字，不设逐场或逐句配额。"
        "若批准内容与时长无法同时支持规模，保留可用稿与真实缺口供验收记录，"
        "不得牺牲因果、对白数量或时长，也不得在最后一集补写历史欠额。"
    )


def record_script_body_scale(
    metadata: dict[str, object],
    *,
    actual_characters: int,
    guidance: ScriptBodyLengthGuidance,
    record_initial: bool = False,
) -> None:
    """Refresh deterministic status without resetting first-draft provenance."""
    below_minimum = actual_characters < guidance.preferred_min_characters
    if record_initial:
        metadata.setdefault("script_body_scale_initial_characters", actual_characters)
        metadata.setdefault("script_body_scale_initial_below_minimum", below_minimum)
    metadata.update({
        "script_body_scale_policy": BODY_SCALE_POLICY,
        "script_body_scale_status": (
            "below_minimum" if below_minimum else
            "above_reference_range" if actual_characters > guidance.preferred_max_characters
            else "within_range"
        ),
        "script_body_scale_warning": below_minimum,
        "script_body_shortfall_characters": max(0, guidance.preferred_min_characters - actual_characters),
        "script_body_reference_gap_characters": max(0, guidance.reference_characters - actual_characters),
    })
    metadata.setdefault("script_body_scale_repair_attempted", False)
    warnings = [
        warning for warning in metadata.get("mainland_acceptance_warnings", [])
        if isinstance(warning, str) and not warning.startswith(BODY_SCALE_WARNING_PREFIX)
    ]
    if below_minimum:
        warnings.append(f"{BODY_SCALE_WARNING_PREFIX}{actual_characters}/{guidance.preferred_min_characters}")
    metadata["mainland_acceptance_warnings"] = warnings
    metadata["mainland_acceptance_warning_count"] = len(warnings)
    if below_minimum or metadata.get("script_body_scale_initial_below_minimum"):
        metadata["first_model_pass_accepted"] = False
        metadata["first_pass_accepted"] = False
