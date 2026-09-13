# 畸形JSON修复

编号：`script.json_repair`。状态：`失败时条件触发`。

来源：[backend/app/modules/script_engine/generation_service.py:7976](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/generation_service.py:7976)。符号：`ScriptGenerationService._build_malformed_json_repair_prompt`。

保留可用故事和正文，补未完成结构，不能重启故事。

本页保留当前工作区原文，不是优化后的替代提示词，也不是某次模型调用的完整展开结果。

## 长文本阅读视图

按源码位置列出长字符串；静态文本按字符串值显示，花括号内动态表达式仅供识别，未执行。条件分支分别列出，不代表一次调用全部生效。短标签、拼装顺序和完整条件见后面的源码原文。

### 片段 1 · 源码第 7978 行

````text
Repair the malformed model response below into one complete JSON object matching
the separately supplied JSON schema. Preserve every usable story event, scene action, dialogue,
character fact, character state update, causal link, and ending from the response. Remove Markdown
fences, reasoning, introductions, and trailing commentary. If the response was cut off, complete only
the missing structured fields and unfinished scene content without restarting or replacing the story.
Return JSON only.

Malformed response:
{raw_content}

Return one complete JSON object only.
````

## 源码原文

此部分按原始行提取，保留缩进、条件、占位变量和全部短字符串。

````python
    @staticmethod
    def _build_malformed_json_repair_prompt(*, raw_content: str) -> str:
        return f"""Repair the malformed model response below into one complete JSON object matching
the separately supplied JSON schema. Preserve every usable story event, scene action, dialogue,
character fact, character state update, causal link, and ending from the response. Remove Markdown
fences, reasoning, introductions, and trailing commentary. If the response was cut off, complete only
the missing structured fields and unfinished scene content without restarting or replacing the story.
Return JSON only.

Malformed response:
{raw_content}

Return one complete JSON object only."""
````

片段 SHA-256：`9e32d8446feb0308ecd0121834424017f3347d991113886bc0b532c191230892`
