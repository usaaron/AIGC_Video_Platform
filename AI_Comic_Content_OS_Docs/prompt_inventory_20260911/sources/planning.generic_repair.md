# 通用规划 JSON/字段修复

编号：`planning.generic_repair`。状态：`active_conditional_repair`。

来源：[backend/app/modules/script_engine/story_planning_service.py:10428](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_planning_service.py:10428)。符号：`StoryPlanningService._build_planning_output_repair_prompt`。

保留故事意思、批准引用和范围，修具体结构失败。

本页保留当前工作区原文，不是优化后的替代提示词，也不是某次模型调用的完整展开结果。

## 长文本阅读视图

按源码位置列出长字符串；静态文本按字符串值显示，花括号内动态表达式仅供识别，未执行。条件分支分别列出，不代表一次调用全部生效。短标签、拼装顺序和完整条件见后面的源码原文。

### 片段 1 · 源码第 10443 行

````text
The response was not valid JSON.
````

### 片段 2 · 源码第 10461 行

````text
{contract_prompt}

The previous response did not satisfy the structured planning contract.
Repair only its JSON format and contract fields. Preserve the requested story meaning,
approved references, ranges, and constraints. Do not add unrelated plot facts.
Failure details:
{failure}

Previous JSON or raw model response when available:
<previous_response>
{previous_json}
</previous_response>

Return one corrected JSON object only. Do not use Markdown fences or explanatory text.
````

## 源码原文

此部分按原始行提取，保留缩进、条件、占位变量和全部短字符串。

````python
    @staticmethod
    def _build_planning_output_repair_prompt(
        *,
        contract_prompt: str,
        generated: dict[str, object] | None,
        validation_error: ValidationError | None,
        structured_error: LLMStructuredOutputError | None,
    ) -> str:
        if validation_error is not None:
            failure = json.dumps(
                validation_error.errors(include_input=False, include_url=False),
                ensure_ascii=False,
                separators=(",", ":"),
            )
        else:
            failure = str(structured_error or "The response was not valid JSON.")
        if generated is not None:
            previous_json = json.dumps(
                {key: value for key, value in generated.items() if key != "_meta"},
                ensure_ascii=False,
                separators=(",", ":"),
            )
        elif structured_error is not None and structured_error.raw_content:
            raw_content = structured_error.raw_content.strip()
            if len(raw_content) > 60_000:
                raw_content = (
                    raw_content[:45_000]
                    + "\n[中间内容因修复上下文预算省略]\n"
                    + raw_content[-15_000:]
                )
            previous_json = raw_content
        else:
            previous_json = "不可用；上一响应没有返回可恢复的文本。"
        return f"""{contract_prompt}

The previous response did not satisfy the structured planning contract.
Repair only its JSON format and contract fields. Preserve the requested story meaning,
approved references, ranges, and constraints. Do not add unrelated plot facts.
Failure details:
{failure}

Previous JSON or raw model response when available:
<previous_response>
{previous_json}
</previous_response>

Return one corrected JSON object only. Do not use Markdown fences or explanatory text."""
````

片段 SHA-256：`f9049d639e07de6d7c891fb4383d01882bc0a8ef60b9a025d18711f94acf58c7`
