# 结构校验失败的字段补丁

编号：`script.contract_patch`。状态：`结构校验失败时触发`。

来源：[backend/app/modules/script_engine/generation_service.py:8168](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/generation_service.py:8168)。符号：`ScriptGenerationService._build_draft_contract_repair_prompt`。

只替换指定顶层字段或完整数组，不改变剧情。

本页保留当前工作区原文，不是优化后的替代提示词，也不是某次模型调用的完整展开结果。

## 长文本阅读视图

按源码位置列出长字符串；静态文本按字符串值显示，花括号内动态表达式仅供识别，未执行。条件分支分别列出，不代表一次调用全部生效。短标签、拼装顺序和完整条件见后面的源码原文。

### 片段 1 · 源码第 8176 行

````text
Correct only the reported structural or semantic contract violations in an
otherwise complete episode JSON. Preserve the exact episode direction, character identities,
events, scene order, causal links, ending purpose, language, and body length. Do not introduce a
new conflict, rewrite the premise, or add commentary.

Return a JSON merge patch, not the whole episode. Include only the top-level fields that require
replacement. When one item inside an array is invalid, return that complete corrected top-level
array. The backend will merge the patch into the original episode and validate the complete result.
The patch must contain exactly these top-level fields: {', '.join(repair_fields)}. Do not flatten an
array item into the root object, do not use character names as object keys, and do not add null
placeholders for fields outside this list.

Validation errors:
{json.dumps(errors, ensure_ascii=False, separators=(',', ':'))}

Previous JSON:
{json.dumps(output, ensure_ascii=False, separators=(',', ':'))}

Return one JSON merge-patch object only. Do not use Markdown fences or explanatory text.
````

## 源码原文

此部分按原始行提取，保留缩进、条件、占位变量和全部短字符串。

````python
    @staticmethod
    def _build_draft_contract_repair_prompt(
        *,
        output: dict[str, object],
        validation_error: ValidationError,
        repair_fields: list[str],
    ) -> str:
        errors = validation_error.errors(include_url=False, include_context=False)
        return f"""Correct only the reported structural or semantic contract violations in an
otherwise complete episode JSON. Preserve the exact episode direction, character identities,
events, scene order, causal links, ending purpose, language, and body length. Do not introduce a
new conflict, rewrite the premise, or add commentary.

Return a JSON merge patch, not the whole episode. Include only the top-level fields that require
replacement. When one item inside an array is invalid, return that complete corrected top-level
array. The backend will merge the patch into the original episode and validate the complete result.
The patch must contain exactly these top-level fields: {', '.join(repair_fields)}. Do not flatten an
array item into the root object, do not use character names as object keys, and do not add null
placeholders for fields outside this list.

Validation errors:
{json.dumps(errors, ensure_ascii=False, separators=(',', ':'))}

Previous JSON:
{json.dumps(output, ensure_ascii=False, separators=(',', ':'))}

Return one JSON merge-patch object only. Do not use Markdown fences or explanatory text."""
````

片段 SHA-256：`5b032930349ab9255f1ffcaf8ce2c413f907736c08cea385005f609d1a7f5fb5`
