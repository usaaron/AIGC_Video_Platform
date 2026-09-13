# 整批分集规划语义/语言修复（保留）

编号：`planning.episode_batch_repair_retained`。状态：`retained_no_production_caller_found`。

来源：[backend/app/modules/script_engine/story_planning_service.py:12086](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_planning_service.py:12086)。符号：`StoryPlanningService._build_episode_plan_repair_prompt`。

当前 backend 搜索仅定义，未见生产调用。

本页保留当前工作区原文，不是优化后的替代提示词，也不是某次模型调用的完整展开结果。

## 长文本阅读视图

按源码位置列出长字符串；静态文本按字符串值显示，花括号内动态表达式仅供识别，未执行。条件分支分别列出，不代表一次调用全部生效。短标签、拼装顺序和完整条件见后面的源码原文。

### 片段 1 · 源码第 12095 行

````text
Approved segment contract failure: {validation_error}
````

### 片段 2 · 源码第 12097 行

````text
The approved segment contract is already satisfied.
````

### 片段 3 · 源码第 12100 行

````text
Narrative fields that must be rewritten in natural Simplified Chinese:
````

### 片段 4 · 源码第 12103 行

````text
No mainland-language issue was detected.
````

### 片段 5 · 源码第 12105 行

````text
{original_prompt}

The previous Episode Plan batch was structurally valid JSON but needs one bounded
repair before it can become the executable contract for screenplay generation.
{semantic_section}
{language_section}

Preserve the exact episode range, approved character/story-line references, every
approved turning point and every approved unit-story beat. Do not add prose scenes,
dialogue or a new plot chain. Rewrite only what is necessary, keep each episode's
causal contribution distinct, and return one complete JSON object only.

Previous Episode Plan batch:
{output.model_dump_json()}
````

## 源码原文

此部分按原始行提取，保留缩进、条件、占位变量和全部短字符串。

````python
    @staticmethod
    def _build_episode_plan_repair_prompt(
        *,
        original_prompt: str,
        output: EpisodePlanBatchGenerationOutput,
        validation_error: StoryPlanningInputError | None,
        non_chinese_fields: list[str],
    ) -> str:
        semantic_section = (
            f"Approved segment contract failure: {validation_error}"
            if validation_error is not None
            else "The approved segment contract is already satisfied."
        )
        language_section = (
            "Narrative fields that must be rewritten in natural Simplified Chinese: "
            + ", ".join(non_chinese_fields[:20])
            if non_chinese_fields
            else "No mainland-language issue was detected."
        )
        return f"""{original_prompt}

The previous Episode Plan batch was structurally valid JSON but needs one bounded
repair before it can become the executable contract for screenplay generation.
{semantic_section}
{language_section}

Preserve the exact episode range, approved character/story-line references, every
approved turning point and every approved unit-story beat. Do not add prose scenes,
dialogue or a new plot chain. Rewrite only what is necessary, keep each episode's
causal contribution distinct, and return one complete JSON object only.

Previous Episode Plan batch:
{output.model_dump_json()}
"""
````

片段 SHA-256：`4378c0b5410033946b80a5c4c7804417932adc84a4686be78c1b3e4cb66c17d9`
