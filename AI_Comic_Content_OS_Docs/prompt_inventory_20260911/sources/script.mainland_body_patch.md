# 大陆综合验收正文局部修复

编号：`script.mainland_body_patch`。状态：`大陆验收失败时条件触发`。

来源：[backend/app/modules/script_engine/generation_service.py:8309](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/generation_service.py:8309)。符号：`ScriptGenerationService._build_mainland_body_repair_prompt`。

仅动作对白，不改事件场次结尾；含固定循环措辞。

本页保留当前工作区原文，不是优化后的替代提示词，也不是某次模型调用的完整展开结果。

## 长文本阅读视图

按源码位置列出长字符串；静态文本按字符串值显示，花括号内动态表达式仅供识别，未执行。条件分支分别列出，不代表一次调用全部生效。短标签、拼装顺序和完整条件见后面的源码原文。

### 片段 1 · 源码第 8335 行

````text
正文约 {actual_characters} 字，低于明显截断线 {guidance.truncation_floor_characters} 字；补全原场景内缺失的行动、反应、对白交锋和结果，不新增剧情事件，不重复凑字；补丁必须覆盖全部原有场景。
````

### 片段 2 · 源码第 8344 行

````text
当前预计成片约 {duration_estimate.total_seconds} 秒，不足75秒。保持原剧情和场景不变，补足尚未充分展开的压力-行动-回报-升级循环，以可拍动作、人物反应、潜台词交锋和事件后果使局势真正变化并接近{target_duration}秒。少用空镜，不得重复凑时长。
````

### 片段 3 · 源码第 8353 行

````text
当前预计成片约 {duration_estimate.total_seconds} 秒，超过115秒。保持全部剧情节点和结尾钩子，删除重复动作、解释性台词和无推进停顿，使预计时长接近{target_duration}秒。
````

### 片段 4 · 源码第 8382 行

````text
宽松参考范围为 {guidance.preferred_min_characters}-{guidance.preferred_max_characters} 字。
````

### 片段 5 · 源码第 8387 行

````text
修正一集中国大陆漫剧剧本的场景正文。只处理动作和对白，不重写整集 JSON。

任务：
{task_text}

保持人物、剧情事件、场景数量、场景编号、信息揭示、转折和结尾作用不变。动作必须可见或可听，
每条动作是可独立拍摄的简洁单元；对白必须可直接表演。不得写小说叙述、作者解释或规划说明，
不得新增人物、场景、支线、反转或设定。{range_text} 当前各场正文量为 {scene_characters}，不按场均分。

剧名：{output.title}
本集目标：{output.episode_goal}
结尾问题：{output.next_episode_question}
需要修正的场景正文：
{json.dumps(scene_context, ensure_ascii=False, separators=(',', ':'))}

只返回局部补丁 JSON。scenes 中每项只包含 scene_number、character_actions、body_order、dialogues；
body_order使用action:0、dialogue:0这类零基引用，必须按真实表演顺序把本场每个动作和对白
各引用且只引用一次，让动作与对白自然交错；
不要返回标题、人物、状态账本、梗概或其他顶层字段。
````

## 源码原文

此部分按原始行提取，保留缩进、条件、占位变量和全部短字符串。

````python
    @staticmethod
    def _build_mainland_body_repair_prompt(
        *,
        output: LLMGeneratedDraftMasterScript,
        screenplay_issues: list[str],
        actual_characters: int,
        guidance: ScriptBodyLengthGuidance | None,
        scene_characters: list[int],
        duration_estimate: ScreenplayDurationEstimate,
        duration_issue: bool,
        scene_count: int,
        dialogue_count: int,
        shot_count: int,
    ) -> str:
        tasks: list[str] = []
        target_duration = min(
            MAINLAND_DURATION_TARGET_MAX_SECONDS,
            max(MAINLAND_DURATION_TARGET_MIN_SECONDS, output.target_duration_seconds),
        )
        if screenplay_issues:
            tasks.append(
                "把下列动作改成镜头和声音可直接呈现的简洁动作单元："
                + "、".join(screenplay_issues[:20])
            )
        if guidance and actual_characters < guidance.truncation_floor_characters:
            tasks.append(
                f"正文约 {actual_characters} 字，低于明显截断线 "
                f"{guidance.truncation_floor_characters} 字；补全原场景内缺失的行动、反应、"
                "对白交锋和结果，不新增剧情事件，不重复凑字；补丁必须覆盖全部原有场景。"
            )
        if (
            duration_issue
            and duration_estimate.total_seconds < MAINLAND_DURATION_TARGET_MIN_SECONDS
        ):
            tasks.append(
                f"当前预计成片约 {duration_estimate.total_seconds} 秒，不足75秒。保持原剧情和"
                "场景不变，补足尚未充分展开的压力-行动-回报-升级循环，以可拍动作、人物反应、"
                f"潜台词交锋和事件后果使局势真正变化并接近{target_duration}秒。少用空镜，不得重复凑时长。"
            )
        elif (
            duration_issue
            and duration_estimate.total_seconds > MAINLAND_DURATION_TARGET_MAX_SECONDS
        ):
            tasks.append(
                f"当前预计成片约 {duration_estimate.total_seconds} 秒，超过115秒。保持全部剧情"
                f"节点和结尾钩子，删除重复动作、解释性台词和无推进停顿，使预计时长接近{target_duration}秒。"
            )
        tasks.append(
            ScriptGenerationService._build_mainland_production_count_task(
                scene_count=scene_count,
                dialogue_count=dialogue_count,
                shot_count=shot_count,
            )
        )
        task_text = "\n".join(
            f"{index}. {task}" for index, task in enumerate(tasks, 1)
        )
        scene_context = [
            {
                "scene_number": scene.scene_number,
                "setting": scene.setting,
                "purpose": scene.purpose,
                "beat_summary": scene.beat_summary,
                "turning_point": scene.turning_point,
                "character_actions": scene.character_actions,
                "body_order": scene.body_order,
                "dialogues": [
                    dialogue.model_dump(mode="json") for dialogue in scene.dialogues
                ],
            }
            for scene in output.scenes
        ]
        range_text = (
            f"宽松参考范围为 {guidance.preferred_min_characters}-"
            f"{guidance.preferred_max_characters} 字。"
            if guidance
            else ""
        )
        return f"""修正一集中国大陆漫剧剧本的场景正文。只处理动作和对白，不重写整集 JSON。

任务：
{task_text}

保持人物、剧情事件、场景数量、场景编号、信息揭示、转折和结尾作用不变。动作必须可见或可听，
每条动作是可独立拍摄的简洁单元；对白必须可直接表演。不得写小说叙述、作者解释或规划说明，
不得新增人物、场景、支线、反转或设定。{range_text} 当前各场正文量为 {scene_characters}，不按场均分。

剧名：{output.title}
本集目标：{output.episode_goal}
结尾问题：{output.next_episode_question}
需要修正的场景正文：
{json.dumps(scene_context, ensure_ascii=False, separators=(',', ':'))}

只返回局部补丁 JSON。scenes 中每项只包含 scene_number、character_actions、body_order、dialogues；
body_order使用action:0、dialogue:0这类零基引用，必须按真实表演顺序把本场每个动作和对白
各引用且只引用一次，让动作与对白自然交错；
不要返回标题、人物、状态账本、梗概或其他顶层字段。"""
````

片段 SHA-256：`0826d1b40ab6a2d71f4121b1d4cc7bb2a211a99ebd7d5a2a7d97b2a5fb95340f`
