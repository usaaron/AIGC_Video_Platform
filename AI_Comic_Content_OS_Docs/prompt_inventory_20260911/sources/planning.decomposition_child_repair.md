# 单个残缺剧情子节点修复

编号：`planning.decomposition_child_repair`。状态：`active_conditional_repair`。

来源：[backend/app/modules/script_engine/story_planning_service.py:10513](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_planning_service.py:10513)。符号：`StoryPlanningService._build_decomposition_child_repair_prompt`。

只补当前子节点缺失/无效字段，保留兄弟交接。

本页保留当前工作区原文，不是优化后的替代提示词，也不是某次模型调用的完整展开结果。

## 长文本阅读视图

按源码位置列出长字符串；静态文本按字符串值显示，花括号内动态表达式仅供识别，未执行。条件分支分别列出，不代表一次调用全部生效。短标签、拼装顺序和完整条件见后面的源码原文。

### 片段 1 · 源码第 10528 行

````text
REPAIR ONE INCOMPLETE DECOMPOSITION CHILD
Return one complete child object only, not a children array and not the whole decomposition.
Preserve every usable value in the incomplete child. Fill only missing or invalid contract
fields, while keeping its episode range, causal role, references and sibling handoffs intact.

Child position: {child_index + 1} of {len(source_children)}
Incomplete child:
{json.dumps(previous_child, ensure_ascii=False, separators=(',', ':'))}
Previous sibling, for entry-state handoff only:
{json.dumps(previous_sibling, ensure_ascii=False, separators=(',', ':'))}
Next sibling, for exit-state handoff only:
{json.dumps(next_sibling, ensure_ascii=False, separators=(',', ':'))}
Contract failures for this child:
{json.dumps(validation_error.errors(include_input=False, include_url=False), ensure_ascii=False, separators=(',', ':'))}

Original decomposition constraints remain authoritative:
{contract_prompt}

Return exactly one complete StoryPlanNodeChildOutput JSON object. Do not rewrite or return
the other children. Do not use Markdown fences or explanatory text.
````

## 源码原文

此部分按原始行提取，保留缩进、条件、占位变量和全部短字符串。

````python
    @staticmethod
    def _build_decomposition_child_repair_prompt(
        *,
        contract_prompt: str,
        source_children: list[object],
        child_index: int,
        validation_error: ValidationError,
    ) -> str:
        previous_child = source_children[child_index]
        previous_sibling = source_children[child_index - 1] if child_index > 0 else None
        next_sibling = (
            source_children[child_index + 1]
            if child_index + 1 < len(source_children)
            else None
        )
        return f"""REPAIR ONE INCOMPLETE DECOMPOSITION CHILD
Return one complete child object only, not a children array and not the whole decomposition.
Preserve every usable value in the incomplete child. Fill only missing or invalid contract
fields, while keeping its episode range, causal role, references and sibling handoffs intact.

Child position: {child_index + 1} of {len(source_children)}
Incomplete child:
{json.dumps(previous_child, ensure_ascii=False, separators=(',', ':'))}
Previous sibling, for entry-state handoff only:
{json.dumps(previous_sibling, ensure_ascii=False, separators=(',', ':'))}
Next sibling, for exit-state handoff only:
{json.dumps(next_sibling, ensure_ascii=False, separators=(',', ':'))}
Contract failures for this child:
{json.dumps(validation_error.errors(include_input=False, include_url=False), ensure_ascii=False, separators=(',', ':'))}

Original decomposition constraints remain authoritative:
{contract_prompt}

Return exactly one complete StoryPlanNodeChildOutput JSON object. Do not rewrite or return
the other children. Do not use Markdown fences or explanatory text."""
````

片段 SHA-256：`9ee69cf86ef1de625a70fa0bafb1e3835d02862ca9e6816728e5659a64f678c4`
