# 简体中文字段修复

编号：`script.language_repair`。状态：`其他中文输出分支条件触发`。

来源：[backend/app/modules/script_engine/generation_service.py:8531](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/generation_service.py:8531)。符号：`ScriptGenerationService._build_draft_language_repair_prompt`。

现有文字禁止拉丁字母，比主合同允许必要缩写更严；不改情节。

本页保留当前工作区原文，不是优化后的替代提示词，也不是某次模型调用的完整展开结果。

## 长文本阅读视图

按源码位置列出长字符串；静态文本按字符串值显示，花括号内动态表达式仅供识别，未执行。条件分支分别列出，不代表一次调用全部生效。短标签、拼装顺序和完整条件见后面的源码原文。

### 片段 1 · 源码第 8538 行

````text
{original_prompt}

The previous script JSON is structurally valid but violates the Simplified Chinese output contract.
Rewrite every human-readable script value in Simplified Chinese. Human-readable values must not
contain any Latin letters, including English names, titles, labels, abbreviations, or mixed phrases.
Preserve the exact story direction, character identities, scene order, scene numbers, causality,
cliffhanger purpose, technical enum values, and JSON field names. Do not add or remove story events.
Keep the language field as zh. Fields requiring repair: {', '.join(non_chinese_fields)}

Previous structurally valid JSON:
{output.model_dump_json()}

Return one corrected JSON object only. Do not use Markdown fences or explanatory text.
````

## 源码原文

此部分按原始行提取，保留缩进、条件、占位变量和全部短字符串。

````python
    @staticmethod
    def _build_draft_language_repair_prompt(
        *,
        original_prompt: str,
        output: LLMGeneratedDraftMasterScript,
        non_chinese_fields: list[str],
    ) -> str:
        return f"""{original_prompt}

The previous script JSON is structurally valid but violates the Simplified Chinese output contract.
Rewrite every human-readable script value in Simplified Chinese. Human-readable values must not
contain any Latin letters, including English names, titles, labels, abbreviations, or mixed phrases.
Preserve the exact story direction, character identities, scene order, scene numbers, causality,
cliffhanger purpose, technical enum values, and JSON field names. Do not add or remove story events.
Keep the language field as zh. Fields requiring repair: {', '.join(non_chinese_fields)}

Previous structurally valid JSON:
{output.model_dump_json()}

Return one corrected JSON object only. Do not use Markdown fences or explanatory text."""
````

片段 SHA-256：`c5297217f70418b6b177ef2ca16aedae8b47943d3100f39d79189b0838bf5ff6`
