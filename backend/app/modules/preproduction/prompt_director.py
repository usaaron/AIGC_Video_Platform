from __future__ import annotations

import re

from app.modules.master_script.models import CharacterProfile, DraftSceneCard
from .models import ActingDirection, PromptPlan, SceneDesign, StoryboardShot


def uses_multiple_shots(camera: str) -> bool:
    """Recognize editing directions without treating no-cut locks as edits."""
    description = camera.casefold()
    description = re.sub(
        r"(?:无需|不要|避免|禁止|没有|不|无|勿)(?:进行|使用|采用|发生|做|任何)*"
        r"(?:剪辑)?(?:切换|切镜|切至|切到|切回|切入|切出|闪切|跳切|硬切|切|反打|插入镜头|蒙太奇)",
        "", description,
    )
    description = re.sub(
        r"\b(?:no|without|do not|don't)\s+(?:(?:any|editing)\s+)?(?:cuts?|cutting|reverse shots?|montage)\b",
        "", description,
    )
    return bool(re.search(
        r"切(?:至|到|回|入|出)|闪切|跳切|硬切|反打|插入镜头|蒙太奇|(?:镜头|画面)切换"
        r"|\b(?:cut\s+(?:to|back|away)|hard cut|jump cut|cutaway|reverse shot|insert shot|montage)\b",
        description,
    ))


def derive_acting_direction(original: DraftSceneCard, shot: StoryboardShot) -> ActingDirection:
    """Turn narrative intent into behavior a performer and a video model can show."""

    causality = original.scene_causality
    objective = original.emotional_objective or (causality.goal if causality else original.purpose)
    obstacle = causality.conflict if causality else "场景中的阻力阻止人物直接完成目标。"
    stakes = (
        f"如果失败，{causality.outcome}无法发生。"
        if causality else f"如果失败，本场的变化无法成立：{original.beat_summary}"
    )
    if len(stakes) > 240:
        stakes = "失败代价以本场已有目标、阻力和结果为依据，通过可见行动体现，不新增剧情结果。"
    actions = [item.strip() for item in shot.action_sequence if item.strip()]
    beat_changes = actions[:4]
    business = actions[0] if actions else "保持与当前场景有关的身体任务。"
    if len(business) > 240:
        business = "依序完成本镜完整动作时序中的身体任务，保持原文物件控制与动作先后。"
    listening = (
        "说话前先出现短暂评估；未说话的人保持倾听和可见反应，不替台词抢戏。"
        if shot.dialogue else "用视线、呼吸和动作变化回应现场信息。"
    )
    physical = (
        f"以可见的重心、呼吸和身体动作承载“{original.emotional_shift}”；"
        "不直接做情绪表情。"
    )
    dialogue_count = sum(ref.startswith("dialogue:") for ref in shot.source_refs)
    line_delivery = (
        "台词先完成判断或行动，再把压力落到句尾；语气通过节奏和落词体现，不靠持续提高音量。"
        if dialogue_count
        else "没有台词时，让信息通过视线、呼吸、动作停顿和听者反应传递。"
    )
    emphasis = (
        "根据台词意图选择一个核心词承重，关键处留出短停顿；不要平均重读每个词。"
        if dialogue_count
        else "以动作开始、受阻和完成之间的停顿形成节奏。"
    )
    return ActingDirection(
        objective=objective,
        obstacle=obstacle,
        stakes=stakes,
        tactic="通过具体行动推进目标；阻力出现时改变策略，而不是重复同一种情绪。",
        beat_changes=beat_changes,
        subtext="台词与行动允许存在张力，潜台词通过停顿、视线和动作中断泄露。",
        business=business,
        listening_reaction=listening,
        physical_state=physical,
        line_delivery=line_delivery,
        emphasis_and_pause=emphasis,
        status_change=f"本镜结束时，场面从“{original.emotional_shift}”推进到“{original.turning_point or original.beat_summary}”。",
    )


def build_prompt_plan(
    original: DraftSceneCard,
    shot: StoryboardShot,
    visual_direction: str,
    characters: list[CharacterProfile] | None = None,
    design: SceneDesign | None = None,
) -> PromptPlan:
    # Scene references may be registry IDs; the immutable source body and cast
    # supply display names without guessing identity from list order or roles.
    references = list(dict.fromkeys([
        *(ref for ref in original.character_refs if not ref.startswith(("character.", "story-bible-"))),
        *(line.chinese_character_name or line.character_name for line in original.dialogues),
        *(character.name for character in characters or []
          if any(character.name in action for action in original.character_actions)),
    ]))
    # Spatial layout already has the same bound as scene_map. Cast names and
    # incoming/outgoing states have their own compiled sections; joining them
    # here would make otherwise valid long fields exceed this field's bound.
    scene_map = design.spatial_layout if design else original.scene_heading or original.setting_hint
    multi_shot = uses_multiple_shots(shot.camera)
    format_mode = "受控多镜头序列" if multi_shot else "单一连续镜头"
    contract = design.production_contract if design else None
    lighting = ((contract.lighting.strip() if contract else "")
                or "本场未单独指定灯光；依据正文环境与完整作者拍摄要求核对光源、方向和曝光，缺失事实不得补造。")
    optics = (shot.optics.strip() or (contract.optics.strip() if contract else "")
              or f"{shot.framing}；摄影机结果保持稳定，不在镜头中无理由漂移。")
    return PromptPlan(
        active_references=references,
        scene_map=scene_map,
        # An action may contain several successive events. The opening frame
        # must preserve their incoming state rather than depict them completed.
        first_frame=shot.continuity_in,
        format_mode=format_mode,
        optics=optics,
        lighting=lighting,
        timing=[f"动作区间 {index + 1}：{action}" for index, action in enumerate(shot.action_sequence)],
        physical_constraints=[
            "动作遵循重力、接触、惯性和地面摩擦。",
            "人物、道具和伤口状态在镜头内保持连续。",
            "动作必须有因果关系，不瞬移、不漂浮。",
        ],
        dialogue_rules=(
            ["只说引用中的指定台词，不增加台词。", "说话角色之外的人保持安静倾听，听者不动嘴，除非正文明确安排回应。",
             "每句原文只录制一条连续音轨；跨镜剪辑承接该音轨的切点，不重新从句首配音。",
             "中文对照仅供阅读，不入画、不配音；正文原本为中文时，仍按中文原句配音。"]
            if shot.dialogue else [
                "本镜没有新对白；仅在入镜承接明确要求时接续上一镜已经录制的音轨切点，不生成新句、不重新从句首配音。",
                "中文对照仅供阅读，不入画、不配音；正文原本为中文时，仍按中文原句配音。",
            ]
        ),
        positive_locks=[
            "保持正文事实、人物位置、视线关系和道具状态。",
            "角色通过目标和压力下的可见行为表演，不直接展示抽象情绪。",
        ],
        negative_locks=["不要额外人物、额外道具或未使用参考。", "不要字幕；除非正文明确要求，不要旁白。"],
    )


def compile_cinematic_prompt(
    original: DraftSceneCard,
    shot: StoryboardShot,
    visual_direction: str,
    design: SceneDesign | None = None,
    characters: list[CharacterProfile] | None = None,
) -> str:
    acting = shot.acting_direction
    plan = shot.prompt_plan
    source_order = []
    for ref in shot.source_refs:
        kind, index = ref.split(":")
        if kind == "dialogue":
            line = original.dialogues[int(index)]
            text = f"{ref} {line.character_name}: {line.text}"
            if line.chinese_translation:
                text += f"\n中文对照（仅阅读，不入画、不配音）：{line.chinese_translation}"
            source_order.append(text)
        else:
            source_order.append(f"{ref} {original.character_actions[int(index)]}")
    contract = design.production_contract if design else None
    shared = "\n".join(
        f"{label}：{getattr(contract, key)}" for key, label in [
            ("visual_style", "风格"), ("composition", "构图"), ("axis", "机位与关系轴"),
            ("continuity", "人物与道具连续性"), ("sound", "全场声音"),
            ("reference_rules", "参考约束"),
        ] if contract and getattr(contract, key).strip()
    )
    voices = source_voice_directions(original, shot, characters or [])
    sections = [
        ("场景上下文", f"{original.scene_heading or original.setting_hint}。{original.beat_summary}"),
        ("当前引用", "、".join(plan.active_references) or "本场正文人物"),
        ("参考绑定状态", "当前引用仅为正文人物名称，不代表已绑定参考图；人物、场景与道具图片均待绑定核对，不能据此承诺图像一致性。"),
        ("本场制作约定", shared),
        ("场景地图", plan.scene_map),
        ("正文引用顺序", "\n".join(source_order)),
        ("入镜承接", shot.handoff),
        ("首帧与空间调度", plan.first_frame),
        ("格式模式", plan.format_mode),
        ("镜头时长", f"当前分配 {shot.duration_seconds:g} 秒；动作和对白按先后或明确的同时关系执行，不用异常加速掩盖时长不足。"),
        ("光学", plan.optics),
        ("本镜光学例外", "本镜光学填写了独立设置，以上光学值替代全场默认；不叠加执行全场另一组光学值。" if shot.optics.strip() else ""),
        ("摄影机", shot.camera),
        ("动作时序", "；".join(plan.timing)),
        ("表演", "；".join(filter(None, [
            f"目标：{acting.objective}",
            f"阻力：{acting.obstacle}",
            f"利害：{acting.stakes}",
            f"策略：{acting.tactic}",
            f"身体任务：{acting.business}",
            f"倾听与反应：{acting.listening_reaction}",
            f"身体状态：{acting.physical_state}",
            f"台词表达：{acting.line_delivery}",
            f"重音与停顿：{acting.emphasis_and_pause}",
            f"本镜变化：{acting.status_change}",
            f"潜台词：{acting.subtext}",
            f"节拍变化：{'；'.join(acting.beat_changes)}",
        ]))),
        ("物理", "；".join(plan.physical_constraints)),
        ("灯光", plan.lighting),
        ("整体视觉方向（本场与本镜明确约定优先）", visual_direction if visual_direction.strip() else ""),
        ("对白约束", "；".join(plan.dialogue_rules)),
        ("人物声音档案", voices),
        ("音频", shot.sound),
        ("镜尾状态", shot.continuity_out),
        ("镜间剪辑", design.transition if design and design.transition.strip() else "镜间默认硬切，不使用溶解或淡入淡出；保持上一镜结束与本镜开场的状态承接。"),
        ("正向约束", "；".join(plan.positive_locks)),
        ("局部锁定", "；".join(plan.negative_locks)),
    ]
    return "\n".join(f"{title}\n{value}" for title, value in sections if value)


def source_voice_directions(
    original: DraftSceneCard, shot: StoryboardShot, characters: list[CharacterProfile],
) -> str:
    """Read only voice facts for speakers in this shot; names are not identities inferred from roles."""
    speakers = set()
    for ref in shot.source_refs:
        if ref.startswith("dialogue:"):
            line = original.dialogues[int(ref.split(":")[1])]
            speakers.update(filter(None, (line.character_name, line.chinese_character_name)))
    voices = []
    for character in characters:
        if character.name not in speakers or not character.acting_profile:
            continue
        profile = character.acting_profile
        parts = list(dict.fromkeys(value.strip() for key in ("voice", "permanentVoicePrompt")
                                   if isinstance(value := profile.get(key), str) and value.strip()))
        if parts:
            voices.append(f"{character.name}：{'；'.join(parts)}")
    if not voices:
        return ""
    return ("仅复用当前正文人物档案，不补造年龄、口音或声线；档案中的例句仅说明表达方式，不是待配音台词。\n"
            + "\n".join(voices))
