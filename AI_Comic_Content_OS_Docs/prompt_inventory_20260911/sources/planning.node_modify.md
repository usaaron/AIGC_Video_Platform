# 剧情节点修改与重写提示

编号：`planning.node_modify`。状态：`active_editor`。

来源：[backend/app/modules/script_engine/story_planning_service.py:6445](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_planning_service.py:6445)。符号：`StoryPlanningService._build_story_plan_node_modification_prompt`。

保持树结构、集数、前后及子节点交接；同步本节点受影响字段。

本页保留当前工作区原文，不是优化后的替代提示词，也不是某次模型调用的完整展开结果。

## 长文本阅读视图

按源码位置列出长字符串；静态文本按字符串值显示，花括号内动态表达式仅供识别，未执行。条件分支分别列出，不代表一次调用全部生效。短标签、拼装顺序和完整条件见后面的源码原文。

### 片段 1 · 源码第 6457 行

````text
No additional change request. Create a fresh overall version of this story node within its fixed tree and continuity boundaries.
````

### 片段 2 · 源码第 6461 行

````text
Rebuild every editable dramatic field in this node from scratch. Do not merely paraphrase the current node. Keep only the immutable tree boundary, approved Story Bible facts, continuity handoffs and registered reference IDs.
````

### 片段 3 · 源码第 6466 行

````text
Revise only the dramatic fields affected by the instruction and preserve all unaffected narrative facts and causal structure.
````

### 片段 4 · 源码第 6475 行

````text
No text selection was provided. Infer the smallest affected node fields from the instruction.
````

### 片段 5 · 源码第 6478 行

````text
The author selected this exact passage inside the node as the primary target.
Source field: {selection_context.source_field}
Selected text:
{selection_context.selected_text}
Text immediately before the selection:
{selection_context.before_text or '(none)'}
Text immediately after the selection:
{selection_context.after_text or '(none)'}
Treat the selection as the precise target. Preserve unaffected node facts, but update the related
entry/exit states, turning points, resolution or handoff fields when continuity requires it.
````

### 片段 6 · 源码第 6488 行

````text
{market_contract}

You are revising one node in a recursively decomposed serialized comic story plan.
Apply the user's instruction to the node's dramatic content. This is a planning artifact,
not an episode script. All human-readable values must follow the market contract above.
{STORY_TREE_LENGTH_TARGET_CONTRACT}
{STORY_LINE_PLANNING_CONTRACT}

User modification instruction:
{resolved_instruction}

Document selection context:
{selection_contract}

Revision mode: {revision_mode}
{revision_rules}

Approved Story Bible boundaries:
- Core premise: {story_bible.core_premise}
- Central conflict: {story_bible.central_conflict}
- Ending direction: {story_bible.ending_direction}
- Allowed character refs: {json.dumps(story_bible.character_refs, ensure_ascii=False)}
- Allowed story-line refs: {json.dumps([item.story_line_id for item in story_bible.story_lines], ensure_ascii=False)}

{decision_contract}

Current node JSON:
{source.model_dump_json(exclude={'schema_version', 'node_id', 'story_project_id', 'story_bible_id', 'story_bible_version', 'version', 'status', 'created_at', 'approved_at'})}

Planning lineage and adjacent continuity boundaries:
{json.dumps(continuity_context or {}, ensure_ascii=False, separators=(',', ':'))}

{knowledge_context}

Revision rules:
1. Execute the instruction across every affected narrative field and return the complete node contract.
2. Preserve the node's episode range, estimated episode count, body allocation, parent, predecessor and sequence position.
3. Preserve existing character, story-line, setup and payoff reference IDs; do not invent IDs.
4. Maintain causal continuity from entry state through turning points and unit resolution to exit state and handoff pressure.
   Do not resolve an unresolved author decision or promote a provisional suggestion into fact unless this modification
   instruction explicitly supplies that decision.
5. Treat ancestor boundaries, the previous sibling exit, the next sibling entry, and direct-child
   entry/exit states in the supplied continuity context as binding. When the requested change affects
   one of those handoffs, update every dependent field inside this node instead of hiding the conflict.
   Descendant regeneration is handled by the application after this complete node contract returns.
6. Do not write scenes, dialogue, camera directions, episode prose, explanations or metadata.
7. Keep the revised node within the applicable target range above. If it runs long, compress
   repeated parent or Story Bible context before returning; do not add filler to unaffected fields.

Return only JSON matching the provided schema.
````

## 源码原文

此部分按原始行提取，保留缩进、条件、占位变量和全部短字符串。

````python
    @staticmethod
    def _build_story_plan_node_modification_prompt(
        *,
        source: StoryPlanNode,
        story_bible: StoryBible,
        instruction: str,
        revision_mode: str,
        selection_context: StoryBibleSelectionContext | None,
        continuity_context: dict[str, object] | None,
        knowledge_context: str,
    ) -> str:
        resolved_instruction = instruction.strip() or (
            "No additional change request. Create a fresh overall version of this story node "
            "within its fixed tree and continuity boundaries."
        )
        revision_rules = (
            "Rebuild every editable dramatic field in this node from scratch. Do not merely "
            "paraphrase the current node. Keep only the immutable tree boundary, approved Story "
            "Bible facts, continuity handoffs and registered reference IDs."
            if revision_mode == "rewrite"
            else
            "Revise only the dramatic fields affected by the instruction and preserve all "
            "unaffected narrative facts and causal structure."
        )
        market_contract = StoryPlanningService._story_bible_market_contract_text(story_bible)
        decision_contract = _creative_decision_prompt_contract(
            list(getattr(story_bible, "creative_decisions", []) or [])
        )
        if selection_context is None:
            selection_contract = (
                "No text selection was provided. Infer the smallest affected node fields from the instruction."
            )
        else:
            selection_contract = f"""The author selected this exact passage inside the node as the primary target.
Source field: {selection_context.source_field}
Selected text:
{selection_context.selected_text}
Text immediately before the selection:
{selection_context.before_text or "(none)"}
Text immediately after the selection:
{selection_context.after_text or "(none)"}
Treat the selection as the precise target. Preserve unaffected node facts, but update the related
entry/exit states, turning points, resolution or handoff fields when continuity requires it."""
        return f"""{market_contract}

You are revising one node in a recursively decomposed serialized comic story plan.
Apply the user's instruction to the node's dramatic content. This is a planning artifact,
not an episode script. All human-readable values must follow the market contract above.
{STORY_TREE_LENGTH_TARGET_CONTRACT}
{STORY_LINE_PLANNING_CONTRACT}

User modification instruction:
{resolved_instruction}

Document selection context:
{selection_contract}

Revision mode: {revision_mode}
{revision_rules}

Approved Story Bible boundaries:
- Core premise: {story_bible.core_premise}
- Central conflict: {story_bible.central_conflict}
- Ending direction: {story_bible.ending_direction}
- Allowed character refs: {json.dumps(story_bible.character_refs, ensure_ascii=False)}
- Allowed story-line refs: {json.dumps([item.story_line_id for item in story_bible.story_lines], ensure_ascii=False)}

{decision_contract}

Current node JSON:
{source.model_dump_json(exclude={"schema_version", "node_id", "story_project_id", "story_bible_id", "story_bible_version", "version", "status", "created_at", "approved_at"})}

Planning lineage and adjacent continuity boundaries:
{json.dumps(continuity_context or {}, ensure_ascii=False, separators=(',', ':'))}

{knowledge_context}

Revision rules:
1. Execute the instruction across every affected narrative field and return the complete node contract.
2. Preserve the node's episode range, estimated episode count, body allocation, parent, predecessor and sequence position.
3. Preserve existing character, story-line, setup and payoff reference IDs; do not invent IDs.
4. Maintain causal continuity from entry state through turning points and unit resolution to exit state and handoff pressure.
   Do not resolve an unresolved author decision or promote a provisional suggestion into fact unless this modification
   instruction explicitly supplies that decision.
5. Treat ancestor boundaries, the previous sibling exit, the next sibling entry, and direct-child
   entry/exit states in the supplied continuity context as binding. When the requested change affects
   one of those handoffs, update every dependent field inside this node instead of hiding the conflict.
   Descendant regeneration is handled by the application after this complete node contract returns.
6. Do not write scenes, dialogue, camera directions, episode prose, explanations or metadata.
7. Keep the revised node within the applicable target range above. If it runs long, compress
   repeated parent or Story Bible context before returning; do not add filler to unaffected fields.

Return only JSON matching the provided schema."""
````

片段 SHA-256：`02dc6de936e31d3aa323a59420364d46c2131ffec0260229e1de733fd4e44abc`
