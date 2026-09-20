from copy import deepcopy

from app.modules.quick_script.models import QuickSettings, QuickState, QuickPlan, QuickPlanContent, QuickEpisode
from app.modules.quick_script.engine import synopsis_hash, plan_content_hash, draft_body_hash
from app.modules.master_script.models import LLMGeneratedDraftMasterScript, DraftMasterScript, DraftSceneCard


def make_state(episode_count=2):
    state = QuickState(project_id="quick.fixture", revision=1, phase="writing", next_step="draft",
        settings=QuickSettings(episode_count=episode_count, target_total_characters=max(1000, episode_count * 600)),
        idea="林澈在档案室核对火灾证据，最后公开真相。", synopsis="林澈逐一核验档案原件，揭开火灾真相，在结局中公开证据保护证人。",
        synopsis_confirmed=True, plan_confirmed=True)
    episodes = []
    for number in range(1, episode_count + 1):
        episodes.append({"episode_number": number, "ending_mode": "series_finale" if number == episode_count else "serial_hook",
            "episode_title": f"核验记录{number}", "target_duration_seconds": 90, "planned_scene_count": 1,
            "planned_shot_count": 15, "planned_dialogue_line_count": 25,
            "episode_goal": "核对档案中的原始证据", "entry_state": "林澈带着原始档案进入房间",
            "central_conflict": "记录与证人说法出现明显矛盾", "protagonist_decision": "公开核验过程保护证人",
            "emotional_movement": "从犹豫转为坚定", "stage_opposition": "证人担心原件被篡改",
            "episode_payoff": "找到了记录中的原始印章", "pressure_escalation": "证据公开前需要确认保管人",
            "exit_state": "林澈完成档案核验并签名", "cliffhanger": None if number == episode_count else "档案末页出现隐藏的签名",
            "character_refs": ["character.lin"], "story_line_refs": ["main"], "execution_ready": True,
            "next_episode_obligation": None if number == episode_count else "继续核对隐藏签名的来源",
            "scene_execution_plan": [{"scene_number": 1, "scene_heading": "INT. 档案室 - 夜",
                "character_refs": ["character.lin"], "scene_objective": "逐一核对档案原件",
                "opposition": "原件存在明显破损", "information_shift": "发现签名指向真实保管人",
                "choice_or_cost": "林澈愿意承担公开风险", "evidence_requirements": ["原件中的签名可见"],
                "visible_action": "林澈打开原件逐页核对签名", "turn_or_reveal": "原件签名指向另一人",
                "dialogue_objective": "通过询问核实保管关系", "dialogue_line_target": 25, "shot_target": 15,
                "exit_state": "核验结果签名归档"}]})
    content = QuickPlanContent(title="档案真相", characters=[{"character_ref": "character.lin", "name": "林澈",
        "motivation": "查明火灾的真相", "fixed_identity": "档案调查员"}], fixed_facts=["原件必须留在档案室"],
        main_storyline="林澈核验档案并公开真相", opening="发现原始记录与证词不符", turning_points=["签名揭示真正保管人"],
        ending="完整证据公开保护了证人", episodes=episodes)
    state.synopsis_hash = synopsis_hash(state.synopsis)
    state.plan = QuickPlan(**content.model_dump(mode="json"), source_synopsis_hash=state.synopsis_hash,
                          content_hash=plan_content_hash(content))
    return state


def make_llm_draft(episode_number=1, total_episodes=2):
    raw = {"title": f"档案核验{episode_number}", "logline": "林澈在档案室核验原始证据并发现线索",
        "synopsis": "林澈逐项核验原始证据，通过比对签名确认记录的来源。", "hook": "原件末页出现隐藏签名",
        "episode_cast": ["林澈"], "locations": ["档案室"], "target_audience": "成年短剧观众", "target_platform": "中文竖屏短剧",
        "language": "zh", "tone": "suspenseful", "episode_goal": "核验档案中的原始证据", "target_duration_seconds": 90,
        "ending_mode": "series_finale" if episode_number == total_episodes else "serial_hook",
        "characters": [{"name": "林澈", "role": "调查员", "description": "谨慎专注于原始证据的年轻调查员", "motivation": "查明火灾真相保护证人"}],
        "character_state_updates": [{"character_name": "林澈", "current_goal": "核实原始证据", "emotional_state": "坚定",
            "change_summary": "已完成档案核验", "change_cause": "逐项比对原件签名", "evidence_scene_numbers": [1]}],
        "next_episode_question": None if episode_number == total_episodes else "隐藏签名属于哪位保管人？",
        "scenes": [{"scene_number": 1, "slug": "INT. 档案室 - 夜", "scene_heading": "INT. 档案室 - 夜",
            "setting": "INT. 档案室 - 夜", "purpose": "逐项核验档案的原始证据", "beat_summary": "林澈翻开档案核对原件签名",
            "emotional_shift": "从犹豫转为坚定", "emotional_objective": "确定原件中的签名来源", "character_refs": ["character.lin"],
            "character_actions": [f"林澈翻到第{i+1}页，把透明比对尺贴住纸面边缘，沿着破损处核对残留的原始签名。" for i in range(15)],
            "dialogues": [{"character_name": "林澈", "chinese_character_name": None, "intent": "低声核对",
                "text": f"第{i+1}项请对照原件核实后再保存。", "chinese_translation": None} for i in range(25)],
            "body_order": [f"action:{i}" for i in range(15)] + [f"dialogue:{i}" for i in range(25)],
            "turning_point": "原始签名指向真正的保管人",
            "scene_causality": {"goal": "核实原始档案", "conflict": "原始签名模糊不清", "outcome": "比对确认签名来源",
                "caused_by_scene_number": None, "causal_link": None},
            "cliffhanger": episode_number != total_episodes}]}
    return LLMGeneratedDraftMasterScript.model_validate(raw).model_dump(mode="json")


def make_draft(episode_number=1, total_episodes=2):
    raw = make_llm_draft(episode_number, total_episodes)
    for scene in raw["scenes"]:
        scene["setting_hint"] = scene.pop("setting")
    return DraftMasterScript(**raw, content_spec_id="quick.fixture", generation_strategy_id="strategy.quick_script.draft.v1")


def add_episode(state, episode_number=1, *, status="passed"):
    draft = make_draft(episode_number, state.settings.episode_count)
    value = QuickEpisode(episode_number=episode_number, draft=draft, initial_draft=deepcopy(draft), status=status,
        source_plan_hash=state.plan.content_hash, body_hash=draft_body_hash(draft),
        source_episode_hashes={str(e.episode_number): e.body_hash for e in state.episodes if e.episode_number < episode_number})
    state.episodes.append(value)
    return value
