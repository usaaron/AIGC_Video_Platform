# 结构修复的整稿回退

编号：`script.contract_fallback`。状态：`结构修复失败时触发`。

来源：[backend/app/modules/script_engine/generation_service.py:8196](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/generation_service.py:8196)。符号：`ScriptGenerationService._build_full_draft_contract_fallback_prompt`。

不再返回片段，保留原稿可用内容。

本页保留当前工作区原文，不是优化后的替代提示词，也不是某次模型调用的完整展开结果。

## 长文本阅读视图

按源码位置列出长字符串；静态文本按字符串值显示，花括号内动态表达式仅供识别，未执行。条件分支分别列出，不代表一次调用全部生效。短标签、拼装顺序和完整条件见后面的源码原文。

### 片段 1 · 源码第 8205 行

````text
Use the approved story direction and episode facts present in the previous response. Do not invent a different plot.
````

### 片段 2 · 源码第 8208 行

````text
{source_prompt}

FULL DRAFT CONTRACT FALLBACK
{task}

The previous provider returned an incomplete root object or an invalid repair fragment.
Return one COMPLETE DraftMasterScript JSON object, never a merge patch, nested item,
character object, state-update object, or scene object. Preserve usable content from the
previous response. Do not add Markdown or commentary.

Validation errors:
{json.dumps(validation_error.errors(include_url=False, include_context=False), ensure_ascii=False, separators=(',', ':'))}

Previous response:
{json.dumps(output, ensure_ascii=False, separators=(',', ':'))}

Return exactly one complete JSON object matching the authoritative response schema.
````

## 源码原文

此部分按原始行提取，保留缩进、条件、占位变量和全部短字符串。

````python
    @staticmethod
    def _build_full_draft_contract_fallback_prompt(
        *,
        original_prompt: str | None,
        output: dict[str, object],
        validation_error: ValidationError,
        task: str,
    ) -> str:
        source_prompt = original_prompt or (
            "Use the approved story direction and episode facts present in the previous "
            "response. Do not invent a different plot."
        )
        return f"""{source_prompt}

FULL DRAFT CONTRACT FALLBACK
{task}

The previous provider returned an incomplete root object or an invalid repair fragment.
Return one COMPLETE DraftMasterScript JSON object, never a merge patch, nested item,
character object, state-update object, or scene object. Preserve usable content from the
previous response. Do not add Markdown or commentary.

Validation errors:
{json.dumps(validation_error.errors(include_url=False, include_context=False), ensure_ascii=False, separators=(',', ':'))}

Previous response:
{json.dumps(output, ensure_ascii=False, separators=(',', ':'))}

Return exactly one complete JSON object matching the authoritative response schema."""
````

片段 SHA-256：`a06097e399cb0aa86e31b5694c37eaa8cc86abf223d3e4a064849f581e635722`
