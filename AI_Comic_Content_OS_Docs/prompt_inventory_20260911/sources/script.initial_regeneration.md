# 空输出或JSON失败后重新生成

编号：`script.initial_regeneration`。状态：`失败时条件触发`。

来源：[backend/app/modules/script_engine/generation_service.py:7952](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/generation_service.py:7952)。符号：`ScriptGenerationService._build_initial_draft_regeneration_prompt`。

保留批准情节、连续性、人物和结尾，不重新规划。

本页保留当前工作区原文，不是优化后的替代提示词，也不是某次模型调用的完整展开结果。

## 长文本阅读视图

按源码位置列出长字符串；静态文本按字符串值显示，花括号内动态表达式仅供识别，未执行。条件分支分别列出，不代表一次调用全部生效。短标签、拼装顺序和完整条件见后面的源码原文。

### 片段 1 · 源码第 7954 行

````text
{prompt}

The previous transport attempt returned empty, truncated, or invalid JSON. Generate the
same requested episode again from the approved context. Do not change its planned story
beat, continuity state, character references, or ending obligation. Return one complete
native JSON object matching the supplied schema, with scenes before the compact state ledgers,
every scene and closing delimiter. Use high reasoning only to verify the approved plan; do not
re-plan the story or spend the output budget repeating the ledger.
Do not use Markdown fences, reasoning, introductions, or trailing commentary.
````

## 源码原文

此部分按原始行提取，保留缩进、条件、占位变量和全部短字符串。

````python
    @staticmethod
    def _build_initial_draft_regeneration_prompt(*, prompt: str) -> str:
        return f"""{prompt}

The previous transport attempt returned empty, truncated, or invalid JSON. Generate the
same requested episode again from the approved context. Do not change its planned story
beat, continuity state, character references, or ending obligation. Return one complete
native JSON object matching the supplied schema, with scenes before the compact state ledgers,
every scene and closing delimiter. Use high reasoning only to verify the approved plan; do not
re-plan the story or spend the output budget repeating the ledger.
Do not use Markdown fences, reasoning, introductions, or trailing commentary."""
````

片段 SHA-256：`5f271ac6c2196de4fb6c13c60e1c217b2ad4430aa749b1b2151f7e9d5a9d419e`
