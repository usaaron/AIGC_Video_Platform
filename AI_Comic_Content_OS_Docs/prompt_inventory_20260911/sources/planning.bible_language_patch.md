# 总纲可读字段语言补丁

编号：`planning.bible_language_patch`。状态：`active_conditional_repair`。

来源：[backend/app/modules/script_engine/story_planning_service.py:12855](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_planning_service.py:12855)。符号：`StoryPlanningService._build_story_bible_language_patch_prompt`。

仅修列出的路径，不改结构、引用、身份或因果。

本页保留当前工作区原文，不是优化后的替代提示词，也不是某次模型调用的完整展开结果。

## 长文本阅读视图

按源码位置列出长字符串；静态文本按字符串值显示，花括号内动态表达式仅供识别，未执行。条件分支分别列出，不代表一次调用全部生效。短标签、拼装顺序和完整条件见后面的源码原文。

### 片段 1 · 源码第 12869 行

````text
{market_contract.prompt_contract}

Repair only the listed human-readable fields in an already valid creator-facing Story Bible.
Return exactly one patch for every listed path and no other paths. Rewrite each value in
natural {market_contract.language_name} while preserving its full meaning, named identities, plot facts,
causal direction and dramatic specificity. Do not change IDs, refs, list order, structure,
story direction, or add new facts.

Binding story anchors:
{json.dumps(anchors, ensure_ascii=False, separators=(',', ':'))}

Exact field paths and current values:
{json.dumps(field_values, ensure_ascii=False, separators=(',', ':'))}

Return only JSON matching the patch schema.
````

## 源码原文

此部分按原始行提取，保留缩进、条件、占位变量和全部短字符串。

````python
    @staticmethod
    def _build_story_bible_language_patch_prompt(
        *,
        field_values: dict[str, object],
        output: StoryBibleGenerationOutput,
        market_profile: str = "cn_mainland",
    ) -> str:
        anchors = {
            "project_title": output.project_title,
            "core_premise": output.core_premise,
            "central_conflict": output.central_conflict,
            "ending_direction": output.ending_direction,
        }
        market_contract = market_profile_contract(market_profile)
        return f"""{market_contract.prompt_contract}

Repair only the listed human-readable fields in an already valid creator-facing Story Bible.
Return exactly one patch for every listed path and no other paths. Rewrite each value in
natural {market_contract.language_name} while preserving its full meaning, named identities, plot facts,
causal direction and dramatic specificity. Do not change IDs, refs, list order, structure,
story direction, or add new facts.

Binding story anchors:
{json.dumps(anchors, ensure_ascii=False, separators=(',', ':'))}

Exact field paths and current values:
{json.dumps(field_values, ensure_ascii=False, separators=(',', ':'))}

Return only JSON matching the patch schema."""
````

片段 SHA-256：`54cf759c489246c35f917bd23daaef860548d701dd790fb6de8adaac9ab2503b`
