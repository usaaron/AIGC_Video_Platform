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


def _decomposition(prompt: str) -> dict[str, Any]:
    """Offline transport fixture; production ranges must be model-authored."""
    match = re.search(r"Parent range: episodes (\d+)-(\d+)", prompt)
    if match is None:
        raise ValueError("Mock decomposition needs a parent range")
    start, end = map(int, match.groups())
    span = end - start + 1
    count = next(count for count in (4, 3, 2) if all(
        8 <= size <= 12 or size >= 16
        for size in [span // count, (span + count - 1) // count]
    ))
    ranges = []
    cursor = start
    for index in range(count):
        size = span // count + (index < span % count)
        ranges.append((cursor, cursor + size - 1))
        cursor += size
    turning_points = _json_after(prompt, "Parent turning points whose facts must be preserved:", [])
    characters = _line(prompt, "Allowed character_refs:").split("、")
    lines = _line(prompt, "Allowed story_line_refs:").split("、")
    bridge = "离线演示：原件与复印件的差异已记录，合作方同意核查经手过程。"
    movements = [
        ("原件核对", "主角取出保存的原件与复印件逐页核对，发现一页记录被遗漏；合作方要求保留原始装订，双方将差异单独登记并签字。", bridge,
         ["主角带着原件开始核验。", "复印件缺页使核对中断。", "双方保留原装订并另记差异。", "差异表签字后转查经手过程。"]),
        ("经手追溯", "双方走访资料经手人，核对交接登记和存放位置；经手人找到缺页的独立存档，补齐交接说明，主角公布核查结果并关闭当前争议。", _line(prompt, "Parent exit state:"),
         ["合作方出示交接登记寻找经手人。", "存放位置与记录不一致，引出独立存档。", "缺页找到，经手人补齐交接说明。", "主角公布核查结果并关闭当前争议。"]),
    ]
    movements.extend([
        ("证言复核", "资料保管人提出另一份签收说明，主角邀请双方共同复查口述与书面记录；一处时间差得到解释，但保管责任仍需当面确认。", "离线演示：证言时间差已澄清，双方等待保管责任确认。",
         ["资料保管人出示签收说明。", "口述与书面时间不一致。", "双方共同复查并解释时间差。", "说明留档，转入保管责任确认。"]),
        ("结果交付", "主角召集各方逐项确认核查结论，将遗漏的材料归档并交还原件；合作方签收结果，双方约定后续保管方式，本轮核验正式结束。", _line(prompt, "Parent exit state:"),
         ["主角召集各方核对结论。", "遗漏材料需要重新归档。", "原件交还，合作方签收结果。", "各方确定保管方式并结束核验。"]),
    ])
    children = []
    first_entry = (
        "离线演示：主角带着来源尚未核实的材料来到资料室。"
        if "technical root has no authored entry event" in prompt
        else _line(prompt, "Parent entry state:")
    )
    for index, ((first, last), (title, synopsis, result, beats)) in enumerate(zip(ranges, movements)):
        children.append({
            "title": f"离线演示：{title}", "narrative_purpose": f"离线演示：完成{title}。",
            "synopsis": synopsis, "entry_state": first_entry if index == 0 else children[-1]["exit_state"],
            "central_conflict": beats[1], "turning_points": [*(turning_points if index == 0 else []), beats[2]],
            "emotional_direction": "离线演示：从疑问转为有边界的合作。", "exit_state": _line(prompt, "Parent exit state:") if index == count - 1 else result,
            "unit_story_beats": beats, "unit_resolution": result, "handoff_pressure": beats[-1],
            "character_refs": characters, "story_line_refs": lines, "setup_refs": [], "payoff_refs": [],
            "estimated_episode_count": last - first + 1, "estimated_script_body_characters": 300 + index * 100,
            "planned_start_episode": first, "planned_end_episode": last,
            "decomposition_reason": "离线测试固定分段，仅验证流程，不代表正式作品的叙事容量。",
            "recommended_next_step": "episode_ready" if last - first + 1 <= 12 else "expand",
        })
    return {"children": children}


def planning_mock_output(prompt: str, schema: dict[str, Any]) -> dict[str, Any] | None:
    if schema.get("title") == "AuthorConflictAssessment":
        return {"user_goal": "离线演示：按作者要求调整表达。", "rewrite_scope": "preserve_unaffected_text", "conflicts": [], "options": []}
    if schema.get("title") == "StoryBibleGenerationOutput":
        return _bible(prompt)
    if schema.get("title") == "StoryPlanNodeDecompositionOutput":
        return _decomposition(prompt)
    if schema.get("title") == "StoryPlanQualityModelOutput":
        return {
            "overall_summary": "离线演示检查完成；此结果仅验证流程，不构成作品内容质量认可。",
            "evaluations": [{
                "node_id": match[1], "node_version": int(match[2]),
                "status": "pass", "summary": "离线演示节点，供操作流程验证。",
                "issue_codes": [], "repair_instruction": None,
            } for match in re.finditer(r"^NODE (\S+) v(\d+) \[", prompt, re.MULTILINE)],
        }
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
            # Offline fixture only: the closing event belongs to the leaf end.
            item["source_unit_story_beats"] = [
                value for offset, value in enumerate(beats)
                if (len(all_numbers) - 1 if offset == len(beats) - 1
                    else offset * len(all_numbers) // max(1, len(beats))) == index
            ]
            plans.append(item)
            previous = item
        return {"episode_plans": plans}
    return None
