# 通用规划中文语言修复

编号：`planning.language_repair`。状态：`active_conditional_repair`。

来源：[backend/app/modules/script_engine/story_planning_service.py:12933](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_planning_service.py:12933)。符号：`StoryPlanningService._build_planning_language_repair_prompt`。

保留技术标识、集号、顺序、批准转折及边界。

本页保留当前工作区原文，不是优化后的替代提示词，也不是某次模型调用的完整展开结果。

## 长文本阅读视图

按源码位置列出长字符串；静态文本按字符串值显示，花括号内动态表达式仅供识别，未执行。条件分支分别列出，不代表一次调用全部生效。短标签、拼装顺序和完整条件见后面的源码原文。

### 片段 1 · 源码第 12940 行

````text
{original_prompt}

The previous planning JSON is structurally valid but contains fields whose narrative is English-dominant.
Rewrite the listed values so their narrative is primarily Simplified Chinese. Common abbreviations such
as AI, DNA and KPI, model numbers, and necessary proper names may remain in Latin letters when natural.
Preserve the exact story meaning, technical IDs, reference values, enum values, numeric ranges,
episode numbers, ordering, approved turning points, and causal boundaries. Do not add plot facts.
Fields requiring repair: {', '.join(non_chinese_fields)}

Previous structurally valid JSON:
{output.model_dump_json()}

Return one corrected JSON object only. Do not use Markdown fences or explanatory text.
````

## 源码原文

此部分按原始行提取，保留缩进、条件、占位变量和全部短字符串。

````python
    @staticmethod
    def _build_planning_language_repair_prompt(
        *,
        original_prompt: str,
        output: BaseModel,
        non_chinese_fields: list[str],
    ) -> str:
        return f"""{original_prompt}

The previous planning JSON is structurally valid but contains fields whose narrative is English-dominant.
Rewrite the listed values so their narrative is primarily Simplified Chinese. Common abbreviations such
as AI, DNA and KPI, model numbers, and necessary proper names may remain in Latin letters when natural.
Preserve the exact story meaning, technical IDs, reference values, enum values, numeric ranges,
episode numbers, ordering, approved turning points, and causal boundaries. Do not add plot facts.
Fields requiring repair: {', '.join(non_chinese_fields)}

Previous structurally valid JSON:
{output.model_dump_json()}

Return one corrected JSON object only. Do not use Markdown fences or explanatory text."""
````

片段 SHA-256：`723935a95ea0496c680494fcbe4bd82998504d6aadb07027a5f29e8420a61ba7`
