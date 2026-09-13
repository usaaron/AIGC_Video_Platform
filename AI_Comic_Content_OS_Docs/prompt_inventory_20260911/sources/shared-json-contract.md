# 按模型协议追加的JSON结构合同

编号：`shared-json-contract`。状态：`conditional`。

来源：[backend/app/modules/script_engine/llm_adapter.py:1544](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/llm_adapter.py:1544)。符号：`RealLLMAdapter._prompt_with_json_contract`。

严格schema通道可能直接使用请求schema；其他通道按条件追加JSON形状说明，不属于剧情规则。

本页保留当前工作区原文，不是优化后的替代提示词，也不是某次模型调用的完整展开结果。

## 长文本阅读视图

按源码位置列出长字符串；静态文本按字符串值显示，花括号内动态表达式仅供识别，未执行。条件分支分别列出，不代表一次调用全部生效。短标签、拼装顺序和完整条件见后面的源码原文。

### 片段 1 · 源码第 1588 行

````text
Required top-level root fields:
````

### 片段 2 · 源码第 1597 行

````text
{prompt}

{contract_title}
The API response format guarantees JSON syntax only. The following compact example
defines the complete field shape you must return. Replace placeholder values with the
requested story data, preserve exact technical enum/ID values, and do not omit required
nested fields. Objects and arrays must remain native JSON containers: never serialize a
child object or nested collection into a quoted JSON string unless the response schema
explicitly represents an unbounded dictionary as a JSON-encoded string. Do not return this example
inside another wrapper. The first and only JSON object must be the complete root object,
never one scene, character, state update, episode, dialogue, child, or array item.
{'For unbounded dictionary fields represented as strings by the response schema, return a JSON-encoded object string; the runtime will restore it to a native object.\n' if uses_stringified_dynamic_objects else ''}
{root_identity}<json_shape>
{json.dumps(shape, ensure_ascii=False, separators=(',', ':'))}
</json_shape>
Return exactly one json object now.
````

## 源码原文

此部分按原始行提取，保留缩进、条件、占位变量和全部短字符串。

````python
    def _prompt_with_json_contract(
        self,
        prompt: str,
        *,
        output_schema: dict[str, Any] | None,
    ) -> str:
        if output_schema is None:
            return prompt
        # Strict JSON-schema transports receive the complete schema in the
        # request body. Relaxed json_object transports guarantee syntax only,
        # so every model needs the compact native-container shape in its prompt.
        normalized_schema = self._provider_json_schema(output_schema)
        uses_stringified_dynamic_objects = (
            self._wire_api == "responses"
            and self._use_strict_schema
            and not self._supports_strict_json_schema(normalized_schema)
        )
        if (
            self._send_response_format
            and not self._is_deepseek
            and self._use_strict_schema
            and self._supports_strict_json_schema(normalized_schema)
        ):
            return prompt
        shape = self._json_shape_example(output_schema)
        properties = output_schema.get("properties")
        root_fields = (
            [name for name in properties if isinstance(name, str)]
            if isinstance(properties, dict)
            else []
        )
        required = output_schema.get("required")
        required_root_fields = (
            [name for name in required if isinstance(name, str)]
            if isinstance(required, list)
            else []
        )
        root_identity = (
            "Top-level root fields: " + ", ".join(root_fields) + ".\n"
            if root_fields
            else ""
        )
        if required_root_fields:
            root_identity += (
                "Required top-level root fields: "
                + ", ".join(required_root_fields)
                + ".\n"
            )
        contract_title = (
            "DEEPSEEK JSON OUTPUT CONTRACT"
            if self._is_deepseek
            else "JSON OUTPUT SHAPE CONTRACT"
        )
        return f"""{prompt}

{contract_title}
The API response format guarantees JSON syntax only. The following compact example
defines the complete field shape you must return. Replace placeholder values with the
requested story data, preserve exact technical enum/ID values, and do not omit required
nested fields. Objects and arrays must remain native JSON containers: never serialize a
child object or nested collection into a quoted JSON string unless the response schema
explicitly represents an unbounded dictionary as a JSON-encoded string. Do not return this example
inside another wrapper. The first and only JSON object must be the complete root object,
never one scene, character, state update, episode, dialogue, child, or array item.
{("For unbounded dictionary fields represented as strings by the response schema, return a JSON-encoded object string; the runtime will restore it to a native object.\n" if uses_stringified_dynamic_objects else "")}
{root_identity}<json_shape>
{json.dumps(shape, ensure_ascii=False, separators=(',', ':'))}
</json_shape>
Return exactly one json object now."""
````

片段 SHA-256：`1aa432a0b126fd8d521db88976dbee32ba2b5a2114efd38b6a297bbb1a971679`
