# 总纲结构与合同修复

编号：`planning.bible_repair`。状态：`active_conditional_repair`。

来源：[backend/app/modules/script_engine/story_planning_service.py:12757](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_planning_service.py:12757)。符号：`StoryPlanningService._build_story_bible_repair_prompt`。

保留故事意思、人物登记与用户预设角色。

本页保留当前工作区原文，不是优化后的替代提示词，也不是某次模型调用的完整展开结果。

## 长文本阅读视图

按源码位置列出长字符串；静态文本按字符串值显示，花括号内动态表达式仅供识别，未执行。条件分支分别列出，不代表一次调用全部生效。短标签、拼装顺序和完整条件见后面的源码原文。

### 片段 1 · 源码第 12780 行

````text
The previous JSON already contains the authoritative creative direction and story facts for this {'Chinese mainland serialized comic story' if market_contract.is_mainland else 'serialized comic story'}. Use it as the sole narrative source. Apply the established knowledge_bundle.draft.cn_mainland_longform_foundation.v1 constraints. Use these principles as bounded guidance, not rigid plot formulas.
````

### 片段 2 · 源码第 12788 行

````text
- {item.character_ref}: {item.name}（{item.role}）
````

### 片段 3 · 源码第 12791 行

````text
{source_context}

{STORY_BIBLE_LENGTH_TARGET_CONTRACT}

The previous JSON did not satisfy the Story Bible contract.
Repair its structure without changing its story meaning. Do not add new plot facts.
{STORY_LINE_BALANCE_CONTRACT}
Do not assign episode numbers or episode ranges in the Story Bible.
All human-readable output values must be written in {market_contract.language_name}.
Validation errors:
{json.dumps(errors, ensure_ascii=False, separators=(',', ':'))}

For every item in character_arc_targets, put character_ref, external_goal,
internal_need, starting_state, target_state, key_turning_points, and
protected_traits directly on that item. Do not wrap them in an arc_target
object and do not emit an extra arc_target field.
Keep every human-readable narrative value in natural Simplified Chinese. Ensure
character_registry and character_refs match exactly; all arc, relationship and story-line
refs must use that same identity ledger. User-authoritative characters are immutable:
{supplied_text}

Previous JSON:
{json.dumps(raw_output, ensure_ascii=False, separators=(',', ':'))}

Return one corrected JSON object only.
````

## 源码原文

此部分按原始行提取，保留缩进、条件、占位变量和全部短字符串。

````python
    @staticmethod
    def _build_story_bible_repair_prompt(
        *,
        original_prompt: str | None,
        generated: dict[str, object],
        supplied_characters: list[StoryBibleCharacterInput],
        validation_error: ValidationError | None,
        structured_error: LLMStructuredOutputError | None = None,
        market_profile: str = "cn_mainland",
    ) -> str:
        market_contract = market_profile_contract(market_profile)
        raw_output = {
            key: value for key, value in generated.items() if key != "_meta"
        }
        errors = (
            validation_error.errors(include_input=False, include_url=False)
            if validation_error is not None
            else [{"type": "structured_output", "msg": str(structured_error)}]
        )
        source_context = (
            original_prompt
            if original_prompt is not None
            else (
                "The previous JSON already contains the authoritative creative direction "
                f"and story facts for this {'Chinese mainland serialized comic story' if market_contract.is_mainland else 'serialized comic story'}. Use it "
                "as the sole narrative source. Apply the established "
                "knowledge_bundle.draft.cn_mainland_longform_foundation.v1 constraints. "
                "Use these principles as bounded guidance, not rigid plot formulas."
            )
        )
        supplied_text = "\n".join(
            f"- {item.character_ref}: {item.name}（{item.role}）"
            for item in supplied_characters
        ) or "- 无用户预设角色。"
        return f"""{source_context}

{STORY_BIBLE_LENGTH_TARGET_CONTRACT}

The previous JSON did not satisfy the Story Bible contract.
Repair its structure without changing its story meaning. Do not add new plot facts.
{STORY_LINE_BALANCE_CONTRACT}
Do not assign episode numbers or episode ranges in the Story Bible.
All human-readable output values must be written in {market_contract.language_name}.
Validation errors:
{json.dumps(errors, ensure_ascii=False, separators=(',', ':'))}

For every item in character_arc_targets, put character_ref, external_goal,
internal_need, starting_state, target_state, key_turning_points, and
protected_traits directly on that item. Do not wrap them in an arc_target
object and do not emit an extra arc_target field.
Keep every human-readable narrative value in natural Simplified Chinese. Ensure
character_registry and character_refs match exactly; all arc, relationship and story-line
refs must use that same identity ledger. User-authoritative characters are immutable:
{supplied_text}

Previous JSON:
{json.dumps(raw_output, ensure_ascii=False, separators=(',', ':'))}

Return one corrected JSON object only."""
````

片段 SHA-256：`0fefb9bfca233ee5b718544cd1b8b3643a614ebe1cdc1482b63b07836e369e8b`
