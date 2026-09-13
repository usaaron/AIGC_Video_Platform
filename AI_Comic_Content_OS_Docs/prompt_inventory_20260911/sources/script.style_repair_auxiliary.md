# 独立可拍动作风格修复

编号：`script.style_repair_auxiliary`。状态：`保留辅助入口，当前主链未见调用其helper`。

来源：[backend/app/modules/script_engine/generation_service.py:8552](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/generation_service.py:8552)。符号：`ScriptGenerationService._build_screenplay_style_repair_prompt`。

由_ensure_mainland_screenplay_style引用；当前主链通过综合验收处理动作风格。

本页保留当前工作区原文，不是优化后的替代提示词，也不是某次模型调用的完整展开结果。

## 长文本阅读视图

按源码位置列出长字符串；静态文本按字符串值显示，花括号内动态表达式仅供识别，未执行。条件分支分别列出，不代表一次调用全部生效。短标签、拼装顺序和完整条件见后面的源码原文。

### 片段 1 · 源码第 8559 行

````text
{original_prompt}

The previous Simplified Chinese script is structurally valid, but some character_actions are
novel prose rather than production-readable comic-drama action. Rewrite only the character_actions
arrays at the listed paths. Copy every other JSON value exactly, including all dialogues. Preserve
the same events, information, character choices, causal order, setting, and body depth.

Each replacement array item must be one concise action unit that a camera or microphone can capture:
performance, blocking, prop interaction, visible environment change, or explicit sound. Split a
long narrative paragraph into separate action items when necessary. Externalize private thought or
author explanation through visible behavior and existing story evidence without inventing a new
event. Do not add Markdown markers such as △ to the JSON.

Invalid action fields and reasons:
{', '.join(issues)}

Previous structurally valid JSON:
{output.model_dump_json()}

Return one corrected JSON object only. Do not use Markdown fences or explanatory text.
````

## 源码原文

此部分按原始行提取，保留缩进、条件、占位变量和全部短字符串。

````python
    @staticmethod
    def _build_screenplay_style_repair_prompt(
        *,
        original_prompt: str,
        output: LLMGeneratedDraftMasterScript,
        issues: list[str],
    ) -> str:
        return f"""{original_prompt}

The previous Simplified Chinese script is structurally valid, but some character_actions are
novel prose rather than production-readable comic-drama action. Rewrite only the character_actions
arrays at the listed paths. Copy every other JSON value exactly, including all dialogues. Preserve
the same events, information, character choices, causal order, setting, and body depth.

Each replacement array item must be one concise action unit that a camera or microphone can capture:
performance, blocking, prop interaction, visible environment change, or explicit sound. Split a
long narrative paragraph into separate action items when necessary. Externalize private thought or
author explanation through visible behavior and existing story evidence without inventing a new
event. Do not add Markdown markers such as △ to the JSON.

Invalid action fields and reasons:
{', '.join(issues)}

Previous structurally valid JSON:
{output.model_dump_json()}

Return one corrected JSON object only. Do not use Markdown fences or explanatory text."""
````

片段 SHA-256：`156720e03262422298de1a72e440462fbb41680e03817689c73f7461ccc200e2`
