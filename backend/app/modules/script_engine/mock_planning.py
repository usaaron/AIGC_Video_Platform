"""Deterministic offline planning fixtures, never a creative quality verdict."""
from __future__ import annotations

import json
import re
from typing import Any


def _line(prompt: str, label: str, default: str = "") -> str:
    for line in prompt.splitlines():
        if line.startswith(label):
            return line[len(label):].strip()
    return default


def _json_after(prompt: str, label: str, default: Any) -> Any:
    if label not in prompt:
        return default
    try:
        return json.JSONDecoder().raw_decode(prompt.split(label, 1)[1].lstrip())[0]
    except ValueError:
        return default


def _bullets(prompt: str, label: str) -> list[str]:
    if label not in prompt:
        return []
    result = []
    for line in prompt.split(label, 1)[1].strip().splitlines():
        if not line.startswith("- "):
            break
        result.append(line[2:])
    return result


def _bible(prompt: str) -> dict[str, Any]:
    from app.modules.script_engine.long_story_models import StoryBibleGenerationOutput

    supplied = prompt.split("Characters supplied by the user:\n", 1)[-1].split("\n\n", 1)[0]
    characters = [
        {"character_ref": match[1], "name": match[2], "role": match[3] or "主角"}
        for match in re.finditer(r"^- ([\w.:-]+): (.+?) \((.*?)\)", supplied, re.MULTILINE)
    ] or [{"character_ref": "character.mock.protagonist", "name": "演示主角", "role": "主角"}]
    refs = [item["character_ref"] for item in characters]
    return StoryBibleGenerationOutput(
        project_title="离线演示故事",
        core_premise="离线演示：主角发现记录之间存在差异，通过核验材料逐步追查原因。",
        series_goal="离线演示：保持人物和材料引用一致，完成从发现问题到核验结果的故事流程。",
        theme="离线演示：选择与责任",
        central_conflict="离线演示：主角需要核验记录，却必须同时处理材料缺失和合作关系中的分歧。",
        ending_direction="离线演示：主角完成材料核验并说明结果；正式作品的结局仍由作者确定。",
        character_refs=refs,
        character_registry=characters,
        world_rules=["离线演示内容仅供检查操作流程，正式创作需要作者确认。"],
        story_lines=[{
            "story_line_id": "storyline.mock.records",
            "title": "离线演示的记录核验",
            "story_line_type": "main",
            "premise": "主角逐步核验材料差异并追踪来源。",
            "planned_resolution": "材料核验完成，来源关系得到说明。",
            "character_refs": refs,
        }],
    ).model_dump(mode="json")


def _episode(prompt: str, number: int, *, previous: dict[str, Any] | None = None) -> dict[str, Any]:
    from app.modules.script_engine.long_story_models import EpisodePlanGenerationItem

    characters = _json_after(prompt, "Allowed character_refs:", None)
    if characters is None:
        characters = _line(prompt, "Character refs:").split("、")
    lines = _json_after(prompt, "Allowed story_line_refs:", None)
    if lines is None:
        lines = _line(prompt, "Story line refs:").split("、")
    previous = previous or _json_after(prompt, "Immediately preceding accepted checkpoint:", {})
    entry = previous.get("exit_state") or _line(prompt, "Segment entry state:") or _line(prompt, "Entry state:")
    result = f"离线演示中主角完成第{number}份材料的核验，保存本次核对结果。"
    pressure = f"第{number}份材料的来源仍需对照，主角带着结果继续核对下一份记录。"
    return EpisodePlanGenerationItem(
        episode_number=number,
        episode_title=f"演示核验{number}",
        synopsis=f"离线演示：主角接续已保存的信息，核验第{number}份材料并记录结果。",
        locations=["资料室"],
        episode_goal=f"离线演示中核对第{number}份材料，明确这一份材料的来源。",
        entry_state=entry or "离线演示中主角带着待核验材料进入资料室。",
        central_conflict="现有记录存在差异，主角需要与合作方核对材料来源。",
        protagonist_decision="主角决定保留原件，通过逐项比对查明材料之间的差异。",
        emotional_movement="从怀疑转为谨慎合作。",
        stage_opposition="材料信息不全，合作方要求先确认原始来源。",
        episode_payoff=result,
        pressure_escalation=pressure,
        exit_state=result,
        cliffhanger=pressure,
        next_episode_obligation=pressure,
        ending_hook_type="材料核验",
        character_refs=characters,
        story_line_refs=lines,
        source_turning_points=_json_after(prompt, "Required source_turning_points for this episode (copy exactly, no additions):", []),
        source_unit_story_beats=_json_after(prompt, "Required source_unit_story_beats for this episode (copy exactly, no additions):", []),
        continuity_requirements=["保留原件，后续核验沿用已确认的材料和人物引用。"],
    ).model_dump(mode="json")


def planning_mock_output(prompt: str, schema: dict[str, Any]) -> dict[str, Any] | None:
    if schema.get("title") == "AuthorConflictAssessment":
        return {"user_goal": "离线演示：按作者要求调整表达。", "conflicts": [], "options": []}
    if schema.get("title") == "StoryBibleGenerationOutput":
        return _bible(prompt)
    if "SINGLE EPISODE ROADMAP CONTRACT\n" in prompt:
        match = re.search(r"Create only Episode (\d+) of", prompt)
        if match:
            return _episode(prompt, int(match[1]))
    match = re.search(r"You are creating Episode Plans (\d+)-(\d+) for", prompt)
    if match:
        all_numbers = list(range(int(match[1]), int(match[2]) + 1))
        numbers = _json_after(prompt, "complete episode plan objects in this exact order:", all_numbers)
        previous = _json_after(prompt, "Minimal continuity checkpoint from the immediately preceding episode:", {})
        turning_points = _bullets(prompt, "Approved segment turning points (copy each verbatim into exactly one episode's source_turning_points):")
        beats = _bullets(prompt, "Approved unit-story beats (copy each verbatim into exactly one episode's source_unit_story_beats):")
        plans = []
        for number in numbers:
            item = _episode(prompt, number, previous=previous)
            index = all_numbers.index(number)
            item["source_turning_points"] = [value for offset, value in enumerate(turning_points) if offset * len(all_numbers) // max(1, len(turning_points)) == index]
            item["source_unit_story_beats"] = [value for offset, value in enumerate(beats) if offset * len(all_numbers) // max(1, len(beats)) == index]
            plans.append(item)
            previous = item
        return {"episode_plans": plans}
    return None
