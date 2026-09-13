# 大陆综合验收整稿修复

编号：`script.mainland_acceptance`。状态：`大陆验收失败时条件触发`。

来源：[backend/app/modules/script_engine/generation_service.py:8226](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/generation_service.py:8226)。符号：`ScriptGenerationService._build_mainland_acceptance_repair_prompt`。

语言/表达/截断/时长/数量；含尚需讨论的固定循环措辞。

本页保留当前工作区原文，不是优化后的替代提示词，也不是某次模型调用的完整展开结果。

## 长文本阅读视图

按源码位置列出长字符串；静态文本按字符串值显示，花括号内动态表达式仅供识别，未执行。条件分支分别列出，不代表一次调用全部生效。短标签、拼装顺序和完整条件见后面的源码原文。

### 片段 1 · 源码第 8259 行

````text
当前有效正文约 {actual_characters} 字，低于明显截断线 {guidance.truncation_floor_characters} 字；补全已规划场景中缺失的行动、反应、对白交锋和结果，不新增剧情事件，不为凑字重复。
````

### 片段 2 · 源码第 8268 行

````text
预计成片约 {duration_estimate.total_seconds} 秒，不足75秒；只在原场景中补足尚未充分展开的压力-行动-回报-升级循环，以可拍动作、人物反应、潜台词交锋和事件后果使局势真正变化并接近{target_duration}秒。少用空镜，不得拆分或改写同一动作凑时长。
````

### 片段 3 · 源码第 8277 行

````text
预计成片约 {duration_estimate.total_seconds} 秒，超过115秒；保留全部剧情节点和尾钩，压缩重复动作、解释性台词和无推进停顿，使成片接近{target_duration}秒。
````

### 片段 4 · 源码第 8289 行

````text
宽松参考范围为 {guidance.preferred_min_characters}-{guidance.preferred_max_characters} 字。
````

### 片段 5 · 源码第 8294 行

````text
{original_prompt}

上一版 JSON 已通过结构校验，但未通过中国大陆漫剧正文验收。请在一次修订中完成以下全部任务：
{task_text}

保持人物身份、既定事实、剧情职责、场景数量、场景编号、因果顺序、关键选择、信息揭示、
结尾悬念作用和所有技术枚举不变。只修正被指出的表达，并在明显截断时补足原场景内已经隐含的
可拍摄戏剧行动。动作必须可见或可听；对白必须可直接表演。不得写小说叙述、作者解释、规划说明，
不得新增人物、场景、支线、反转或设定。{range_text} 当前各场正文量为 {scene_characters}，不按场均分。

上一版结构有效的 JSON：
{output.model_dump_json()}

只返回一个完整、修正后的 JSON 对象，不要使用 Markdown 代码块或解释文字。
````

## 源码原文

此部分按原始行提取，保留缩进、条件、占位变量和全部短字符串。

````python
    @staticmethod
    def _build_mainland_acceptance_repair_prompt(
        *,
        original_prompt: str,
        output: LLMGeneratedDraftMasterScript,
        language_issues: list[str],
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
        if language_issues:
            tasks.append(
                "将全部可见叙事内容改为简体中文，不得残留英文字母；字段："
                + "、".join(language_issues[:20])
            )
        if screenplay_issues:
            tasks.append(
                "只把下列动作改成镜头和声音可直接呈现的简洁动作单元："
                + "、".join(screenplay_issues[:20])
            )
        if guidance and actual_characters < guidance.truncation_floor_characters:
            tasks.append(
                f"当前有效正文约 {actual_characters} 字，低于明显截断线 "
                f"{guidance.truncation_floor_characters} 字；补全已规划场景中缺失的行动、"
                "反应、对白交锋和结果，不新增剧情事件，不为凑字重复。"
            )
        if (
            duration_issue
            and duration_estimate.total_seconds < MAINLAND_DURATION_TARGET_MIN_SECONDS
        ):
            tasks.append(
                f"预计成片约 {duration_estimate.total_seconds} 秒，不足75秒；只在原场景中补足"
                "尚未充分展开的压力-行动-回报-升级循环，以可拍动作、人物反应、潜台词交锋"
                f"和事件后果使局势真正变化并接近{target_duration}秒。少用空镜，不得拆分或改写同一动作凑时长。"
            )
        elif (
            duration_issue
            and duration_estimate.total_seconds > MAINLAND_DURATION_TARGET_MAX_SECONDS
        ):
            tasks.append(
                f"预计成片约 {duration_estimate.total_seconds} 秒，超过115秒；保留全部剧情节点和"
                f"尾钩，压缩重复动作、解释性台词和无推进停顿，使成片接近{target_duration}秒。"
            )
        tasks.append(
            ScriptGenerationService._build_mainland_production_count_task(
                scene_count=scene_count,
                dialogue_count=dialogue_count,
                shot_count=shot_count,
            )
        )
        task_text = "\n".join(f"{index}. {task}" for index, task in enumerate(tasks, 1))
        range_text = (
            f"宽松参考范围为 {guidance.preferred_min_characters}-"
            f"{guidance.preferred_max_characters} 字。"
            if guidance
            else ""
        )
        return f"""{original_prompt}

上一版 JSON 已通过结构校验，但未通过中国大陆漫剧正文验收。请在一次修订中完成以下全部任务：
{task_text}

保持人物身份、既定事实、剧情职责、场景数量、场景编号、因果顺序、关键选择、信息揭示、
结尾悬念作用和所有技术枚举不变。只修正被指出的表达，并在明显截断时补足原场景内已经隐含的
可拍摄戏剧行动。动作必须可见或可听；对白必须可直接表演。不得写小说叙述、作者解释、规划说明，
不得新增人物、场景、支线、反转或设定。{range_text} 当前各场正文量为 {scene_characters}，不按场均分。

上一版结构有效的 JSON：
{output.model_dump_json()}

只返回一个完整、修正后的 JSON 对象，不要使用 Markdown 代码块或解释文字。"""
````

片段 SHA-256：`87c7605db31217fef7419fec0f035fda1f8e4f1c3767720552b982892728b432`
