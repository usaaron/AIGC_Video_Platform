# 总纲缺失合同字段恢复

编号：`planning.bible_recovery`。状态：`active_conditional_recovery`。

来源：[backend/app/modules/script_engine/story_planning_service.py:12817](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_planning_service.py:12817)。符号：`StoryPlanningService._build_story_bible_contract_recovery_prompt`。

只补当前候选缺失/畸形字段，不新增支线或场景。

本页保留当前工作区原文，不是优化后的替代提示词，也不是某次模型调用的完整展开结果。

## 长文本阅读视图

按源码位置列出长字符串；静态文本按字符串值显示，花括号内动态表达式仅供识别，未执行。条件分支分别列出，不代表一次调用全部生效。短标签、拼装顺序和完整条件见后面的源码原文。

### 片段 1 · 源码第 12829 行

````text
{item.character_ref}={item.name}（{item.role}）
````

### 片段 2 · 源码第 12833 行

````text
{market_contract.prompt_contract}
You are completing a partially generated Story Bible for a serialized comic story.
The candidate below is the sole narrative source. Preserve every existing plot fact,
identity, relationship direction, and ending direction. Fill only missing or malformed
contract fields; do not add scenes, dialogue, episode numbers, episode ranges, or new
subplots. Keep the result concise because the recursive story tree and episode roadmap
will provide the detail later. All human-readable values must be written in
{market_contract.language_name}.
Apply knowledge_bundle.draft.cn_mainland_longform_foundation.v1 as bounded guidance,
not as a rigid plot formula.
{STORY_LINE_BALANCE_CONTRACT}
{STORY_BIBLE_LENGTH_TARGET_CONTRACT}

User-authoritative characters: {supplied_text}
Validation errors:
{json.dumps(errors, ensure_ascii=False, separators=(',', ':'))}

Candidate JSON:
{json.dumps({key: value for key, value in candidate.items() if key != '_meta'}, ensure_ascii=False, separators=(',', ':'))}

Return one complete JSON object matching the StoryBibleGenerationOutput schema exactly.
````

## 源码原文

此部分按原始行提取，保留缩进、条件、占位变量和全部短字符串。

````python
    @staticmethod
    def _build_story_bible_contract_recovery_prompt(
        *,
        candidate: dict[str, object],
        validation_error: ValidationError,
        supplied_characters: list[StoryBibleCharacterInput],
        market_profile: str = "cn_mainland",
    ) -> str:
        """Ask for a compact completion when a repair still misses the contract."""

        market_contract = market_profile_contract(market_profile)
        supplied_text = ", ".join(
            f"{item.character_ref}={item.name}（{item.role}）"
            for item in supplied_characters
        ) or "无用户预设角色"
        errors = validation_error.errors(include_input=False, include_url=False)
        return f"""{market_contract.prompt_contract}
You are completing a partially generated Story Bible for a serialized comic story.
The candidate below is the sole narrative source. Preserve every existing plot fact,
identity, relationship direction, and ending direction. Fill only missing or malformed
contract fields; do not add scenes, dialogue, episode numbers, episode ranges, or new
subplots. Keep the result concise because the recursive story tree and episode roadmap
will provide the detail later. All human-readable values must be written in
{market_contract.language_name}.
Apply knowledge_bundle.draft.cn_mainland_longform_foundation.v1 as bounded guidance,
not as a rigid plot formula.
{STORY_LINE_BALANCE_CONTRACT}
{STORY_BIBLE_LENGTH_TARGET_CONTRACT}

User-authoritative characters: {supplied_text}
Validation errors:
{json.dumps(errors, ensure_ascii=False, separators=(',', ':'))}

Candidate JSON:
{json.dumps({key: value for key, value in candidate.items() if key != '_meta'}, ensure_ascii=False, separators=(',', ':'))}

Return one complete JSON object matching the StoryBibleGenerationOutput schema exactly."""
````

片段 SHA-256：`a4b23bcac456ff07828f2c5ae1d5669c96fce7c35c21245e2d0941e7fbed5a2c`
