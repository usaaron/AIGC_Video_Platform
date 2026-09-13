# 终审编辑器场景动作对白润色

编号：`script.post_editor`。状态：`源码默认关闭，启用且评估需要编辑时调用`。

来源：[backend/app/modules/script_engine/script_post_editor.py:1787](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/script_post_editor.py:1787)。符号：`ScriptPostEditor._build_prompt`。

保护剧情场次和状态，仅指定场景；含固定压力-行动-回报-升级循环措辞。

本页保留当前工作区原文，不是优化后的替代提示词，也不是某次模型调用的完整展开结果。

## 长文本阅读视图

按源码位置列出长字符串；静态文本按字符串值显示，花括号内动态表达式仅供识别，未执行。条件分支分别列出，不代表一次调用全部生效。短标签、拼装顺序和完整条件见后面的源码原文。

### 片段 1 · 源码第 1805 行

````text
你现在同时是剧本大师和语言大师。{OVERSEAS_EPISODE_LANGUAGE_WORKFLOW_CONTRACT}所有可见叙事字段必须保持简体中文；动作、画面描述和intent中提到人物时只使用对应中文名，不得混入英文名；character_name保持原稿中的稳定英文连续性人物标识，不得擅自改名；每条dialogue.chinese_character_name同时写该说话人的稳定中文名。最终展示层会统一输出中文名（ENGLISH NAME）。逐句检查并润色英文对白，使其符合美国短剧的口语、节奏、打断、反击和潜台词习惯。只优化语言表达，不得改变剧情内容、人物意图、事实、关系、信息量、语气强弱、剧情顺序或结尾钩子。当前字段只写润色后的英文对白；每条dialogue.chinese_translation同时写该条最终英文dialogue.text准确、自然的简体中文对照。英文一旦修改，中文对照必须同步更新，两者逐句保留动作主体、对象、否定、时态、可能性和后果严重程度；数量词及其所指对象必须对应，不能把两个时间改写成两件事情。不得将可能受伤译成必然死亡。不得把明确执行者的具体行为改写为无主体的结果，也不得擅自补出原句未指明的执行者；屏幕、材料和受众的指代须与当前动作一致。不要在同一个dialogue.text中混写中英版本。
````

### 片段 2 · 源码第 1824 行

````text
动作与画面描述保持简体中文；人物名和人物对白直接使用简体中文。dialogue.chinese_character_name和dialogue.chinese_translation填写null；不得生成英文人物名、英文对白或中英对照，不得触发海外英文润色或翻译要求。
````

### 片段 3 · 源码第 1838 行

````text
。海外路径的character_name必须逐字沿用对应英文名，禁止改名、音译、缩写、大小写改写或用模型重新起名；动作和intent只能写对应中文名。中文路径仍使用中文人物名。
````

### 片段 4 · 源码第 1842 行

````text
采用自然、可表演的短剧口语，以及短句、打断、反击和潜台词节奏；不得拆句、重复或添加解释性台词凑数。
````

### 片段 5 · 源码第 1846 行

````text
25–35句台词必须共同支撑75–115秒真实表演时长，不能全部压成口号或单词式短句；用潜台词、打断、试探和反击承载信息，不得用复述或说明凑量。
````

### 片段 6 · 源码第 1850 行

````text

当前待修正文仍有以下问题，必须全部修正：
-
````

### 片段 7 · 源码第 1882 行

````text

本轮时长预算按实际可编辑场景计算，数值均为估算秒数：未提供的固定场景约{fixed_duration}秒，可编辑场景当前合计约{editable_duration}秒，本轮可编辑场景目标合计约{duration_budget['editable_target']}秒，优先落在{duration_budget['editable_preferred_min']}–{duration_budget['editable_preferred_max']}秒，允许范围为{duration_budget['editable_min']}–{duration_budget['editable_max']}秒。这些是本轮所有可编辑场景的合计额度，不是每场额度，也不是整集额度；不得把未提供的固定场景时长重新分配给补丁。估算时对白与动作取较长轨道并包含场景转换，二者通常并行；动作文字不是旁白，中英对白对照也不能重复计时，不能按总文字量等比例扩写或删减。
````

### 片段 8 · 源码第 1896 行

````text

本轮是定量压缩：当前整集估算为{current_seconds}秒。只在可编辑场景中削减约{current_seconds - target_duration}秒，优先削减{current_seconds - EDITOR_PREFERRED_DURATION_MAX_SECONDS}–{current_seconds - EDITOR_PREFERRED_DURATION_MIN_SECONDS}秒；最少需减{current_seconds - EDITOR_DURATION_MAX_SECONDS}秒，最多可减{current_seconds - EDITOR_DURATION_MIN_SECONDS}秒，整集合并后必须落到{EDITOR_DURATION_MAX_SECONDS}秒以内，且不得低于{EDITOR_DURATION_MIN_SECONDS}秒。保持场景、台词条数和镜头条数不变；优先删除复述、同义重复和不推进冲突的修饰，不得删除剧情事实、人物行动、关键反应或结尾钩子。
````

### 片段 9 · 源码第 1910 行

````text
当前稿件明显超时，本轮是硬压缩而不是润色：先缩短每句台词和动作描述中的冗余表达，再做等量替换；必须保留生产计数，但不能保留原句的解释性重复。
````

### 片段 10 · 源码第 1915 行

````text

本轮是定量补足：当前整集估算为{current_seconds}秒。只在可编辑场景中增加约{target_duration - current_seconds}秒，优先增加{EDITOR_PREFERRED_DURATION_MIN_SECONDS - current_seconds}–{EDITOR_PREFERRED_DURATION_MAX_SECONDS - current_seconds}秒；最少需增{EDITOR_DURATION_MIN_SECONDS - current_seconds}秒，最多可增{EDITOR_DURATION_MAX_SECONDS - current_seconds}秒。达到目标后停止扩写，不得把最低增量当作无上限补写许可。保持场景、台词条数和镜头条数不变；只在原有剧情事实内增加动作反应、打断、潜台词和事件后果，不得新增剧情或人物。
````

### 片段 11 · 源码第 1982 行

````text
本集是连载集：不得削弱原稿的结尾义务；最后可见动作或最后一句对白必须真正执行原稿的cliffhanger和next_episode_question，并让观众明确感到下一集必须发生什么。
````

### 片段 12 · 源码第 1985 行

````text
本集是收束集：不得为了制造公式化悬念新增cliffhanger或next_episode_question；最后可见动作或最后一句对白必须完成原稿已批准的结算、主要冲突回收和可见后果。如原稿的next_episode_question为空，保持为空。
````

### 片段 13 · 源码第 1990 行

````text
Market path: {market_path}
你是剧本大师工作流中的终审编剧。DeepSeek已经完成一集完整初稿。
你的任务只是在不改变剧情事实、人物关系、伏笔、连续性结果、场景数量、场景顺序、场景标题和结尾义务的前提下，优化每场的可拍动作与人物对白。

当前项目规则：
1. 单集最终成片范围为{EDITOR_DURATION_MIN_SECONDS}–{EDITOR_DURATION_MAX_SECONDS}秒，内部安全目标为{EDITOR_PREFERRED_DURATION_MIN_SECONDS}–{EDITOR_PREFERRED_DURATION_MAX_SECONDS}秒，本集目标约{target_duration}秒；当前待修正文稿估算约{current_duration.total_seconds}秒。若当前初稿已在范围内，必须保持在范围内，不得为了润色压缩有效动作或对白。
2. 本集必须保留原稿的场景数量，且总数只能为{EPISODE_SCENE_MIN}–{EPISODE_SCENE_MAX}个；一场足以完成剧情时不强行拆场。
3. 动作只写观众能看到或听到的外部动作、环境声、道具变化和演员调度；不写心理活动、镜头景别、角度、运镜、全知解释或无意义空镜。每项保持一个简洁可拍动作单元，导出层会自动添加△，不要在字段里重复添加。
4. 全集所有场景的character_actions合计必须为{EPISODE_SHOT_UNIT_MIN}–{EPISODE_SHOT_UNIT_MAX}项，每项按一个独立镜头执行单元计数；不得拆分同一动作、增加空镜或写镜头语言凑数。
5. 全集所有场景的dialogues合计必须为{EPISODE_DIALOGUE_LINE_MIN}–{EPISODE_DIALOGUE_LINE_MAX}条，每项必须是演员实际说出的一句台词；{dialogue_style_rule}intent只放可表演提示，例如低声、头也不抬或beat。
6. 保留原稿已有的（O.S.）、（V.O.）、（continued）和（pre-lap）语义；如确有表演必要，可把这些标记附在已批准人物名后，但不得借此新增人物。
7. 保持短剧持续执行压力-行动-回报-升级循环，在原有剧情范围内强化动作、反应、交锋和事件后果，不能整集只等待、调查、解释或为最终对手做准备。
8. 不得修改场景标题、场景顺序、转场语义或结尾义务；{ending_contract_rule}
9. 不得新增人物；说话人只能来自原稿已经存在的人物。
10. 必须且只能返回editable_scene_numbers指定的场景，每场只返回scene_number、character_actions、body_order、dialogues；未指定场景由系统原样保留，不得返回。
11. 执行合作方正文格式合同{PARTNER_SCREENPLAY_FORMAT_VERSION}：body_order用action:0、dialogue:0
这类零基引用保存真实表演顺序，必须把本场每个动作和对白各引用且只引用一次。动作、人物名、
括号表演提示和台词必须自然交错，不能先列完全部动作再集中列全部对白。
12. 不要返回分析、解释、Markdown、字体、字号、颜色、排版说明或完整DraftMasterScript；
字体与版式由系统按照{PARTNER_SCREENPLAY_FORMAT_VERSION}统一处理，模型只返回结构化剧本文本。
        13. {language_rule}
        14. {canonical_name_rule}
        15. {pacing_rule}
        16. scene_causality是只读因果上下文。逐场核对原文中谁阻止谁、谁掌握什么信息、
哪些事实已经核实，再编辑动作和对白。补足时长不能凭空增加指责、企图或信息来源；
若角色有意误判或说谎，保留原文依据，不得把误判写成已证实的事实。
        17. 材料持有与公开范围是不同事实。逐项保留原稿各份材料及其不同部分的可见内容、
公开渠道和实际受众；区分操作端预览、观众大屏与向外发布，动作和对白中的屏幕指代必须一致。
遵守body_order中已经发生的展示：中断展示不能抹去已经暴露的内容；部分公开不代表其余材料也已公开，
未向外发布也不代表从未展示。不得为润色新增或撤销公开事实，原稿未交代的设备或受众不得擅自补为事实。
        18. 保留人物离场、读屏和消息传递的先后顺序，不能让离场者自动获知后来抵达他人设备的信息。
核对台词所说的已发送内容与实际消息一致，区分提及附件和发送附件；保留页面切换和保存材料的可执行动作，
单机截图不能表述为拍下两部设备。若原稿缺少必要的信息渠道或设备，不得为润色擅自补造。
        19. 保留承诺的确定程度与适用范围，不能把“保护身份”扩写成“绝不会被追查”等人物
无法控制的绝对保证。对方已表示条件不满足时，不能用安抚台词替代原稿的实际调整或同意过程。
        20. intent与character_actions服从同一body_order；不得在表演提示中提前执行稍后才发生的
书写、递交或接过，也不得重复一次交接。先呈现动作再写依赖它完成的反应，保留人物声音和潜台词。

原稿生产计数（必须保持在交付范围内）：场景{source_scene_count}个，台词{source_dialogue_count}条，镜头执行单元{source_shot_count}个。优先在原有数量上做等量替换，不得通过删减台词、动作或拆分重复内容改变计数。
{correction_block}{precision_duration_rule}

已锁定的连续性账本、人物状态、关系、剧情线、伏笔和生产元数据不提供给编辑模型，
也不允许编辑；系统会在合并后继续用原始完整草稿进行保护校验。以下只包含本轮可编辑场景正文
以及理解正文所需的最小场景职责。若这是第二轮，正文已经替换为上一轮补丁，直接定向修正，
不要恢复第一轮措辞：
{json.dumps(editable_context, ensure_ascii=False, separators=(',', ':'))}
````

## 源码原文

此部分按原始行提取，保留缩进、条件、占位变量和全部短字符串。

````python
    @staticmethod
    def _build_prompt(
        *,
        draft: DraftMasterScript,
        current_duration: ScreenplayDurationEstimate,
        target_duration: int,
        source_scene_count: int,
        source_dialogue_count: int,
        source_shot_count: int,
        overseas_release: bool,
        canonical_character_names: Mapping[str, str],
        correction_issues: list[str],
        previous_patch: dict[str, object] | None,
        editable_scene_numbers: list[int],
        approved_speaker_source: DraftMasterScript | None = None,
    ) -> str:
        if overseas_release:
            language_rule = (
                "你现在同时是剧本大师和语言大师。"
                f"{OVERSEAS_EPISODE_LANGUAGE_WORKFLOW_CONTRACT}"
                "所有可见叙事字段必须保持简体中文；动作、画面描述和intent中提到人物时"
                "只使用对应中文名，不得混入英文名；"
                "character_name保持原稿中的稳定英文连续性人物标识，不得擅自改名；每条"
                "dialogue.chinese_character_name同时写该说话人的稳定中文名。最终"
                "展示层会统一输出中文名（ENGLISH NAME）。逐句检查并润色英文对白，使其符合美国短剧的"
                "口语、节奏、打断、反击和潜台词习惯。只优化语言表达，不得改变剧情内容、"
                "人物意图、事实、关系、信息量、语气强弱、剧情顺序或结尾钩子。当前字段只写"
                "润色后的英文对白；每条dialogue.chinese_translation同时写该条最终英文"
                "dialogue.text准确、自然的简体中文对照。英文一旦修改，中文对照必须同步更新，"
                "两者逐句保留动作主体、对象、否定、时态、可能性和后果严重程度；"
                "数量词及其所指对象必须对应，不能把两个时间改写成两件事情。"
                "不得将可能受伤译成必然死亡。不得把明确执行者的具体行为改写为无主体的结果，"
                "也不得擅自补出原句未指明的执行者；屏幕、材料和受众的指代须与当前动作一致。"
                "不要在同一个dialogue.text中混写中英版本。"
            )
        else:
            language_rule = (
                "动作与画面描述保持简体中文；人物名和人物对白直接使用简体中文。"
                "dialogue.chinese_character_name和dialogue.chinese_translation填写null；"
                "不得生成英文人物名、英文对白或中英"
                "对照，不得触发海外英文润色或翻译要求。"
            )
        canonical_name_rule = ""
        if canonical_character_names:
            canonical_name_rule = (
                "资料中的明确人物名合同（最高优先级）如下："
                + json.dumps(
                    dict(canonical_character_names),
                    ensure_ascii=False,
                    separators=(",", ":"),
                )
                + "。海外路径的character_name必须逐字沿用对应英文名，禁止改名、音译、缩写、"
                "大小写改写或用模型重新起名；动作和intent只能写对应中文名。中文路径仍使用中文人物名。"
            )
        dialogue_style_rule = (
            "采用自然、可表演的短剧口语，以及短句、打断、反击和潜台词节奏；"
            "不得拆句、重复或添加解释性台词凑数。"
        )
        pacing_rule = (
            "25–35句台词必须共同支撑75–115秒真实表演时长，不能全部压成口号或单词式短句；"
            "用潜台词、打断、试探和反击承载信息，不得用复述或说明凑量。"
        )
        correction_block = (
            "\n当前待修正文仍有以下问题，必须全部修正：\n- "
            + "\n- ".join(correction_issues)
            if correction_issues
            else ""
        )
        editable_scene_number_set = set(editable_scene_numbers)
        editable_scenes = [
            scene for scene in draft.scenes
            if scene.scene_number in editable_scene_number_set
        ]
        editable_duration = estimate_screenplay_duration(
            draft.model_copy(update={"scenes": editable_scenes})  # type: ignore[arg-type]
        ).total_seconds
        # Keep the same estimator and assign its sub-second rounding residual
        # to the fixed scenes so the whole-episode budget remains additive.
        fixed_duration = max(0, current_duration.total_seconds - editable_duration)
        duration_budget = {
            "episode_current": current_duration.total_seconds,
            "episode_target": target_duration,
            "fixed_scenes": fixed_duration,
            "editable_current": editable_duration,
            "editable_target": max(0, target_duration - fixed_duration),
            "editable_preferred_min": max(
                0, EDITOR_PREFERRED_DURATION_MIN_SECONDS - fixed_duration
            ),
            "editable_preferred_max": max(
                0, EDITOR_PREFERRED_DURATION_MAX_SECONDS - fixed_duration
            ),
            "editable_min": max(0, EDITOR_DURATION_MIN_SECONDS - fixed_duration),
            "editable_max": max(0, EDITOR_DURATION_MAX_SECONDS - fixed_duration),
        }
        precision_duration_rule = (
            "\n本轮时长预算按实际可编辑场景计算，数值均为估算秒数：未提供的固定场景约"
            f"{fixed_duration}秒，可编辑场景当前合计约{editable_duration}秒，"
            f"本轮可编辑场景目标合计约{duration_budget['editable_target']}秒，"
            f"优先落在{duration_budget['editable_preferred_min']}–"
            f"{duration_budget['editable_preferred_max']}秒，允许范围为"
            f"{duration_budget['editable_min']}–{duration_budget['editable_max']}秒。"
            "这些是本轮所有可编辑场景的合计额度，不是每场额度，也不是整集额度；"
            "不得把未提供的固定场景时长重新分配给补丁。"
            "估算时对白与动作取较长轨道并包含场景转换，二者通常并行；"
            "动作文字不是旁白，中英对白对照也不能重复计时，不能按总文字量等比例扩写或删减。"
        )
        current_seconds = current_duration.total_seconds
        if current_seconds > EDITOR_DURATION_MAX_SECONDS:
            precision_duration_rule += (
                "\n本轮是定量压缩：当前整集估算为"
                f"{current_seconds}秒。只在可编辑场景中削减约"
                f"{current_seconds - target_duration}秒，优先削减"
                f"{current_seconds - EDITOR_PREFERRED_DURATION_MAX_SECONDS}–"
                f"{current_seconds - EDITOR_PREFERRED_DURATION_MIN_SECONDS}秒；"
                f"最少需减{current_seconds - EDITOR_DURATION_MAX_SECONDS}秒，"
                f"最多可减{current_seconds - EDITOR_DURATION_MIN_SECONDS}秒，"
                f"整集合并后必须落到{EDITOR_DURATION_MAX_SECONDS}秒以内，且不得低于"
                f"{EDITOR_DURATION_MIN_SECONDS}秒。"
                "保持场景、台词条数和镜头条数不变；优先删除复述、同义重复和不推进冲突的修饰，"
                "不得删除剧情事实、人物行动、关键反应或结尾钩子。"
            )
            if current_seconds > EDITOR_NEAR_MISS_MAX_SECONDS:
                precision_duration_rule += (
                    "当前稿件明显超时，本轮是硬压缩而不是润色：先缩短每句台词和动作描述中的"
                    "冗余表达，再做等量替换；必须保留生产计数，但不能保留原句的解释性重复。"
                )
        elif current_seconds < EDITOR_DURATION_MIN_SECONDS:
            precision_duration_rule += (
                "\n本轮是定量补足：当前整集估算为"
                f"{current_seconds}秒。只在可编辑场景中增加约"
                f"{target_duration - current_seconds}秒，优先增加"
                f"{EDITOR_PREFERRED_DURATION_MIN_SECONDS - current_seconds}–"
                f"{EDITOR_PREFERRED_DURATION_MAX_SECONDS - current_seconds}秒；"
                f"最少需增{EDITOR_DURATION_MIN_SECONDS - current_seconds}秒，"
                f"最多可增{EDITOR_DURATION_MAX_SECONDS - current_seconds}秒。"
                "达到目标后停止扩写，不得把最低增量当作无上限补写许可。"
                "保持场景、台词条数和镜头条数不变；只在原有剧情事实内增加动作反应、"
                "打断、潜台词和事件后果，不得新增剧情或人物。"
            )
        previous_scenes = {}
        if isinstance(previous_patch, dict):
            raw_scenes = previous_patch.get("scenes")
            if isinstance(raw_scenes, list):
                previous_scenes = {
                    item.get("scene_number"): item
                    for item in raw_scenes
                    if isinstance(item, dict)
                    and isinstance(item.get("scene_number"), int)
                }
        scene_context = []
        for scene in draft.scenes:
            if scene.scene_number not in editable_scene_number_set:
                continue
            editable = previous_scenes.get(scene.scene_number, {})
            scene_context.append({
                "scene_number": scene.scene_number,
                "scene_title": scene.slug,
                "purpose": scene.purpose,
                "beat_summary": scene.beat_summary,
                "turning_point": scene.turning_point,
                "scene_causality": (
                    scene.scene_causality.model_dump(mode="json")
                    if scene.scene_causality is not None
                    else None
                ),
                "cliffhanger": scene.cliffhanger,
                "character_actions": editable.get(
                    "character_actions",
                    scene.character_actions,
                ),
                "body_order": editable.get("body_order", scene.body_order),
                "dialogues": editable.get(
                    "dialogues",
                    [dialogue.model_dump(mode="json") for dialogue in scene.dialogues],
                ),
            })
        speaker_source = approved_speaker_source or draft
        approved_speakers = sorted({
            character.name for character in speaker_source.characters
        } | {
            dialogue.character_name
            for scene in speaker_source.scenes
            for dialogue in scene.dialogues
        })
        editable_context = {
            "title": draft.title,
            "episode_goal": draft.episode_goal,
            "ending_mode": draft.ending_mode.value,
            "next_episode_question": draft.next_episode_question,
            "approved_speakers": approved_speakers,
            "editable_scene_numbers": editable_scene_numbers,
            "duration_budget_seconds": duration_budget,
            "scenes": scene_context,
        }
        ending_contract_rule = (
            "本集是连载集：不得削弱原稿的结尾义务；最后可见动作或最后一句对白必须真正执行"
            "原稿的cliffhanger和next_episode_question，并让观众明确感到下一集必须发生什么。"
            if ending_mode_requires_next_question(draft.ending_mode)
            else "本集是收束集：不得为了制造公式化悬念新增cliffhanger或next_episode_question；"
            "最后可见动作或最后一句对白必须完成原稿已批准的结算、主要冲突回收和可见后果。"
            "如原稿的next_episode_question为空，保持为空。"
        )
        market_path = "overseas_tiktok" if overseas_release else "cn_mainland"
        return f"""Market path: {market_path}
你是剧本大师工作流中的终审编剧。DeepSeek已经完成一集完整初稿。
你的任务只是在不改变剧情事实、人物关系、伏笔、连续性结果、场景数量、场景顺序、场景标题和结尾义务的前提下，优化每场的可拍动作与人物对白。

当前项目规则：
1. 单集最终成片范围为{EDITOR_DURATION_MIN_SECONDS}–{EDITOR_DURATION_MAX_SECONDS}秒，内部安全目标为{EDITOR_PREFERRED_DURATION_MIN_SECONDS}–{EDITOR_PREFERRED_DURATION_MAX_SECONDS}秒，本集目标约{target_duration}秒；当前待修正文稿估算约{current_duration.total_seconds}秒。若当前初稿已在范围内，必须保持在范围内，不得为了润色压缩有效动作或对白。
2. 本集必须保留原稿的场景数量，且总数只能为{EPISODE_SCENE_MIN}–{EPISODE_SCENE_MAX}个；一场足以完成剧情时不强行拆场。
3. 动作只写观众能看到或听到的外部动作、环境声、道具变化和演员调度；不写心理活动、镜头景别、角度、运镜、全知解释或无意义空镜。每项保持一个简洁可拍动作单元，导出层会自动添加△，不要在字段里重复添加。
4. 全集所有场景的character_actions合计必须为{EPISODE_SHOT_UNIT_MIN}–{EPISODE_SHOT_UNIT_MAX}项，每项按一个独立镜头执行单元计数；不得拆分同一动作、增加空镜或写镜头语言凑数。
5. 全集所有场景的dialogues合计必须为{EPISODE_DIALOGUE_LINE_MIN}–{EPISODE_DIALOGUE_LINE_MAX}条，每项必须是演员实际说出的一句台词；{dialogue_style_rule}intent只放可表演提示，例如低声、头也不抬或beat。
6. 保留原稿已有的（O.S.）、（V.O.）、（continued）和（pre-lap）语义；如确有表演必要，可把这些标记附在已批准人物名后，但不得借此新增人物。
7. 保持短剧持续执行压力-行动-回报-升级循环，在原有剧情范围内强化动作、反应、交锋和事件后果，不能整集只等待、调查、解释或为最终对手做准备。
8. 不得修改场景标题、场景顺序、转场语义或结尾义务；{ending_contract_rule}
9. 不得新增人物；说话人只能来自原稿已经存在的人物。
10. 必须且只能返回editable_scene_numbers指定的场景，每场只返回scene_number、character_actions、body_order、dialogues；未指定场景由系统原样保留，不得返回。
11. 执行合作方正文格式合同{PARTNER_SCREENPLAY_FORMAT_VERSION}：body_order用action:0、dialogue:0
这类零基引用保存真实表演顺序，必须把本场每个动作和对白各引用且只引用一次。动作、人物名、
括号表演提示和台词必须自然交错，不能先列完全部动作再集中列全部对白。
12. 不要返回分析、解释、Markdown、字体、字号、颜色、排版说明或完整DraftMasterScript；
字体与版式由系统按照{PARTNER_SCREENPLAY_FORMAT_VERSION}统一处理，模型只返回结构化剧本文本。
        13. {language_rule}
        14. {canonical_name_rule}
        15. {pacing_rule}
        16. scene_causality是只读因果上下文。逐场核对原文中谁阻止谁、谁掌握什么信息、
哪些事实已经核实，再编辑动作和对白。补足时长不能凭空增加指责、企图或信息来源；
若角色有意误判或说谎，保留原文依据，不得把误判写成已证实的事实。
        17. 材料持有与公开范围是不同事实。逐项保留原稿各份材料及其不同部分的可见内容、
公开渠道和实际受众；区分操作端预览、观众大屏与向外发布，动作和对白中的屏幕指代必须一致。
遵守body_order中已经发生的展示：中断展示不能抹去已经暴露的内容；部分公开不代表其余材料也已公开，
未向外发布也不代表从未展示。不得为润色新增或撤销公开事实，原稿未交代的设备或受众不得擅自补为事实。
        18. 保留人物离场、读屏和消息传递的先后顺序，不能让离场者自动获知后来抵达他人设备的信息。
核对台词所说的已发送内容与实际消息一致，区分提及附件和发送附件；保留页面切换和保存材料的可执行动作，
单机截图不能表述为拍下两部设备。若原稿缺少必要的信息渠道或设备，不得为润色擅自补造。
        19. 保留承诺的确定程度与适用范围，不能把“保护身份”扩写成“绝不会被追查”等人物
无法控制的绝对保证。对方已表示条件不满足时，不能用安抚台词替代原稿的实际调整或同意过程。
        20. intent与character_actions服从同一body_order；不得在表演提示中提前执行稍后才发生的
书写、递交或接过，也不得重复一次交接。先呈现动作再写依赖它完成的反应，保留人物声音和潜台词。

原稿生产计数（必须保持在交付范围内）：场景{source_scene_count}个，台词{source_dialogue_count}条，镜头执行单元{source_shot_count}个。优先在原有数量上做等量替换，不得通过删减台词、动作或拆分重复内容改变计数。
{correction_block}{precision_duration_rule}

已锁定的连续性账本、人物状态、关系、剧情线、伏笔和生产元数据不提供给编辑模型，
也不允许编辑；系统会在合并后继续用原始完整草稿进行保护校验。以下只包含本轮可编辑场景正文
以及理解正文所需的最小场景职责。若这是第二轮，正文已经替换为上一轮补丁，直接定向修正，
不要恢复第一轮措辞：
{json.dumps(editable_context, ensure_ascii=False, separators=(',', ':'))}
"""
````

片段 SHA-256：`a1574ef529039aa87a68b61b96a0b522bacb244c1f9abb2caff0b150633fe186`
