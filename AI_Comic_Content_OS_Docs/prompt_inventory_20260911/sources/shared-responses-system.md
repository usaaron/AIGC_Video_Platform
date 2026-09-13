# Responses传输的系统角色与结构化输出指令

编号：`shared-responses-system`。状态：`conditional`。

来源：[backend/app/modules/script_engine/llm_adapter.py:1807](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/llm_adapter.py:1807)。符号：`RealLLMAdapter._build_responses_payload`。

Responses路径外层指令，与Chat路径按实际模型配置择一使用。

本页保留当前工作区原文，不是优化后的替代提示词，也不是某次模型调用的完整展开结果。

## 长文本阅读视图

按源码位置列出长字符串；静态文本按字符串值显示，花括号内动态表达式仅供识别，未执行。条件分支分别列出，不代表一次调用全部生效。短标签、拼装顺序和完整条件见后面的源码原文。

### 片段 1 · 源码第 1831 行

````text
You generate structured dramatic scripts. Follow the supplied JSON schema exactly. When JSON object mode is used, return valid json.
````

## 源码原文

此部分按原始行提取，保留缩进、条件、占位变量和全部短字符串。

````python
    def _build_responses_payload(
        self,
        *,
        prompt: str,
        strategy: GenerationStrategy,
        output_schema: dict[str, Any] | None,
    ) -> dict[str, Any]:
        structured_prompt = self._prompt_with_json_contract(
            prompt,
            output_schema=output_schema,
        )
        payload: dict[str, Any] = {
            "model": self._model_name,
            "max_output_tokens": strategy.max_tokens,
            "store": False,
            "input": [
                {
                    "role": "system",
                    # A few OpenAI-compatible Responses gateways only inspect
                    # string-valued message content when validating the
                    # json_object precondition. Keep this as a plain string;
                    # the official Responses API accepts both string and
                    # typed-content forms.
                    "content": (
                        "You generate structured dramatic scripts. "
                        "Follow the supplied JSON schema exactly. "
                        "When JSON object mode is used, return valid json."
                    ),
                },
                {
                    "role": "user",
                    "content": structured_prompt,
                },
            ],
        }
        if self._effective_reasoning_effort is not None:
            payload["reasoning"] = {"effort": self._effective_reasoning_effort}
        if output_schema and self._send_response_format:
            normalized_schema = self._provider_json_schema(output_schema)
            if self._use_strict_schema and self._supports_strict_json_schema(normalized_schema):
                payload["text"] = {
                    "format": {
                        "type": "json_schema",
                        "name": self._structured_output_name(output_schema),
                        "strict": True,
                        "schema": normalized_schema,
                    }
                }
            elif self._use_strict_schema:
                # This gateway rejects Responses ``json_object`` outright and
                # also rejects unbounded ``additionalProperties`` in strict
                # schemas. Encode only those dynamic dictionaries as JSON
                # strings; the response is decoded back to native objects
                # after extraction and before service validation.
                payload["text"] = {
                    "format": {
                        "type": "json_schema",
                        "name": self._structured_output_name(output_schema),
                        "strict": True,
                        "schema": self._stringify_dynamic_objects_for_strict_schema(
                            normalized_schema
                        ),
                    }
                }
            else:
                # OpenAI-compatible gateways reject strict schemas that contain
                # unbounded dictionaries (for example interactive planning's
                # step-specific ``fields`` object). Keep JSON mode so the
                # prompt contract and Pydantic validation still enforce the
                # response shape without sending an impossible schema.
                payload["text"] = {"format": {"type": "json_object"}}
        return payload
````

片段 SHA-256：`23ca3ec377f521f27ae635e4b4a44a511abf68ec37b303e1d7211f403a968532`
