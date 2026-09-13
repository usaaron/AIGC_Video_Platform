# 分集整叶语义/语言分块修复（保留）

编号：`planning.episode_segmented_repair_retained`。状态：`retained_no_production_caller_found`。

来源：[backend/app/modules/script_engine/story_planning_service.py:10682](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_planning_service.py:10682)。符号：`StoryPlanningService._build_segmented_episode_plan_repair_prompt`。

当前 backend 搜索仅定义，未见生产调用，不视为主流程步骤。

本页保留当前工作区原文，不是优化后的替代提示词，也不是某次模型调用的完整展开结果。

## 长文本阅读视图

按源码位置列出长字符串；静态文本按字符串值显示，花括号内动态表达式仅供识别，未执行。条件分支分别列出，不代表一次调用全部生效。短标签、拼装顺序和完整条件见后面的源码原文。

### 片段 1 · 源码第 10690 行

````text
The previous merged leaf failed final semantic validation: {validation_error}
````

### 片段 2 · 源码第 10692 行

````text
The previous merged leaf satisfied semantic validation.
````

### 片段 3 · 源码第 10695 行

````text
Rewrite the affected human-readable values in natural Simplified Chinese. Reported paths:
````

### 片段 4 · 源码第 10698 行

````text
No mainland-language issue was detected.
````

### 片段 5 · 源码第 10700 行

````text
{original_prompt}

SEGMENTED EPISODE ROADMAP CORRECTION
Regenerate the leaf through the same short ordered chunks. The application will merge
the chunks and validate the complete 8-12 episode leaf again.
{semantic_section}
{language_section}

Preserve the approved segment direction, episode range, character and story-line refs,
turning points, unit-story beats, local resolution and handoff pressure. Correct the
reported issue without adding a new plot chain. Return only the chunk requested by each
subsequent segmented instruction.
````

## 源码原文

此部分按原始行提取，保留缩进、条件、占位变量和全部短字符串。

````python
    @staticmethod
    def _build_segmented_episode_plan_repair_prompt(
        *,
        original_prompt: str,
        validation_error: StoryPlanningInputError | None,
        non_chinese_fields: list[str],
    ) -> str:
        semantic_section = (
            f"The previous merged leaf failed final semantic validation: {validation_error}"
            if validation_error is not None
            else "The previous merged leaf satisfied semantic validation."
        )
        language_section = (
            "Rewrite the affected human-readable values in natural Simplified Chinese. "
            "Reported paths: " + ", ".join(non_chinese_fields[:20])
            if non_chinese_fields
            else "No mainland-language issue was detected."
        )
        return f"""{original_prompt}

SEGMENTED EPISODE ROADMAP CORRECTION
Regenerate the leaf through the same short ordered chunks. The application will merge
the chunks and validate the complete 8-12 episode leaf again.
{semantic_section}
{language_section}

Preserve the approved segment direction, episode range, character and story-line refs,
turning points, unit-story beats, local resolution and handoff pressure. Correct the
reported issue without adding a new plot chain. Return only the chunk requested by each
subsequent segmented instruction."""
````

片段 SHA-256：`18a6945edb3c5e94a45e14c525aa16b25b0e23365d4d8e609697d6bf6abc5ee1`
