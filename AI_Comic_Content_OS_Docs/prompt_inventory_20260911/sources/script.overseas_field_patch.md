# 海外语言字段窄修复及重试

编号：`script.overseas_field_patch`。状态：`可选编辑器海外语言修复条件触发`。

来源：[backend/app/modules/script_engine/script_post_editor.py:1459](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/script_post_editor.py:1459)。符号：`ScriptPostEditor._apply_language_field_patch`。

方法内嵌完整模型提示，字段级JSON补丁；不能改语义和剧情。

本页保留当前工作区原文，不是优化后的替代提示词，也不是某次模型调用的完整展开结果。

## 长文本阅读视图

按源码位置列出长字符串；静态文本按字符串值显示，花括号内动态表达式仅供识别，未执行。条件分支分别列出，不代表一次调用全部生效。短标签、拼装顺序和完整条件见后面的源码原文。

### 片段 1 · 源码第 1472 行

````text

这是上一次字段补丁未通过语言校验后的最后一次窄修复。dialogues.text必须至少包含一个可说的英文词和两个拉丁字母，不能只返回省略号、标点、中文、拼音或中英混写；沉默、犹豫或反应也要写成符合原意的简短美式英语台词。chinese_translation必须是对应当前英文text的自然简体中文，不得返回英文。chinese_character_name必须是该说话人的简体中文名，不得返回英文名。
````

### 片段 2 · 源码第 1481 行

````text
你现在同时是剧本大师和语言大师。只修复下列海外短剧正文中的语言字段，
不得重写整集，不得改变剧情事实、语义、人物意图、情绪强度、称谓关系或信息量。

每集总合同：
````

### 片段 3 · 源码第 1487 行

````text


规则：
1. title、logline、synopsis、hook、episode_goal、next_episode_question、人物资料、状态信息、
   场景标题/描述、scene_causality、character_actions和dialogues.intent只用简体中文；动作中出现的人名也写中文。
2. dialogues.text只用自然、简洁、可表演的美式英语，保留原句含义和潜台词。
3. dialogues.chinese_translation只用简体中文，必须准确对应同一条dialogues.text的
含义、语气、称谓和信息量，不得另写剧情或翻译其他字段。
逐句保留动作主体、具体行为、对象、因果、否定、时态与确定程度；不得把明确执行者的具体行为
改写为无主体的结果，也不得擅自补出原句未指明的执行者。屏幕、材料和受众的指代沿用给定上下文，
不得把操作端预览改成观众已看见，或把未向外发布改成从未向任何人展示。
4. dialogues.chinese_character_name只写character_name对应人物的稳定简体中文名；character_name本身保持稳定英文名。
5. 每个给定path必须且只能返回一次，path必须原样复制，不得返回其他字段。
6. value只填写修复后的纯文本，不要解释，不要Markdown。
7. dialogues.text不能只写省略号或标点；即使原值表示沉默或犹豫，也必须根据说话人、intent和
相邻台词改成不改变剧情事实的简短美式英语可说台词。
````

## 源码原文

此部分按原始行提取，保留缩进、条件、占位变量和全部短字符串。

````python
    def _apply_language_field_patch(
        self,
        payload: dict[str, object],
        *,
        paths: list[str],
        strategy: GenerationStrategy,
        focused: bool,
        cancel_event: threading.Event | None = None,
    ) -> None:
        if cancel_event is not None and cancel_event.is_set():
            raise LLMRequestCancelledError()
        repair_items = [self._language_field_repair_item(payload, path) for path in paths]
        retry_rule = (
            "\n这是上一次字段补丁未通过语言校验后的最后一次窄修复。"
            "dialogues.text必须至少包含一个可说的英文词和两个拉丁字母，不能只返回省略号、"
            "标点、中文、拼音或中英混写；沉默、犹豫或反应也要写成符合原意的简短美式英语台词。"
            "chinese_translation必须是对应当前英文text的自然简体中文，不得返回英文。"
            "chinese_character_name必须是该说话人的简体中文名，不得返回英文名。"
            if focused
            else ""
        )
        raw_patch = self._llm_adapter.generate_structured_output(
            """你现在同时是剧本大师和语言大师。只修复下列海外短剧正文中的语言字段，
不得重写整集，不得改变剧情事实、语义、人物意图、情绪强度、称谓关系或信息量。

每集总合同：
"""
            + OVERSEAS_EPISODE_LANGUAGE_WORKFLOW_CONTRACT
            + """

规则：
1. title、logline、synopsis、hook、episode_goal、next_episode_question、人物资料、状态信息、
   场景标题/描述、scene_causality、character_actions和dialogues.intent只用简体中文；动作中出现的人名也写中文。
2. dialogues.text只用自然、简洁、可表演的美式英语，保留原句含义和潜台词。
3. dialogues.chinese_translation只用简体中文，必须准确对应同一条dialogues.text的
含义、语气、称谓和信息量，不得另写剧情或翻译其他字段。
逐句保留动作主体、具体行为、对象、因果、否定、时态与确定程度；不得把明确执行者的具体行为
改写为无主体的结果，也不得擅自补出原句未指明的执行者。屏幕、材料和受众的指代沿用给定上下文，
不得把操作端预览改成观众已看见，或把未向外发布改成从未向任何人展示。
4. dialogues.chinese_character_name只写character_name对应人物的稳定简体中文名；character_name本身保持稳定英文名。
5. 每个给定path必须且只能返回一次，path必须原样复制，不得返回其他字段。
6. value只填写修复后的纯文本，不要解释，不要Markdown。
7. dialogues.text不能只写省略号或标点；即使原值表示沉默或犹豫，也必须根据说话人、intent和
相邻台词改成不改变剧情事实的简短美式英语可说台词。
"""
            + retry_rule
            + """

待修字段：
"""
            + json.dumps(repair_items, ensure_ascii=False, separators=(",", ":")),
            strategy=strategy.model_copy(
                update={
                    "max_tokens": min(
                        EDITOR_LANGUAGE_PATCH_MAX_OUTPUT_TOKENS,
                        max(
                            strategy.max_tokens,
                            EDITOR_LANGUAGE_PATCH_MIN_OUTPUT_TOKENS,
                        ),
                    ),
                    "temperature": min(strategy.temperature, EDITOR_TEMPERATURE),
                }
            ),
            output_schema=_ScriptLanguagePatchOutput.model_json_schema(),
        )
        if cancel_event is not None and cancel_event.is_set():
            raise LLMRequestCancelledError()
        normalized = {key: value for key, value in raw_patch.items() if key != "_meta"}
        patch = _ScriptLanguagePatchOutput.model_validate(normalized)
        actual_paths = [item.path for item in patch.patches]
        if len(actual_paths) != len(set(actual_paths)) or set(actual_paths) != set(
            paths
        ):
            raise ValueError("语言字段补丁必须完整且只能覆盖指定路径。")

        for item in patch.patches:
            self._set_language_field_value(
                payload,
                path=item.path,
                value=item.value.strip(),
            )
````

片段 SHA-256：`76501c410a741720461fff257744de4eadc09b14005b5a7ac907d2b9f8fffb03`
