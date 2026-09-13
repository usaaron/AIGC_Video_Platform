"""Fixed planning inputs for a bounded real-model writing probe.

Planning approval below describes test fixtures, never a model-quality verdict.
Generated prose is persisted only as provisional, unconfirmed draft material.
"""

from __future__ import annotations

from datetime import datetime, timezone
import json
from typing import Any
from uuid import uuid4

from app.modules.script_engine.long_story_models import (
    EpisodeArtifactCreate,
    EpisodePlanGenerationItem,
    StoryBible,
    StoryPlanNode,
    StoryProject,
    StoryProjectWorkspaceSave,
)
from app.modules.script_engine.models import (
    ApprovedEpisodePlanContext,
    ApprovedStoryNodeContext,
    ScriptGenerationDraftRequest,
)
from scripts.run_cn_longform_acceptance import creative_intent
from scripts.real_generation_probe_continuity import project_probe_continuity


STRATEGY_ID = "strategy.cn_mainland.longform_knowledge_candidate.v2"
OVERSEAS_STRATEGY_ID = "strategy.tiktok.frontend_mvp.dark_romance.v1"
CHARACTER_REFS = ["character.su_wan", "character.gu_chenzhou", "character.zhou_ning"]
STORY_LINE_REF = "storyline.mine_evidence"
TITLE = "订婚宴迷局：三集真实正文抽样"
OVERSEAS_TITLE = "河湾镇酒会迷局：海外三集正文抽样"
OVERSEAS_NAMES = {"伊芙": "Eve Hart", "亚当": "Adam Cole", "诺拉": "Nora Reed"}
FIXTURE_VERSIONS = ("v1", "v2")
V2_TIME_RULE = (
    "所有时间均为矿区当地同一时区。付款截图为事故当日18:00；公司通报记载事故当日20:00发生事故，"
    "并声称作业持续到20:00。通报发布时间是次日08:00，不参与两小时时差比较。"
    "原始工单记载事故当日18:30停工；它与通报的持续作业主张矛盾，不等于证明实际事故时刻或修改者。"
)
V2_KNOWLEDGE_RULE = (
    "事故时间被修改属于作者层的故事前提，角色须逐步核实。第一集只查实两份可见材料的时间差；"
    "第二集发现来源之间的冲突；第三集签收人核验工单，不据此查明实际事故时刻、修改者或最终幕后主使。"
    "亚当暗查父亲不等于他已掌握完整真相。"
)


def fixture_metadata(version: str) -> dict[str, Any]:
    if version not in FIXTURE_VERSIONS:
        raise ValueError(f"Unknown probe fixture version: {version}")
    return {
        "version": version,
        "parent_version": "v1" if version == "v2" else None,
        "changes": ["explicit_time_comparison", "witness_contact_chain", "exterior_heading",
                    "author_and_character_knowledge", "historical_signature_date"] if version == "v2" else [],
    }


def _overseas_fixture(value: Any) -> Any:
    """Adapt the fixed scenario while retaining its structured episode contracts."""
    replacements = {
        "character.su_wan": "character.eve_hart",
        "character.gu_chenzhou": "character.adam_cole",
        "character.zhou_ning": "character.nora_reed",
        "relationship.su_gu": "relationship.eve_adam",
        "苏晚": "伊芙", "顾沉舟": "亚当", "周宁": "诺拉",
        "顾氏集团": "科尔矿业集团", "顾氏": "科尔矿业集团", "顾家": "科尔家族",
        "订婚宴": "订婚酒会", "宴会厅": "酒店宴会厅",
        "公共候车厅": "河湾镇长途车站候车厅", "事故公告": "公司事故通报",
    }
    if isinstance(value, str):
        for source, replacement in replacements.items():
            value = value.replace(source, replacement)
        return value
    if isinstance(value, list):
        return [_overseas_fixture(item) for item in value]
    if isinstance(value, dict):
        return {key: _overseas_fixture(item) for key, item in value.items()}
    return value


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _data(client: Any, method: str, path: str, payload: Any = None) -> dict:
    response = client.request(method, path, **({"json": payload} if payload is not None else {}))
    response.raise_for_status()
    return response.json()["data"]


def _plans(fixture_version: str = "v1") -> list[dict]:
    fixture_metadata(fixture_version)
    entries = [
        {
            "episode_number": 1,
            "episode_title": "收起名单",
            "episode_goal": "苏晚必须在订婚宴上保住证人身份并验证异常付款时间。",
            "entry_state": "订婚宴即将致辞，苏晚手持矿难付款截图与未公开证人名单，顾沉舟尚未看见名单。",
            "central_conflict": "公开截图能打击顾氏，但连同名单曝光会让无辜证人陷入危险。",
            "protagonist_decision": "苏晚收起证人名单，只逼顾沉舟当面核对截图上的付款时间。",
            "reveal": "顾沉舟用自己的手机调出公开事故公告，付款竟比公告中的事故发生时间早两小时。",
            "emotional_movement": "复仇冲动转为有戒心的核验。",
            "stage_opposition": "顾沉舟要求先核验材料，宾客催促致辞压缩苏晚的选择时间。",
            "episode_payoff": "苏晚保护了证人名单，并以两部手机的对照查实付款时间异常。",
            "pressure_escalation": "付款截图不足以证明造假，顾沉舟指出旧仓库原始工单才有交接时间。",
            "exit_state": "苏晚保有付款截图和未曝光的证人名单，两人确认付款早于公告事故时间，决定一起去旧仓库找原始工单。",
            "cliffhanger": "顾沉舟把旧仓库钥匙放在苏晚掌心：原始工单今晚就要转运。",
            "next_episode_obligation": "两人必须进入旧仓库找到原始工单，验证时间异常，不能重新发现付款早于事故这一事实。",
            "protagonist_cost": "苏晚放弃当众报复的机会，必须与仍不信任的顾沉舟合作。",
            "locations": ["订婚宴厅", "宴会厅侧廊", "酒店出口"],
            "scene_turns": ["苏晚在名单即将被投屏时拔下连接线。", "两部手机的付款与事故时间被当面比对。", "仓库钥匙和今晚转运的消息改变调查时限。"],
        },
        {
            "episode_number": 2,
            "episode_title": "原始工单",
            "episode_goal": "苏晚进入旧仓库找到原始工单并确认签收人线索。",
            "entry_state": "苏晚保有付款截图和未曝光的证人名单，两人确认付款早于公告事故时间，决定一起去旧仓库找原始工单。",
            "central_conflict": "工单装箱转运在即，顾沉舟想直接带走原件，苏晚坚持保留可核验的来源。",
            "protagonist_decision": "苏晚拍下箱号与封签后取出工单核验，再归还原件，只带走连续拍摄的证据影像。",
            "reveal": "原始工单记录的停工时刻与事故公告矛盾，签收人周宁是苏晚姐姐的旧同事。",
            "emotional_movement": "被迫合作转为有限信任。",
            "stage_opposition": "仓库转运倒计时迫使两人冒险取证，但直接偷走原件会破坏证据来源。",
            "episode_payoff": "工单影像连同箱号封签完成留存，时间异常有了独立原始记录支持。",
            "pressure_escalation": "周宁发来消息，要求苏晚独自带着工单影像到公共候车厅，否则拒绝作证。",
            "exit_state": "苏晚持有付款截图、保密名单和有来源记录的工单影像，已知签收人是周宁；两人约定由苏晚在公共候车厅见周宁，顾沉舟留在远处。",
            "cliffhanger": "苏晚收到周宁第二条消息：不要让顾家的人靠近我。",
            "next_episode_obligation": "苏晚必须按约在公共候车厅保护并询问周宁，顾沉舟不能突然变成被周宁信任的人。",
            "protagonist_cost": "苏晚为保留证据来源放弃带走原件，接下来必须承担单独接触证人的风险。",
            "locations": ["旧仓库门口", "旧仓库档案区", "旧仓库外"],
            "scene_turns": ["苏晚用上一集拿到的钥匙开门，先拍下待转运箱号。", "工单的停工时间与签收人被连续拍摄留存。", "周宁要求苏晚单独见面，顾沉舟被排除在会谈外。"],
        },
        {
            "episode_number": 3,
            "episode_title": "证人的条件",
            "episode_goal": "苏晚保护周宁的身份，核实原始工单并取得下一条调度记录线索。",
            "entry_state": "苏晚持有付款截图、保密名单和有来源记录的工单影像，已知签收人是周宁；两人约定由苏晚在公共候车厅见周宁，顾沉舟留在远处。",
            "central_conflict": "周宁担心影像公开会牵连家人，拒绝透露调度记录位置，苏晚不能用曝光身份逼供。",
            "protagonist_decision": "苏晚当面将备份影像中的周宁姓名遮盖，承诺核实事实后再商量公开方式。",
            "reveal": "周宁核对笔迹和箱号后确认工单真实，指出调度室留有同一天的值班记录，可核查谁改了事故时间。",
            "emotional_movement": "证人的恐惧转为谨慎合作。",
            "stage_opposition": "周宁对顾氏和记者均不信任，顾沉舟必须遵守约定保持距离。",
            "episode_payoff": "工单获得签收人本人核验，周宁在身份受保护的前提下提供值班记录位置。",
            "pressure_escalation": "值班记录次日将按旧档案程序移交，苏晚必须先找到有权调阅的人。",
            "exit_state": "周宁身份未公开且仍安全；苏晚持有已核验的工单影像和调度室值班记录位置，顾沉舟遵守距离约定，幕后主使仍未知。",
            "cliffhanger": "周宁写下调度室编号，提醒苏晚：调阅签字栏里还有你姐姐的名字。",
            "next_episode_obligation": "后续必须调查调度室值班记录及姐姐的调阅签字，不能立即揭露最终幕后主使。",
            "protagonist_cost": "苏晚承诺保护证人，暂时失去立刻公开完整证据链的自由。",
            "locations": ["公共候车厅入口", "公共候车厅长椅", "候车厅出口"],
            "scene_turns": ["苏晚让顾沉舟留在远处，独自坐到周宁面前。", "遮盖姓名的动作促使周宁核验工单笔迹和箱号。", "调度室编号与姐姐的签字引出下一步核查。"],
        },
    ]
    if fixture_version == "v2":
        first, second, third = entries
        first.update(
            reveal="顾沉舟用手机调出公司通报，两人核对同一时区的付款18:00与通报记载的事故发生时刻20:00，相差两小时；不拿次日08:00的通报发布时间作比较。",
            exit_state="苏晚保有付款截图和未曝光名单，两人只查实截图付款18:00早于通报记载的事故发生时刻20:00，未查明实际事故时间或造假者；苏晚持仓库钥匙，两人决定去旧仓库找原始工单，转运尚未发生。",
            next_episode_obligation="两人必须进入旧仓库核对原始工单与通报的持续作业主张，不能重复发现付款时间差或把它当成造假已被证实。",
            scene_turns=["苏晚在名单即将被投屏时拔下连接线。", "两部手机当面比对付款18:00与通报所载事故20:00，明确次日08:00只是发布时间。", "顾沉舟将钥匙交给苏晚，说明工单计划今晚转运但尚未转运，两人决定立即去仓库。"],
        )
        second.update(
            entry_state=first["exit_state"],
            reveal="两人拍到原始工单记载事故当日18:30停工，与公司通报声称持续作业到20:00的同一字段主张矛盾；工单签收人周宁是苏晚姐姐的旧同事，真实性仍待签收人核验。",
            episode_payoff="工单连同箱号封签完成连续拍摄，原件归还仓库原箱，两人查实两份记录对作业状态存在冲突，尚未确定实际事故时刻或修改者。",
            pressure_escalation="苏晚用姐姐生前留下的周宁号码发消息，自报身份并说明刚拍到有周宁签名的工单，未发送整份影像或名单；周宁收到后才要求她独自带影像到公共候车厅。",
            scene_turns=["苏晚用上一集拿到的钥匙开门，拍下待转运箱号；转运尚未发生。", "两人连续拍摄停工18:30及签收人，核对通报持续作业至20:00的主张后，把原件归还仓库原箱。", "两人走到仓库外，苏晚用姐姐生前留下的号码说明新拍工单，周宁回复候车厅见面条件，顾沉舟同意保持距离。"],
        )
        third.update(
            reveal="周宁核对影像笔迹和箱号，确认自己签收的工单及18:30停工记录，指出调度室当天值班记录可用于继续核查实际事故时间及修改过程；本集尚未证明谁修改或何时发生事故。",
            cliffhanger="周宁写下调度室编号，说明姐姐在矿难发生一周前曾签字调阅这批旧记录，签字不是死后新增，具体调阅原因仍待调查。",
            next_episode_obligation="后续调查调度室值班记录及姐姐生前一周的调阅签字，不把签字当成复活或死后活动，也不立即揭露最终幕后主使。",
            scene_turns=["苏晚让顾沉舟留在远处，独自坐到周宁面前。", "遮盖备份姓名的动作促使周宁核验工单笔迹和箱号，未修改留存的原始影像。", "周宁交出调度室编号并说明姐姐在矿难发生一周前签字，引出调阅原因的核查。"],
        )
    plans = []
    for entry in entries:
        locations = entry.pop("locations")
        turns = entry.pop("scene_turns")
        refs = CHARACTER_REFS if entry["episode_number"] == 3 else CHARACTER_REFS[:2]
        continuity_requirements = [
            "苏晚不以曝光无辜证人身份换取证据；已经获得的证据必须保留。",
            "顾沉舟可以协助核验，但不能替苏晚决定何时公开，也不能突然获得她的完全信任。",
            "尚未查明最终幕后主使，不能复活苏晚的姐姐或改写矿难这一已知事实。",
        ]
        if fixture_version == "v2":
            continuity_requirements.extend([
                V2_TIME_RULE, V2_KNOWLEDGE_RULE.replace("亚当", "顾沉舟"),
                "苏晚通过姐姐生前留下的号码先联系周宁并说明新拍工单，周宁才获知新证据；见面过程须在正文发生，不能仅记入账本。",
                "姐姐的调阅签字发生于矿难一周前；签字不证明她在死后活动。",
            ])
        plan = EpisodePlanGenerationItem(
            **entry,
            ending_mode="serial_hook",
            synopsis=entry["episode_goal"],
            locations=locations,
            target_duration_seconds=90,
            planned_scene_count=3,
            planned_shot_count=16,
            planned_dialogue_line_count=30,
            character_refs=refs,
            story_line_refs=[STORY_LINE_REF],
            continuity_requirements=continuity_requirements,
            source_turning_points=turns,
            ending_hook_type="事实反转",
            hook_payoff_target_episode=entry["episode_number"] + 1,
            scene_execution_plan=[
                {
                    "scene_number": index + 1,
                    "scene_heading": f"{'EXT.' if fixture_version == 'v2' and entry['episode_number'] == 2 and index in {0, 2} else 'INT.'} {location} - 夜",
                    "character_refs": [CHARACTER_REFS[0], CHARACTER_REFS[2]]
                    if entry["episode_number"] == 3 and index > 0 else refs,
                    "scene_objective": [entry["episode_goal"], entry["central_conflict"], entry["episode_payoff"]][index],
                    "visible_action": turns[index],
                    "turn_or_reveal": turns[index],
                    "dialogue_objective": ["让具体阻力迫使人物作出选择。", "通过核验与质疑推动证据发生可见变化。", "确认本集可见结果，并提出下一步明确义务。"][index],
                    "dialogue_line_target": 10,
                    "shot_target": [5, 5, 6][index],
                    "exit_state": turns[index] if index < 2 else entry["exit_state"],
                }
                for index, location in enumerate(locations)
            ],
        ).model_dump(mode="json")
        execution = ApprovedEpisodePlanContext.model_validate({
            key: value for key, value in plan.items()
            if key in ApprovedEpisodePlanContext.model_fields
        })
        plan["layer_contracts"] = execution.layer_contracts.model_dump(mode="json")
        plans.append(plan)
    return plans


def setup_probe(client: Any, release_region: str = "cn_mainland", *, fixture_version: str = "v1") -> dict:
    fixture = fixture_metadata(fixture_version)
    if release_region not in {"cn_mainland", "overseas"}:
        raise ValueError("release_region must be cn_mainland or overseas.")
    overseas = release_region == "overseas"
    title = OVERSEAS_TITLE if overseas else TITLE
    strategy_id = OVERSEAS_STRATEGY_ID if overseas else STRATEGY_ID
    suffix = uuid4().hex[:12]
    project_id = f"story_project.real_probe.{suffix}"
    intent = creative_intent()
    intent["title"] = title
    current_tags = {
        "hook.immediate_conflict": "hook.crisis_opening",
        "cliffhanger.unanswered_threat": "cliffhanger.new_threat",
    }
    if not overseas:
        intent["selected_tag_ids"] = [current_tags.get(tag, tag) for tag in intent["selected_tag_ids"]]
    intent["commercial_goal"]["summary"] = "以固定规划输入抽样检查八万字项目的前三集真实正文质量与连续性。"
    intent["platform_goal"]["target_duration_seconds"] = 90
    intent["request_metadata"] = {
        "source": "bounded_real_generation_probe.v1",
        "generation_planning": {
            "episode_count_mode": "custom", "total_episodes": 48,
            "target_total_characters": 80_000, "preferred_episode_duration_minutes": 1.5,
            "story_density": "balanced", "batch_size": 3,
        },
    }
    intent["character_contexts"].append({
        "character_ref": CHARACTER_REFS[2], "name": "周宁", "role": "矿难工单签收人、知情证人",
        "description": "苏晚姐姐的旧同事，谨慎怕连累家人，愿意在身份获得保护时核实工单；不是最终幕后主使。",
        "locked_fields": ["name", "role", "description"],
        "field_sources": {field: "user_provided" for field in ("name", "role", "description")},
    })
    if fixture_version == "v2":
        intent["free_creative_prompt"] = (
            "订婚宴上，调查记者苏晚准备公开矿难付款截图，发现连同证人名单投屏会危及无辜者。"
            "顾沉舟正暗查父亲，但尚未掌握完整真相，两人必须逐步核验材料，不能把怀疑当作已证实。"
        )
        intent["creative_brief"]["generation_notes"].extend([
            V2_TIME_RULE, V2_KNOWLEDGE_RULE.replace("亚当", "顾沉舟"),
        ])
    if overseas:
        intent = _overseas_fixture(intent)
        intent["title"] = title
        intent["audience_goal"]["summary"] = "面向英语观众的悬疑情感与复仇连载，故事设定于虚构英语矿业小镇河湾镇。"
        intent["platform_goal"]["platform_profile_id"] = "tiktok_frontend_mvp_v1"
        intent["platform_goal"]["objective"] = "海外英文对白短剧；创作者可见叙事为中文，英文台词逐句配中文对照。"
        intent["free_creative_prompt"] = "故事发生在虚构的英语矿业小镇河湾镇，采用英语社区的生活与职场语境，不映射具体国家法律。" + intent["free_creative_prompt"]
        intent["excluded_patterns"] = ["中国大陆地名与婚俗", "新增未经规划的秘密继承人", "缺少中文对白对照"]
        intent["creative_brief"]["generation_notes"].extend([
            "固定人物名：伊芙 = Eve Hart；亚当 = Adam Cole；诺拉 = Nora Reed。",
            "非对白文字统一简体中文，英文对白只写dialogues.text；同条生成chinese_translation和chinese_character_name。",
        ])
    resolution = _data(client, "POST", "/content-specs/resolve-creative-intent", intent)
    project = StoryProject(
        project_id=project_id, title=title, output_language="en" if overseas else "zh",
        content_spec_id=resolution["content_spec"]["id"],
        target_total_characters=80_000, planned_episode_count=48, default_batch_size=3,
    ).model_dump(mode="json")
    project = _data(client, "PUT", f"/story-projects/{project_id}", project)
    bible = StoryBible(
        story_bible_id=f"story_bible.real_probe.{suffix}", story_project_id=project_id,
        content_spec_id=project["content_spec_id"], status="approved", approved_at=_now(),
        project_title=title,
        core_premise="调查记者苏晚从订婚宴的一笔异常付款出发，追查姐姐死亡的矿难真相，并与暗查父亲的顾沉舟被迫合作。",
        series_goal="经过持续取证与保护证人，建立可公开核验的矿难证据链，同时保住无辜者的安全。",
        theme="真相必须经得起核验，复仇不能以无辜者为代价。",
        central_conflict="苏晚追求公开矿难真相，而顾氏的利益与证人的安全不断限制她能够采取的调查行动。",
        ending_direction="最终以可核验的证据揭示矿难掩盖链条，苏晚自主决定公开方式，顾沉舟承担协助取证的家族代价。",
        character_refs=CHARACTER_REFS,
        character_registry=[
            {"character_ref": ref, "name": name, "role": role}
            for ref, name, role in zip(CHARACTER_REFS, ["苏晚", "顾沉舟", "周宁"], ["女主角、调查记者", "男主角、矿业集团继承人", "工单签收人、知情证人"])
        ],
        story_lines=[{
            "story_line_id": STORY_LINE_REF, "title": "矿难证据链", "story_line_type": "main",
            "premise": "以付款时间、原始工单和证人核验逐步追查矿难事故时间被修改的事实。",
            "planned_resolution": "形成可独立验证的证据链，再查明并公开掩盖矿难的责任链。",
            "character_refs": CHARACTER_REFS,
        }],
        relationships=[{
            "relationship_id": "relationship.su_gu", "source_character_ref": CHARACTER_REFS[0],
            "target_character_ref": CHARACTER_REFS[1], "relationship_type": "订婚但互相提防",
            "initial_state": "苏晚怀疑顾沉舟知情，顾沉舟试图先核验证据。",
            "target_direction": "在遵守对方底线的具体行动中形成有限合作。", "locked": True,
        }],
        locked_facts=[
            "苏晚的姐姐已经死于矿难，不得复活。", "苏晚不牺牲无辜证人。",
            "顾沉舟暗中调查父亲，但前三集无人掌握最终幕后主使的完整真相。",
            "周宁是苏晚姐姐的旧同事和工单签收人，不是幕后主使。",
        ],
        avoid_patterns=intent["excluded_patterns"],
    ).model_dump(mode="json")
    if overseas:
        bible = _overseas_fixture(bible)
        bible["project_title"] = title
        bible["world_rules"] = [
            "故事发生在虚构英语矿业小镇河湾镇；采用英语社区文化，不引入中国大陆地名、称谓或婚俗。",
            "伊芙 = Eve Hart；亚当 = Adam Cole；诺拉 = Nora Reed；中文人物名与英文说话人一一对应。",
        ]
        bible = StoryBible.model_validate(bible).model_dump(mode="json")
    if fixture_version == "v2":
        bible["world_rules"].extend([
            V2_TIME_RULE, V2_KNOWLEDGE_RULE if overseas else V2_KNOWLEDGE_RULE.replace("亚当", "顾沉舟"),
        ])
    bible = _data(client, "PUT", f"/story-projects/{project_id}/story-bibles/{bible['story_bible_id']}/versions/1", bible)
    project = _data(client, "GET", f"/story-projects/{project_id}")
    node = StoryPlanNode(
        node_id=f"story_plan.real_probe.{suffix}.opening", story_project_id=project_id,
        story_bible_id=bible["story_bible_id"], story_bible_version=bible["version"],
        title="从付款异常到原始记录", narrative_purpose="建立第一段证据链和主角的调查底线，为后续追责主线制造新的行动压力。",
        synopsis="苏晚放弃在订婚宴公开证人名单，核对异常付款，进入旧仓库留存原始工单并保护证人，再循调度记录展开下一轮核查。",
        entry_state="苏晚只有付款截图和保密证人名单，与顾沉舟尚未建立合作。",
        central_conflict="及时取证与保护证人存在冲突，苏晚必须付出行动代价建立可靠证据链。",
        turning_points=["付款早于事故公告时间。", "原始工单指向周宁。", "证人核验后指向调度室记录。", "调度记录将揭示掩盖事故的操作环节。"],
        unit_story_beats=["订婚宴保护名单并核验付款。", "仓库留存原始工单。", "保护证人并核实签收。", "第四至八集围绕调度记录继续核查并形成第一段可验证证据链。"],
        unit_resolution="完成事故时间曾被修改的第一段可验证证据链。",
        handoff_pressure="责任追查仍缺少修改指令的源头，下一单元必须调查签批流程。",
        emotional_direction="复仇冲动转为有底线且可核验的调查。",
        exit_state="主角掌握第一段证据链并维持有限合作，但最终幕后主使和完整责任链尚未查明。",
        character_refs=CHARACTER_REFS, story_line_refs=[STORY_LINE_REF],
        estimated_episode_count=8, estimated_script_body_characters=13_333,
        planned_start_episode=1, planned_end_episode=8, expansion_status="episode_ready",
        status="approved", approved_at=_now(),
    ).model_dump(mode="json")
    if fixture_version == "v2":
        node["turning_points"][0] = "付款截图18:00早于通报记载的事故发生时刻20:00；次日08:00的发布时间不是比较对象。"
        node["turning_points"][1] = "原始工单18:30停工与通报声称持续作业至20:00相冲突；签收人周宁核验前不认定工单真实性。"
        node["unit_story_beats"][2] = "苏晚先发消息说明工单再赴约保护周宁，核验签收；姐姐调阅签字为矿难一周前。"
        node["unit_resolution"] = "第四至八集继续核验后形成事故时间修改的第一段可验证证据链；前三集只完成材料差异发现及工单签收核验。"
    if overseas:
        node = StoryPlanNode.model_validate(_overseas_fixture(node)).model_dump(mode="json")
    node = _data(client, "PUT", f"/story-projects/{project_id}/plan-nodes/{node['node_id']}/versions/1", node)
    source_plans = _plans(fixture_version)
    if overseas:
        source_plans = _overseas_fixture(source_plans)
    plans = [{**plan, "source_node_id": node["node_id"], "source_node_version": node["version"], "story_bible_version": bible["version"], "status": "approved"} for plan in source_plans]
    state = {"project": project, "bible": bible, "node": node, "plans": plans, "resolution": resolution, "intent": intent, "drafts": [], "workspace_revision": 0,
             "fixture": fixture, "release_region": release_region, "strategy_id": strategy_id, "canonical_names": OVERSEAS_NAMES.copy() if overseas else {"苏晚": "苏晚", "顾沉舟": "顾沉舟", "周宁": "周宁"}}
    strategy = _data(client, "GET", f"/generation-strategies/{strategy_id}")
    platform = _data(client, "GET", f"/platform-profiles/{intent['platform_goal']['platform_profile_id']}")
    if strategy["status"] != "active" or strategy["target_platform"].strip().casefold() != platform["platform_name"].strip().casefold():
        raise RuntimeError("The probe strategy is not active for the requested release region.")
    state["workspace"] = _workspace(state)
    state["workspace"] = project_probe_continuity(state["workspace"], bible)["workspace"]
    _save_workspace(client, state)
    return state


def _handoff(draft: dict) -> str:
    final = draft.get("scenes", [])[-1] if draft.get("scenes") else {}
    lines = [
        f"上一集可见结果：{(final.get('scene_causality') or {}).get('outcome') or draft.get('episode_goal', '')}",
        f"结尾转折：{final.get('turning_point', '')}",
        f"下一集问题：{draft.get('next_episode_question') or ''}",
    ]
    lines.extend(f"人物状态变化：{item.get('character_name', '')}；{item.get('change_summary', '')}；原因：{item.get('change_cause', '')}" for item in draft.get("character_state_updates", [])[-8:])
    lines.extend(f"未完成义务：{item.get('setup_payoff_ref', '')}；{item.get('next_required_step') or item.get('progress_summary', '')}" for item in draft.get("setup_payoff_updates", [])[-6:] if item.get("status") != "paid_off")
    return "\n".join(lines)[:3200]


def build_probe_request(state: dict, episode_number: int, previous_draft: dict | None) -> dict:
    if not 1 <= episode_number <= 3:
        raise ValueError("This fixed-input probe supports only episodes 1-3.")
    if (episode_number == 1) != (previous_draft is None):
        raise ValueError("A later probe episode requires the preceding generated draft.")
    project, bible, node = state["project"], state["bible"], state["node"]
    plan = state["plans"][episode_number - 1]
    approved_plan = ApprovedEpisodePlanContext.model_validate({key: value for key, value in plan.items() if key in ApprovedEpisodePlanContext.model_fields})
    node_context = ApprovedStoryNodeContext(
        node_id=node["node_id"], node_version=node["version"], title=node["title"],
        start_episode=1, end_episode=8, episode_position=episode_number,
        episode_function=plan["episode_goal"],
        **{key: node[key] for key in ("narrative_purpose", "entry_state", "central_conflict", "turning_points", "unit_story_beats", "unit_resolution", "handoff_pressure", "emotional_direction", "exit_state")},
    )
    bible_context = "\n".join([bible["core_premise"], bible["central_conflict"], *bible["world_rules"], *bible["locked_facts"]])
    preceding = state["workspace"]["episodes"]
    if [item["episodeNumber"] for item in preceding] != list(range(1, episode_number)):
        raise ValueError("The probe requires exactly the saved preceding episodes, without future drafts.")
    if previous_draft is not None and preceding[-1]["generationRun"]["draft_master_script"] != previous_draft:
        raise ValueError("The handoff must match the saved preceding draft.")
    projection = project_probe_continuity(state["workspace"], bible, {
        "characterRefs": plan["character_refs"], "storyLineRefs": plan["story_line_refs"],
        "setupPayoffRefs": [*plan.get("planned_setup_refs", []), *plan.get("planned_payoff_refs", [])],
    })
    checkpoint = projection["checkpoint"]
    if episode_number > 1 and (
        checkpoint is None or json.loads(checkpoint).get("through_episode_number") != episode_number - 1
    ):
        raise RuntimeError("The product checkpoint does not cover the preceding draft episode.")
    return ScriptGenerationDraftRequest(
        story_project_id=project["project_id"],
        agent_request_id=f"agent-request.{project['project_id']}.ep{episode_number}",
        content_spec_id=project["content_spec_id"], generation_strategy_id=state["strategy_id"],
        release_region=state["release_region"], output_language=project["output_language"], desired_scene_count=3,
        target_episode_duration_seconds=90, target_script_body_characters=1667,
        resolved_creative_context=state["resolution"]["resolved_creative_context"],
        episode_context={
            "generation_mode": "full", "memory_layer": "provisional", "episode_number": episode_number,
            "total_episodes": 48, "ending_mode": "serial_hook",
            "previous_episode_handoff": projection["previousEpisodeHandoff"],
            "previous_episode_question": previous_draft.get("next_episode_question") if previous_draft else None,
            "episode_instruction": "只生成当前集，遵守分集路线图和场景执行计划。开头两场回应上一集问题，已获证据不可遗忘或重复发现。",
            "relevant_character_refs": plan["character_refs"], "planned_story_line_refs": [STORY_LINE_REF],
            "approved_story_node": node_context.model_dump(mode="json"),
            "approved_episode_plan": approved_plan.model_dump(mode="json"),
            "story_bible_context": bible_context, "project_continuity_summary": None,
            "provisional_continuity_checkpoint": checkpoint,
            "memory_recall": projection["memoryRecall"],
            "canonical_character_names": state["canonical_names"],
            "canonical_character_name_sources": [f"{chinese} = {english}" for chinese, english in state["canonical_names"].items()],
            "batch_context": {"batch_number": 1, "start_episode": 1, "end_episode": 3, "batch_instruction": "连续生成开篇三集草稿，保持证据、人物底线与合作关系的因果承接。"},
        },
    ).model_dump(mode="json")


def _workspace(state: dict) -> dict:
    project, intent = state["project"], state["intent"]
    overseas = state["release_region"] == "overseas"
    names_text = "\n".join(f"{english} ({chinese}): 固定测试人物身份。" for chinese, english in state["canonical_names"].items())
    references = [{
        "id": f"reference.{project['project_id']}.names", "fileName": "fixed-probe-character-names.txt",
        "mimeType": "text/plain", "sizeBytes": len(names_text.encode("utf-8")),
        "purpose": "character_reference", "purposeNote": "固定测试人物中英姓名对应。",
        "extractedText": names_text, "originalCharacterCount": len(names_text), "truncated": False,
        "createdAt": project["created_at"],
    }] if overseas else []
    return {
        "id": project["project_id"], "title": project["title"], "titleSource": "user", "marketProfile": "overseas_tiktok" if overseas else "cn_mainland",
        "creativePrompt": intent["free_creative_prompt"], "referenceMaterials": references,
        "canonicalCharacterNames": state["canonical_names"],
        "selectedTagIds": intent["selected_tag_ids"], "customTags": [],
        "characters": [{"id": item["character_ref"].removeprefix("character."), "name": item["name"], "role": item["role"], "description": item["description"], "age": "", "gender": "", "background": "", "appearance": "", "source": "user"} for item in intent["character_contexts"]],
        "generationSettings": {"mode": "full", "episodeCountMode": "custom", "episodeCount": 48, "targetTotalCharacters": 80000, "preferredEpisodeDurationMinutes": 1.5, "storyDensity": "balanced", "batchSize": 3, "outputLanguage": project["output_language"], "sceneCount": 3, "failureRetryMode": "manual", "releaseRegion": state["release_region"], "customInstructions": "固定规划输入的三集真实正文抽样，生成结果尚待作者审阅。"},
        "episodes": [], "generationBatches": [], "activeEpisodeNumber": 1,
        "storyLines": [], "characterRelationships": [], "continuationHooks": [], "setupPayoffs": [], "continuityStates": [],
        "contentSpecId": project["content_spec_id"], "resolvedCreativeContext": state["resolution"]["resolved_creative_context"],
        "generationStrategyId": state["strategy_id"], "storyBibleVersion": state["bible"]["version"], "storyBibleStatus": "approved",
        "episodeRoadmapRequired": True, "episodeRoadmaps": state["plans"], "episodePlansReadyThrough": 3,
        "status": "idea", "createdAt": project["created_at"], "updatedAt": _now(),
    }


def _save_workspace(client: Any, state: dict) -> dict:
    revision = state["workspace_revision"] + 1
    state["workspace"]["updatedAt"] = _now()
    payload = StoryProjectWorkspaceSave(
        project_id=state["project"]["project_id"], revision=revision,
        client_instance_id="bounded_real_generation_probe.v1", workspace_payload=state["workspace"],
    ).model_dump(mode="json")
    saved = _data(client, "PUT", f"/story-projects/{state['project']['project_id']}/workspace", payload)
    state["workspace_revision"] = saved["revision"]
    return saved


def save_probe_artifact(client: Any, state: dict, episode_number: int, run: dict) -> dict:
    project_id = state["project"]["project_id"]
    artifact = EpisodeArtifactCreate(
        artifact_id=f"artifact.{project_id}.ep{episode_number}.draft", story_project_id=project_id,
        episode_number=episode_number, artifact_kind="draft", memory_layer="provisional",
        content_schema_version="script_generation_run.v1", content_payload=run,
        lineage_refs={"story_bible_id": state["bible"]["story_bible_id"], "story_plan_node_id": state["node"]["node_id"]},
        client_instance_id="bounded_real_generation_probe.v1",
    ).model_dump(mode="json")
    saved = _data(client, "POST", f"/story-projects/{project_id}/episodes/{episode_number}/artifacts", artifact)
    verified = _data(client, "GET", f"/story-projects/{project_id}/episodes/{episode_number}/artifacts/{saved['artifact_id']}")
    if verified["payload_checksum"] != saved["payload_checksum"] or verified["content_payload"] != run:
        raise RuntimeError("Persisted draft artifact did not round-trip unchanged.")
    draft = run["draft_master_script"]
    now = _now()
    episode = {"id": f"{project_id}.episode{episode_number}", "episodeNumber": episode_number, "status": "saved", "generationRun": run, "workingDraftJson": json.dumps(draft, ensure_ascii=False, indent=2), "hasLocalDraftEdits": False, "createdAt": now, "updatedAt": now, "artifactRefs": {"draft": {"artifactId": saved["artifact_id"], "artifactKind": "draft", "memoryLayer": "provisional", "artifactVersion": saved["artifact_version"], "payloadChecksum": saved["payload_checksum"], "createdAt": saved["created_at"]}}}
    state["workspace"]["episodes"] = [item for item in state["workspace"]["episodes"] if item["episodeNumber"] != episode_number] + [episode]
    state["workspace"]["episodes"].sort(key=lambda item: item["episodeNumber"])
    state["workspace"]["status"] = "draft"
    state["workspace"]["activeEpisodeNumber"] = episode_number
    state["workspace"] = project_probe_continuity(state["workspace"], state["bible"])["workspace"]
    saved_workspace = _save_workspace(client, state)
    reloaded = _data(client, "GET", f"/story-projects/{project_id}/workspace")
    if reloaded["revision"] != saved_workspace["revision"] or reloaded["workspace_payload"] != state["workspace"]:
        raise RuntimeError("Projected continuity workspace did not round-trip unchanged.")
    state["workspace"] = reloaded["workspace_payload"]
    state["drafts"] = [item["generationRun"]["draft_master_script"] for item in state["workspace"]["episodes"]]
    return saved
