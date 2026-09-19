"""Lossless prompt references; persisted plans and review evidence stay unchanged."""

from __future__ import annotations

import json
from collections.abc import Sequence
from typing import Any

from app.modules.script_engine.long_story_models import StoryBible, StoryPlanNode
from app.modules.script_engine.planning_source_inheritance import (
    planning_source_context as fallback_planning_source_context, render_planning_source_context,
)
from app.script_delivery_contract import SHORT_DRAMA_PACING_CONTRACT


CONFIRMED_EVENT_REVIEW_CONTRACT = """【已确认事件继承与审校修订范围合同】
parent_event_bindings 中 parent_event_index 是该节点 parent_node_id/parent_node_version 对应父级事件表从1开始的索引；child_event_indices 是本节点事件表索引。逐条将父事件完整原文与绑定的全部子事件核对：行动者、对象、前提、因果结果与时序必须完整保留。复合父句可拆为多个具体子事件，不因拆句或合理展开判遗漏；但索引覆盖只证明声明了来源，不能证明实际演出，不能掩盖换人、删动作、换结果或重复发生。没有绑定的旧节点沿用原文证据，不猜测缺失引用；技术根的子级无父事件表时空绑定正常。
先核对已确认来源与全层事件归属，再评价每段容量。不能只因待审节点各自梗概和退出自洽、范围和预算相加正确就判通过。
对已提供的确认梗概逐项核对核心事件：谁实施、作用于谁、什么地点/时机、先决条件、实际结果、第一次发生在哪个部分。人物首次入场、合作关系建立、能力或装备来源、决定关系走向的救援、受伤、围城和揭秘均属于可能影响后续成立的事件；尚待细分的父级可以概括普通执行细节，但不能因此删除或替换这些已定职责。
下面全层事件证据包含本组之外的同级与祖先，按实际集数与父级版本识别归属。父级对同一子级事件的概括是同一事件的层级表达，不是发生两次；前后同级若都把同一救援、袭击或首次揭秘写成当下新行动，则检查是否重复完成、先后倒置或复活已结束状态。后续引用既成事实、承接其影响或完成不同后果，不因提到同一事件而判重复。
确认梗概的明确先后必须与整层各段内部顺序和交接同时一致。全剧结局中的“已揭示/已获能力/已建立关系”是累计状态，不能当作末段首次执行时间；当前人物知道什么、能使用什么，要有已经发生的对应来源。批准总纲的概括省略不自动撤销梗概事件，明确批准的新修改只替换其明确改变的事实；原文旧矛盾不得覆盖该修改。
确有证据时可用 confirmed_event_missing、confirmed_event_order_conflict、confirmed_event_actor_conflict、confirmed_event_duplicate 或 confirmed_event_timing_conflict。summary指出具体源事件、受影响部分和相冲突的文本；缺少来源时不得宣称该来源已核对，也不把未提供的后代或普通细节判成核心事件缺失。
只对本组目标输出结论，但跨段问题必须说明关联部分和共同父级。全层遗漏的事件，优先在按源顺序应承接它的目标段指出缺口，不因缺口起于别组而忽略它对当前段的影响；不要求所有目标重复同一条全局指控。
修订建议按真实缺陷确定范围：仅本段措辞/执行错误且现有职责与边界正确时，保留有效范围和边界，修改最早偏离处并核对受影响后续；若救援重复、时序错位或职责本身跨错节点，先在共同父级最小协调相关兄弟的事件归属与交接，再更新受影响子级。不能一面要求原进入/退出不变，一面让建议新增或改写这些状态；错误边界不可当作必须保留的事实。
repair_instruction只能恢复有来源的已定事件、行动归属和先后，不给可被直接采用的新创意例子。不得把已定主角救援替给同伴，不能新增第二次袭击、反杀、首次揭秘、额外感情承诺、悔悟行动或公开表态来填充容量；若源只写含蓄表达、内心愧疚，就保留其程度。需要作者新决定时明确该缺口，不能替作者批准。
建议必须交代保留哪些有效事件、最早错误在哪里、改动哪些相关部分及应恢复的结果。禁止把尚未发生的结果直接写进退出状态冒充已经演出，也不能靠“再加三个节拍”、硬凑集数或全剧重写代替纠正事件归属。输出前对自己的建议再核对来源、行动者、时序、一次发生和修订范围；建议不得强化原错误或与自身的保留要求矛盾。
"""


def build_confirmed_event_review_context(
    story_bible: StoryBible,
    planning_source_context: dict[str, object] | None,
    active_nodes: Sequence[StoryPlanNode],
) -> str:
    """Keep complete ordered evidence visible even outside the sampled group.

    This is a prompt-only projection: node versions and author source remain
    unchanged. Explicit parent/predecessor references distinguish inherited
    summaries from duplicated events at the same level.
    """
    fields = (
        "node_id", "version", "parent_node_id", "parent_node_version",
        "predecessor_node_id", "predecessor_node_version", "sequence_order",
        "planned_start_episode", "planned_end_episode", "status", "expansion_status",
        "title", "narrative_purpose", "synopsis", "entry_state", "central_conflict",
        "turning_points", "unit_story_beats", "parent_event_bindings", "unit_resolution", "exit_state",
        "handoff_pressure", "character_refs", "story_line_refs", "setup_refs", "payoff_refs",
    )
    records = [node.model_dump(mode="json", include=set(fields)) for node in sorted(
        active_nodes,
        key=lambda node: (
            node.planned_start_episode or 2_001,
            -(node.planned_end_episode or 0), node.sequence_order, node.node_id, node.version,
        ),
    )]
    return (
        render_planning_source_context(
            planning_source_context if planning_source_context is not None else fallback_planning_source_context(story_bible),
        )
        + "\n" + CONFIRMED_EVENT_REVIEW_CONTRACT
        + "\n<complete_planning_event_evidence>\n"
        + json.dumps(records, ensure_ascii=False, separators=(",", ":"))
        + "\n</complete_planning_event_evidence>"
    )


def review_event_references(values: list[str], events: list[str]) -> list[int | str]:
    """Index only exact matches, retaining unknown/contradictory claims verbatim."""
    indices = {event: index for index, event in reversed(list(enumerate(events, 1)))}
    return [indices.get(value, value) for value in values]


def compact_review_episode(
    record: dict[str, Any], events: list[str], *, preceding_exit_state: str | None = None,
) -> dict[str, Any]:
    # Preserve every same-episode execution constraint and dramatic unit in its
    # original group/order. Only the exact source-event/state repetitions below
    # become references; apparent contradictions are essential review evidence.
    result = dict(record)
    for field in ("source_turning_points", "source_unit_story_beats"):
        if field in result:
            result[field] = review_event_references(result[field], events)
    # A contradictory entry is precisely the evidence an editor needs to see.
    # Only a byte-identical inherited state can be represented by a reference.
    if preceding_exit_state is not None and result.get("entry_state") == preceding_exit_state:
        del result["entry_state"]
        result["entry_state_inherits_previous_exit"] = True
    return result


REVIEW_REFERENCE_CONTRACT = (
    "审校数据采用无损引用：每个节点的因果节拍是从1开始编号的事件表。转折和逐集来源数组里的整数"
    "均指所属节点事件表中的完整原文；字符串则保留未匹配原文，须检查其是否冲突。"
    "entry_state_inherits_previous_exit=true 仅表示进入状态与上一集退出状态逐字相同，"
    "首集对应节点进入状态；未设置此标记时以显式entry_state为准，不能替它修正矛盾。"
    "这只是去除重复文本，引用本身不能证明事件已经执行。所有实际梗概、选择、后果和逐场证据仍须审校。"
)


SCENE_DIALOGUE_CAPACITY_REVIEW_CONTRACT = SHORT_DRAMA_PACING_CONTRACT + "\n" + (
    "【对白承载能力】已有逐场蓝图时，将 dialogue_objective、dialogue_line_target、"
    "character_refs 和整集 planned_dialogue_line_count 与可见行动、证据及退出状态一起审校。"
    "数量达标不证明对白有戏剧作用；核对计划中的口述在当下说给谁听、为什么必须说出来、"
    "已有场面能否持续承载所分配的对白，而不是只给口述冠以取证或工作备忘的用途。"
    "如果预算只能靠逐条复述已经可见的操作、登记事项、证据边界或后台限制填满，"
    "即使事实准确且行数达标，也标记 dialogue_capacity_mismatch 并判 needs_revision；"
    "指出具体集号、场次、对白目的与预算之间的冲突，修订应回到受影响的执行蓝图，"
    "不得让正文换措辞、拆句、虚构录音用途或增添未获准的交流对象来凑数。"
    "每集保留25–35句；若当前事件范围内确实无法兼容，明确指出需要修订的上游事件或执行蓝图边界，"
    "不能假称表达润色可以解决。独角戏、自我对话、必要证词、职业记录和情绪独白可以成立："
    "按其真实受众（可为自己、缺席者或未来听者）、当下目的及人物行为或观众理解的作用判断，"
    "不按说话人数、录音形式或固定台词数量一概否定，也不要求每句都产生关系反转。"
    "强情绪、短促对白、密集攻防本身不是问题；审查其动机、回应和推进，不能以需要更多安静留白为由否定。"
    "尚无逐场蓝图或旧数据缺少对白字段时，不能宣称对白承载能力已经通过，"
    "也不能只因未提供这些字段就判已有剧情失败。"
)


SAME_EPISODE_EXECUTION_REVIEW_CONTRACT = (
    "【逐集执行一致性必检】对本次每个目标叶节点，逐集检查所有已提供分集，再逐场核对；"
    "不能用多数分集成立、总体节奏良好或只找到全组最显著的一处问题，代替其余分集的实际检查。"
    "将同集 continuity_requirements、dramatic_units 的 trigger/choice/visible_consequence/"
    "change_type/evidence_hint、每场 forbidden_changes 与梗概、主角决定、回报、退出状态、"
    "visible_action、evidence_requirements、dialogue_objective 和对白目标同时对照。"
    "这些都是需要彼此核验的规划证据，不因字段名叫连续性要求或禁改就自动覆盖本集已经完成的行动。"
    "逐场判断现有行动与约束是否允许分配的发言量：明确规定全场所有可发言人物不开口，"
    "却分配正数对白，是同场执行冲突；片刻停顿、局部沉默、少数人物不回应或有真实目的的独白"
    "本身不构成冲突。解除沉默字样也不等于解决承载，仍须核对当下受众、立场、回应、选择与推进，"
    "不得以逐条报操作、共同确认已知状态或臆造录音用途凑满25–35句。"
    "同时核对在场人物可见可闻的公开事实与continuity_requirements中的知情边界；"
    "另外逐场核对 character_refs 与 visible_action、evidence_requirements 和 forbidden_changes："
    "character_refs 是当前可见/可闻人物中具有总纲登记ID的引用子集，不是本场全部临时演员名单，也不是调查对象或材料来源名单。"
    "须区分规划登记人物引用与批准行动中明确的临时功能角色：核查员、监督员等功能角色可在正文人物表中落实，"
    "不能仅因其未进入总纲登记表或character_refs就判定违规，不能要求往限定的ID字段塞入虚构编号，"
    "也不能借另一名已登记人物的 ref 代替其身份；已在批准行动和对白目的中明确的职务称谓可作为临时角色的稳定身份，"
    "跨场或跨集继续履行同一职务不自动要求新增姓名或升级为总纲核心人物。"
    "若不同称谓实际承担同一关键证词、关系推进或身份揭示，仍须核对其同一性与信息来源，不得用功能角色豁免实质矛盾。下落未明或仅被提及的人物"
    "不得因旧 capsule 的 alive/location/priority 自动列入本场。回忆、录音、远程、照片、档案等媒介出场"
    "需有批准路线的明确标识；没有标识时记录 scene_presence_conflict 并保留历史供修订，不自动重写。"
    "character_state_updates 只能登记 body_order 已演出的当前动作/状态变化；下落、地点和行动能力不能"
    "从早期来源集的动态状态推导。"
    "保密未公开信息不能令已在场见证的事件变成不知道。对照前后已实际完成的事件，区分"
    "已解除的旧限制、独立继续的另一项审查与仍待承担的代价，不让复制的旧约束复活已终止状态。"
    "如有冲突，在所属节点结论中指出具体集号、场次和互相矛盾的字段内容，修订从最早偏离处"
    "消除冲突并保留有效事实；不能把后集才发生的通知、揭示或结果提前当成本集修订前提。"
    "强情绪与密集交锋完全合法，每集25–35句继续保持；不能用长剧留白偏好缩减配额。"
    "旧数据缺少这些字段时，不据此编造约束，也不能宣称该项已经核验通过。"
)
