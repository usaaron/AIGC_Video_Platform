# 输入容量提示与补充问题

编号：`input.readiness.supplement`。状态：`active`。

来源：[backend/app/modules/input_readiness/service.py:611](/Users/simonriley/Downloads/docs/backend/app/modules/input_readiness/service.py:611)。符号：`CreativeInputReadinessService._capacity_fields`。

代码生成的建议与问题，并非独立模型提示词；在选择推荐路径时可作为 Grill 的提问线索。

本页保留当前工作区原文，不是优化后的替代提示词，也不是某次模型调用的完整展开结果。

## 长文本阅读视图

按源码位置列出长字符串；静态文本按字符串值显示，花括号内动态表达式仅供识别，未执行。条件分支分别列出，不代表一次调用全部生效。短标签、拼装顺序和完整条件见后面的源码原文。

### 片段 1 · 源码第 666 行

````text
是否有需要优先推进或尽快收束的故事线？没有的话，系统将按每条故事线自身的因果节奏安排，不能静默遗忘任何已建立的故事线。
````

### 片段 2 · 源码第 680 行

````text
针对“{item.rstrip('。')}”，你希望补充哪些明确内容？
````

### 片段 3 · 源码第 685 行

````text
当前输入预计可支撑约 {estimated:,} 字，是否补充设定或将目标调整到约 {recommended_target or estimated:,} 字？
````

### 片段 4 · 源码第 691 行

````text
estimated_supported_characters
````

### 片段 5 · 源码第 693 行

````text
recommended_target_total_characters
````

## 源码原文

此部分按原始行提取，保留缩进、条件、占位变量和全部短字符串。

````python
    @classmethod
    def _capacity_fields(
        cls,
        payload: CreativeInputReadinessRequest,
        signals: _DocumentSignals,
        level: InputReadinessLevel,
        coverage: InputReadinessCoverage,
        *,
        missing_items: list[str] | None = None,
    ) -> dict[str, object]:
        """Estimate how much final script the supplied material can safely support.

        This is a planning warning, not a hard quota. The estimate intentionally
        leaves room for the existing workflow to expand structure and dialogue,
        while making very sparse inputs visible before generation starts.
        """

        coverage_value = coverage.model_dump()[level.value]
        expansion_factor = {
            InputReadinessLevel.premise: 4.0,
            InputReadinessLevel.story_bible: 6.0,
            InputReadinessLevel.episode_plan: 3.2,
            InputReadinessLevel.script: 1.25,
        }[level]
        confidence_factor = 0.55 + cls._bounded(coverage_value) * 0.45
        estimated = max(
            0,
            round(signals.character_count * expansion_factor * confidence_factor),
        )
        target = max(1_000, payload.target_total_characters)
        ratio = estimated / target if target else 0.0
        if ratio >= 0.85:
            status = InputReadinessCapacityStatus.sufficient
        elif ratio >= 0.45:
            status = InputReadinessCapacityStatus.supplement_recommended
        else:
            status = InputReadinessCapacityStatus.target_reduce_recommended

        recommended_target: int | None = None
        if status != InputReadinessCapacityStatus.sufficient:
            recommended_target = max(1_000, round(estimated / 0.85))
            if target >= 80_000:
                recommended_target = max(80_000, recommended_target)
            recommended_target = min(target, recommended_target)

        questions: list[str] = []
        if level == InputReadinessLevel.premise:
            if not signals.premise_protagonist:
                questions.append("主角是谁，当前最想得到或守住什么？")
            if not signals.premise_conflict:
                questions.append("谁或什么力量会阻止主角，冲突的具体表现是什么？")
            if not signals.premise_ending:
                questions.append("你希望观众最终获得什么情绪或价值上的落点？")
        elif level == InputReadinessLevel.story_bible:
            questions.extend([
                "是否有需要优先推进或尽快收束的故事线？没有的话，系统将按每条故事线自身的因果节奏安排，不能静默遗忘任何已建立的故事线。",
                "主要人物在结局前必须发生哪些不可逆的变化？",
            ])
        elif level == InputReadinessLevel.episode_plan:
            questions.extend([
                "缺失分集的集号、局部目标和结尾状态分别是什么？",
                "哪些分集或故事线是不能改写的固定安排？",
            ])
        if missing_items and level in (
            InputReadinessLevel.story_bible,
            InputReadinessLevel.episode_plan,
            InputReadinessLevel.script,
        ):
            questions.extend(
                f"针对“{item.rstrip('。')}”，你希望补充哪些明确内容？"
                for item in missing_items[:4]
            )
        if status != InputReadinessCapacityStatus.sufficient:
            questions.append(
                f"当前输入预计可支撑约 {estimated:,} 字，是否补充设定或将目标调整到约 {recommended_target or estimated:,} 字？"
            )
        return {
            "source_character_count": signals.character_count,
            "detected_episode_count": signals.declared_episode_count,
            "source_kinds": cls._source_kinds(signals),
            "estimated_supported_characters": estimated,
            "capacity_status": status,
            "recommended_target_total_characters": recommended_target,
            "supplement_questions": cls._dedupe_text(questions, limit=12),
        }
````

片段 SHA-256：`6f0b5b71862e9db29a0c772de4220d26011c64f461b8e923d18367e93feaa3a5`
