# 规划输出结构附加合同

编号：`planning.schema_wrapper`。状态：`active_shared`。

来源：[backend/app/modules/script_engine/story_planning_service.py:10413](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_planning_service.py:10413)。符号：`StoryPlanningService._with_authoritative_schema`。

向提示附加 JSON 根字段和返回方式。

本页保留当前工作区原文，不是优化后的替代提示词，也不是某次模型调用的完整展开结果。

## 长文本阅读视图

按源码位置列出长字符串；静态文本按字符串值显示，花括号内动态表达式仅供识别，未执行。条件分支分别列出，不代表一次调用全部生效。短标签、拼装顺序和完整条件见后面的源码原文。

### 片段 1 · 源码第 10420 行

````text
{prompt}

Authoritative JSON contract: attached by the runtime through strict response format or a compact
native-container shape, according to the selected model transport.
Required top-level fields: {field_names or 'use the supplied schema fields'}.

Return one JSON object only. Do not use Markdown fences or add explanatory text.
````

## 源码原文

此部分按原始行提取，保留缩进、条件、占位变量和全部短字符串。

````python
    @staticmethod
    def _with_authoritative_schema(
        prompt: str,
        output_schema: dict[str, object],
    ) -> str:
        properties = output_schema.get("properties")
        field_names = ", ".join(properties) if isinstance(properties, dict) else ""
        return f"""{prompt}

Authoritative JSON contract: attached by the runtime through strict response format or a compact
native-container shape, according to the selected model transport.
Required top-level fields: {field_names or 'use the supplied schema fields'}.

Return one JSON object only. Do not use Markdown fences or add explanatory text."""
````

片段 SHA-256：`9a03eb671c52b20638160520de6a33a7f5aa55ded569af49bb51b6362ce207a1`
