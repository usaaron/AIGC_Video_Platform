"""Carry feasible planning details forward without certifying their execution."""

import json
from collections.abc import Iterable

from app.modules.script_engine.long_story_models import StoryPlanExecutionRequirement, StoryPlanNode
from app.modules.script_engine.planning_errors import StoryPlanningInputError


EXECUTION_REQUIREMENT_REVIEW_CONTRACT = (
    "【审校层级与执行承接】先按目标集是否提供实际分集草稿区分审查层级。"
    "尚无实际分集时，在已批准事件内能够落实、不改变事件归属和进入/退出边界的普通取回、携带、复制、通知或现场登记，"
    "属于待落实执行细节，不仅因上层未逐步描写就判needs_revision。"
    "将确有必要的细节写入execution_requirements，每项给出该节点内的episode_number、"
    "所属unit_story_beats的1起始source_event_index和具体instruction；同一事件合并为一项。"
    "后续首稿会收到这些要求，实际场景生成后须核验。没有必要时返回空数组，不为每个普通动作造清单。"
    "若有明确有效禁令、资源已销毁/失去、互不相容的同时占用、未授权新真相或必须改变已批准边界才能补齐，"
    "仍须判needs_revision，并指出不可同时成立的具体事实及为何不能在该事件内解决。"
    "同一保管人在不同时间从已有存放处取件，不自动构成更换所有者或凭空获得材料；"
    "也不能把此前在某集未取件理解成以后永久禁止取件。"
    "已经提供实际分集的集数不得转入execution_requirements：真实场景缺少必要前置仍是须修订的执行缺口。"
    "已确认的人物弧光、主支线收束或关键选择缺失属于上层职责缺失，不能借执行备注延后。"
    "这些合同是被审内容的标准，你只判断现有内容和承接要求，不重新编排整部故事。"
)


def validate_execution_requirements(
    requirements: Iterable[StoryPlanExecutionRequirement], node: StoryPlanNode,
    *, realized_episodes: set[int] | None = None,
) -> None:
    seen: set[tuple[int, int]] = set()
    for requirement in requirements:
        key = (requirement.episode_number, requirement.source_event_index)
        if key in seen:
            raise StoryPlanningInputError("Merge execution requirements for the same allocated event.")
        seen.add(key)
        if realized_episodes is not None and requirement.episode_number in realized_episodes:
            raise StoryPlanningInputError("An existing episode's execution gap cannot be deferred to future drafting.")
        development = next((item for item in node.episode_developments
                            if item.episode_number == requirement.episode_number), None)
        index = requirement.source_event_index - 1
        if (development is None or index >= len(node.unit_story_beats)
                or node.unit_story_beats[index] not in development.source_unit_story_beats):
            raise StoryPlanningInputError("Execution requirements must belong to an event allocated to that episode in the current node.")


def execution_requirements_prompt(
    requirements: Iterable[StoryPlanExecutionRequirement], *, episode_numbers: Iterable[int],
) -> str:
    numbers = set(episode_numbers)
    selected = [item.model_dump(mode="json") for item in requirements if item.episode_number in numbers]
    if not selected:
        return ""
    return (
        "\n\n本次分集须落实的审校执行承接（不是已经发生的事实）：\n"
        + json.dumps(selected, ensure_ascii=False, separators=(",", ":"))
        + "\n仅在对应批准事件内落实必要前置与可观察结果，不增加新故事事件或改变固定边界。"
        "若前段实际已经完成要求，承接其结果而不重复履行；若执行与真实有效限制冲突，不能靠备注将其写成已完成。"
        "动作落实到scene_execution_plan，continuity_requirements保留所需后续承接，不能只抄写本条指令。\n"
    )


def merge_model_execution_requirements(
    requirements: Iterable[StoryPlanExecutionRequirement], node: StoryPlanNode,
    *, realized_episodes: set[int],
) -> list[StoryPlanExecutionRequirement]:
    """Losslessly group separate model notes for the same allocated event.

    Validate every note before grouping so no invalid event or already-realized
    gap can be hidden by merging. External handoff inputs remain strict.
    """
    grouped: dict[tuple[int, int], list[str]] = {}
    for requirement in requirements:
        validate_execution_requirements([requirement], node, realized_episodes=realized_episodes)
        key = (requirement.episode_number, requirement.source_event_index)
        instructions = grouped.setdefault(key, [])
        if requirement.instruction not in instructions:
            instructions.append(requirement.instruction)
    return [StoryPlanExecutionRequirement(
        episode_number=episode, source_event_index=event, instruction="\n".join(instructions),
    ) for (episode, event), instructions in grouped.items()]
