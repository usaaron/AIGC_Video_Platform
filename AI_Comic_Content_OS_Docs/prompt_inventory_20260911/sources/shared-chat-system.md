# Chat传输的系统角色与结构化输出指令

编号：`shared-chat-system`。状态：`conditional`。

来源：[backend/app/modules/script_engine/llm_adapter.py:1473](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/llm_adapter.py:1473)。符号：`RealLLMAdapter._build_chat_payload`。

Chat路径最终外层系统指令；业务提示作为user消息提交。仅归档源码，未调用模型。

本页保留当前工作区原文，不是优化后的替代提示词，也不是某次模型调用的完整展开结果。

## 长文本阅读视图

按源码位置列出长字符串；静态文本按字符串值显示，花括号内动态表达式仅供识别，未执行。条件分支分别列出，不代表一次调用全部生效。短标签、拼装顺序和完整条件见后面的源码原文。

### 片段 1 · 源码第 1491 行

````text
You generate structured dramatic scripts. When JSON is requested, return exactly one valid JSON object with no Markdown or explanatory text and follow its field shape exactly.
````

## 源码原文

此部分按原始行提取，保留缩进、条件、占位变量和全部短字符串。

````python
    def _build_chat_payload(
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
            self._protocol.chat_token_limit_key: strategy.max_tokens,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "You generate structured dramatic scripts. When JSON is "
                        "requested, return exactly one valid JSON object with no "
                        "Markdown or explanatory text and follow its field shape exactly."
                    ),
                },
                {"role": "user", "content": structured_prompt},
            ],
        }
        if self._is_deepseek:
            thinking_mode = self._thinking_mode or "enabled"
            payload["thinking"] = {"type": thinking_mode}
            if thinking_mode == "enabled":
                if self._effective_reasoning_effort is not None:
                    payload["reasoning_effort"] = self._effective_reasoning_effort
            else:
                payload["temperature"] = strategy.temperature
                payload["top_p"] = strategy.top_p
        elif self._is_glm or self._is_qwen:
            thinking_mode = self._thinking_mode or "enabled"
            payload["thinking"] = {"type": thinking_mode}
            if thinking_mode == "disabled":
                payload["reasoning_effort"] = "none"
            elif self._effective_reasoning_effort is not None:
                payload["reasoning_effort"] = self._effective_reasoning_effort
            payload["temperature"] = strategy.temperature
            payload["top_p"] = strategy.top_p
        elif self._protocol.family == "openai_reasoning":
            if self._effective_reasoning_effort is not None:
                payload["reasoning_effort"] = self._effective_reasoning_effort
        else:
            payload["temperature"] = strategy.temperature
            payload["top_p"] = strategy.top_p
            if self._protocol.family == "gemini" and self._effective_reasoning_effort is not None:
                payload["reasoning_effort"] = self._effective_reasoning_effort
        response_format_type = self._protocol.chat_response_format_type(
            strict=self._use_strict_schema,
            thinking=payload.get("thinking", {}).get("type"),
        )
        if output_schema and self._send_response_format and response_format_type:
            if response_format_type == "json_schema":
                strict_schema = self._provider_json_schema(output_schema)
                payload["response_format"] = {
                    "type": "json_schema",
                    "json_schema": {
                        "name": self._structured_output_name(output_schema),
                        "strict": True,
                        "schema": strict_schema,
                    },
                }
            else:
                payload["response_format"] = {"type": "json_object"}
        return payload
````

片段 SHA-256：`fcafbd85810386b3b69484b8feff7ad2702ce7f1bfe2ee1d616a07b84a15ed51`
