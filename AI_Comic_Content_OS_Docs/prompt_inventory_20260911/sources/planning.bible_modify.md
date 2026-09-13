# 故事总纲修改与重写提示

编号：`planning.bible_modify`。状态：`active_editor`。

来源：[backend/app/modules/script_engine/story_planning_service.py:5607](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_planning_service.py:5607)。符号：`StoryPlanningService._build_story_bible_modification_prompt`。

revision_mode 区分局部修订与整篇重写，支持选中文本及依赖字段联动。

本页保留当前工作区原文，不是优化后的替代提示词，也不是某次模型调用的完整展开结果。

## 长文本阅读视图

按源码位置列出长字符串；静态文本按字符串值显示，花括号内动态表达式仅供识别，未执行。条件分支分别列出，不代表一次调用全部生效。短标签、拼装顺序和完整条件见后面的源码原文。

### 片段 1 · 源码第 5617 行

````text
No additional change request. Create a fresh overall Story Bible within the existing project constraints.
````

### 片段 2 · 源码第 5621 行

````text
Rebuild every editable narrative field as a coherent new Story Bible. Do not merely paraphrase or preserve the current structure by default. Use the current Story Bible only as source context and retain hard project facts, character identities, reference IDs and explicit user constraints unless the instruction changes them.
````

### 片段 3 · 源码第 5628 行

````text
Revise only the fields affected by the instruction. Preserve all unaffected facts, causal logic, structure, character identities, reference IDs and ending obligations.
````

### 片段 4 · 源码第 5635 行

````text
No text selection was provided. Infer the smallest affected fields from the instruction.
````

### 片段 5 · 源码第 5638 行

````text
The author selected this exact document passage as the primary target.
Source field: {selection_context.source_field}
Selected text:
{selection_context.selected_text}
Text immediately before the selection:
{selection_context.before_text or '(none)'}
Text immediately after the selection:
{selection_context.after_text or '(none)'}
Treat the selection as the requested change target. Check its causal links, character arcs, story lines,
escalation stages, ending obligations, and locked facts. If the new passage makes any of those inconsistent,
update the related fields in the same candidate and report the resulting complete coherent Story Bible.
````

### 片段 6 · 源码第 5649 行

````text
{market_contract.prompt_contract}

You are revising a serialized comic Story Bible.
Create one complete revision candidate from the approved user instruction below.
This is a planning document, not an episode script.
All human-readable output values must be written in {market_contract.language_name}.
{STORY_BIBLE_REFERENCE_FORMAT_CONTRACT}
{STORY_LINE_BALANCE_CONTRACT}
{STORY_BIBLE_LENGTH_TARGET_CONTRACT}
Do not assign episode numbers, episode ranges, scenes, dialogue or camera directions.
Keep the same concise development-outline density as the approved document: broad whole-story phases,
short character/relationship/story-line statements, and milestone-level escalation only. Do not expand a
small requested change into episode beats, scene examples, detailed biographies, or a full chronology.
The revised candidate must stay within the Story Bible target range; if it exceeds the range, compress
repetition before returning instead of adding detail to unaffected fields.

User modification instruction:
{resolved_instruction}

Document selection context:
{selection_contract}

Revision mode: {revision_mode}
{revision_rules}

Current Story Bible JSON:
{source.model_dump_json(exclude={'schema_version', 'story_bible_id', 'story_project_id', 'content_spec_id', 'version', 'status', 'created_at', 'approved_at'})}

{decision_contract}

{knowledge_context}

Revision rules:
1. Execute the instruction across every affected field, not as an appended note. The selected passage is the
   primary target when a selection is present; surrounding fields may change when continuity requires it.
2. Follow the selected revision mode exactly while maintaining a coherent complete-story contract.
3. Keep character_registry, character_refs, arcs, relationships and story-line references internally consistent.
4. Preserve confirmed escalation content. For unresolved stages, keep functional structural placeholders instead of
   inventing an opponent, secret, betrayal, relationship outcome or ending that the author has not decided.
5. Do not add episode lists, scenes, dialogue, camera language, explanations or metadata.
6. A modification instruction may change an author-owned decision only when it explicitly targets that decision.
7. Return the entire revised Story Bible contract, not a patch and not commentary.

Return only JSON matching the provided schema.
````

## 源码原文

此部分按原始行提取，保留缩进、条件、占位变量和全部短字符串。

````python
    @staticmethod
    def _build_story_bible_modification_prompt(
        *,
        source: StoryBible,
        instruction: str,
        revision_mode: str,
        selection_context: StoryBibleSelectionContext | None,
        knowledge_context: str,
    ) -> str:
        resolved_instruction = instruction.strip() or (
            "No additional change request. Create a fresh overall Story Bible within the "
            "existing project constraints."
        )
        revision_rules = (
            "Rebuild every editable narrative field as a coherent new Story Bible. "
            "Do not merely paraphrase or preserve the current structure by default. "
            "Use the current Story Bible only as source context and retain hard project facts, "
            "character identities, reference IDs and explicit user constraints unless the "
            "instruction changes them."
            if revision_mode == "rewrite"
            else
            "Revise only the fields affected by the instruction. Preserve all unaffected "
            "facts, causal logic, structure, character identities, reference IDs and ending obligations."
        )
        market_contract = market_profile_contract(getattr(source, "market_profile", None))
        decision_contract = _creative_decision_prompt_contract(source.creative_decisions)
        if selection_context is None:
            selection_contract = (
                "No text selection was provided. Infer the smallest affected fields from the instruction."
            )
        else:
            selection_contract = f"""The author selected this exact document passage as the primary target.
Source field: {selection_context.source_field}
Selected text:
{selection_context.selected_text}
Text immediately before the selection:
{selection_context.before_text or "(none)"}
Text immediately after the selection:
{selection_context.after_text or "(none)"}
Treat the selection as the requested change target. Check its causal links, character arcs, story lines,
escalation stages, ending obligations, and locked facts. If the new passage makes any of those inconsistent,
update the related fields in the same candidate and report the resulting complete coherent Story Bible."""
        return f"""{market_contract.prompt_contract}

You are revising a serialized comic Story Bible.
Create one complete revision candidate from the approved user instruction below.
This is a planning document, not an episode script.
All human-readable output values must be written in {market_contract.language_name}.
{STORY_BIBLE_REFERENCE_FORMAT_CONTRACT}
{STORY_LINE_BALANCE_CONTRACT}
{STORY_BIBLE_LENGTH_TARGET_CONTRACT}
Do not assign episode numbers, episode ranges, scenes, dialogue or camera directions.
Keep the same concise development-outline density as the approved document: broad whole-story phases,
short character/relationship/story-line statements, and milestone-level escalation only. Do not expand a
small requested change into episode beats, scene examples, detailed biographies, or a full chronology.
The revised candidate must stay within the Story Bible target range; if it exceeds the range, compress
repetition before returning instead of adding detail to unaffected fields.

User modification instruction:
{resolved_instruction}

Document selection context:
{selection_contract}

Revision mode: {revision_mode}
{revision_rules}

Current Story Bible JSON:
{source.model_dump_json(exclude={"schema_version", "story_bible_id", "story_project_id", "content_spec_id", "version", "status", "created_at", "approved_at"})}

{decision_contract}

{knowledge_context}

Revision rules:
1. Execute the instruction across every affected field, not as an appended note. The selected passage is the
   primary target when a selection is present; surrounding fields may change when continuity requires it.
2. Follow the selected revision mode exactly while maintaining a coherent complete-story contract.
3. Keep character_registry, character_refs, arcs, relationships and story-line references internally consistent.
4. Preserve confirmed escalation content. For unresolved stages, keep functional structural placeholders instead of
   inventing an opponent, secret, betrayal, relationship outcome or ending that the author has not decided.
5. Do not add episode lists, scenes, dialogue, camera language, explanations or metadata.
6. A modification instruction may change an author-owned decision only when it explicitly targets that decision.
7. Return the entire revised Story Bible contract, not a patch and not commentary.

Return only JSON matching the provided schema."""
````

片段 SHA-256：`3dfdc3ba4ccaa51100ab3d100616ad963d8d8b44895b3ab05fbc7581295827e1`
