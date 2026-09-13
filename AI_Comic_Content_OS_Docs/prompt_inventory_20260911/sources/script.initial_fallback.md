# 初次生成恢复失败后的模型回退

编号：`script.initial_fallback`。状态：`失败时条件触发`。

来源：[backend/app/modules/script_engine/generation_service.py:7964](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/generation_service.py:7964)。符号：`ScriptGenerationService._build_initial_draft_regeneration_fallback_prompt`。

完整根对象，不返回碎片或包装字段。

本页保留当前工作区原文，不是优化后的替代提示词，也不是某次模型调用的完整展开结果。

## 长文本阅读视图

按源码位置列出长字符串；静态文本按字符串值显示，花括号内动态表达式仅供识别，未执行。条件分支分别列出，不代表一次调用全部生效。短标签、拼装顺序和完整条件见后面的源码原文。

### 片段 1 · 源码第 7966 行

````text
{prompt}

The primary streamed screenplay request did not complete after bounded transport recovery. Generate
the same episode from the approved plan and continuity context. Preserve all approved
story obligations and character identities. Return one complete native JSON root object matching
the supplied schema. Output the shootable scenes before compact character/continuity ledgers.
Keep prose concise enough to finish every scene, character state update, the next-episode question,
and all closing delimiters. Do not re-plan, return a fragment, wrapper, Markdown, reasoning,
introduction, or commentary.
````

## 源码原文

此部分按原始行提取，保留缩进、条件、占位变量和全部短字符串。

````python
    @staticmethod
    def _build_initial_draft_regeneration_fallback_prompt(*, prompt: str) -> str:
        return f"""{prompt}

The primary streamed screenplay request did not complete after bounded transport recovery. Generate
the same episode from the approved plan and continuity context. Preserve all approved
story obligations and character identities. Return one complete native JSON root object matching
the supplied schema. Output the shootable scenes before compact character/continuity ledgers.
Keep prose concise enough to finish every scene, character state update, the next-episode question,
and all closing delimiters. Do not re-plan, return a fragment, wrapper, Markdown, reasoning,
introduction, or commentary."""
````

片段 SHA-256：`0ded90bf3e1a5992cce6bac296f59d8196f5ccd75ab8abd76f68a7a98c2c83c7`
