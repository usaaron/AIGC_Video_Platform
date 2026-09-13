# 总纲语言与身份一致性修复

编号：`planning.bible_quality_repair`。状态：`active_conditional_repair`。

来源：[backend/app/modules/script_engine/story_planning_service.py:12885](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_planning_service.py:12885)。符号：`StoryPlanningService._build_story_bible_quality_repair_prompt`。

只修报告的问题，保留关系、故事线、伏笔和结局方向。

本页保留当前工作区原文，不是优化后的替代提示词，也不是某次模型调用的完整展开结果。

## 长文本阅读视图

按源码位置列出长字符串；静态文本按字符串值显示，花括号内动态表达式仅供识别，未执行。条件分支分别列出，不代表一次调用全部生效。短标签、拼装顺序和完整条件见后面的源码原文。

### 片段 1 · 源码第 12896 行

````text
- {item.character_ref}: {item.name}（{item.role}）
````

### 片段 2 · 源码第 12899 行

````text
{market_contract.prompt_contract}
You are repairing the Story Bible for a serialized comic story.
Apply the established knowledge_bundle.draft.cn_mainland_longform_foundation.v1 constraints.
Use these principles as bounded guidance, not rigid plot formulas.
The previous JSON was structurally valid but failed one or more Story Bible quality gates.
Repair only the listed language and identity issues. Preserve the existing story direction, plot facts,
relationships, story lines, setup/payoff intent, and ending direction.
Do not add scenes or episode planning. Do not assign episode numbers or episode ranges in the Story Bible.
All human-readable output values must be written in {market_contract.language_name}.
{STORY_LINE_BALANCE_CONTRACT}
{STORY_BIBLE_LENGTH_TARGET_CONTRACT}

Human-readable fields requiring Simplified Chinese repair:
{json.dumps(non_chinese_fields, ensure_ascii=False, separators=(',', ':'))}

User-authoritative characters:
{supplied_text}

Detected consistency issues:
{json.dumps(consistency_issues, ensure_ascii=False, separators=(',', ':'))}

Required repair:
1. Rewrite only listed human-readable values in the market contract language. Never change IDs or refs.
2. character_registry must contain exactly one canonical language-appropriate name and role for every character_ref.
3. Supplied character names and refs are immutable; never rename them.
4. Do not use a character's own name after a kinship term such as 母亲、父亲、儿子、女儿、哥哥、姐姐、丈夫、妻子.
5. If a related character has no confirmed name, use a stable role label such as 母亲, not another character's name.
6. Return the complete corrected JSON object, not a patch.

Previous JSON:
{output.model_dump_json()}

Return one corrected JSON object only.
````

## 源码原文

此部分按原始行提取，保留缩进、条件、占位变量和全部短字符串。

````python
    @staticmethod
    def _build_story_bible_quality_repair_prompt(
        *,
        output: StoryBibleGenerationOutput,
        supplied_characters: list[StoryBibleCharacterInput],
        non_chinese_fields: list[str],
        consistency_issues: list[str],
        market_profile: str = "cn_mainland",
    ) -> str:
        market_contract = market_profile_contract(market_profile)
        supplied_text = "\n".join(
            f"- {item.character_ref}: {item.name}（{item.role}）"
            for item in supplied_characters
        ) or "- 无用户预设角色；请从现有输出建立稳定的规范角色登记表。"
        return f"""{market_contract.prompt_contract}
You are repairing the Story Bible for a serialized comic story.
Apply the established knowledge_bundle.draft.cn_mainland_longform_foundation.v1 constraints.
Use these principles as bounded guidance, not rigid plot formulas.
The previous JSON was structurally valid but failed one or more Story Bible quality gates.
Repair only the listed language and identity issues. Preserve the existing story direction, plot facts,
relationships, story lines, setup/payoff intent, and ending direction.
Do not add scenes or episode planning. Do not assign episode numbers or episode ranges in the Story Bible.
All human-readable output values must be written in {market_contract.language_name}.
{STORY_LINE_BALANCE_CONTRACT}
{STORY_BIBLE_LENGTH_TARGET_CONTRACT}

Human-readable fields requiring Simplified Chinese repair:
{json.dumps(non_chinese_fields, ensure_ascii=False, separators=(',', ':'))}

User-authoritative characters:
{supplied_text}

Detected consistency issues:
{json.dumps(consistency_issues, ensure_ascii=False, separators=(',', ':'))}

Required repair:
1. Rewrite only listed human-readable values in the market contract language. Never change IDs or refs.
2. character_registry must contain exactly one canonical language-appropriate name and role for every character_ref.
3. Supplied character names and refs are immutable; never rename them.
4. Do not use a character's own name after a kinship term such as 母亲、父亲、儿子、女儿、哥哥、姐姐、丈夫、妻子.
5. If a related character has no confirmed name, use a stable role label such as 母亲, not another character's name.
6. Return the complete corrected JSON object, not a patch.

Previous JSON:
{output.model_dump_json()}

Return one corrected JSON object only."""
````

片段 SHA-256：`4bf03b1a97dc7242187fba64bfc0ef77387a3347aad820c584dbb90c76966c1b`
