# 逐子节点恢复及末次精简重试提示

编号：`planning.decomposition_segmented_recovery`。状态：`active_conditional_recovery`。

来源：[backend/app/modules/script_engine/story_planning_service.py:9303](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_planning_service.py:9303)。符号：`StoryPlanningService._generate_segmented_decomposition_recovery`。

方法包含 child_prompt、minimal_retry_prompt；整批拆分失败后缩小生成范围。

本页保留当前工作区原文，不是优化后的替代提示词，也不是某次模型调用的完整展开结果。

## 长文本阅读视图

按源码位置列出长字符串；静态文本按字符串值显示，花括号内动态表达式仅供识别，未执行。条件分支分别列出，不代表一次调用全部生效。短标签、拼装顺序和完整条件见后面的源码原文。

### 片段 1 · 源码第 9373 行

````text
Segmented story plan recovery context compacted node=%s original_chars=%d compact_chars=%d child_count=%d
````

### 片段 2 · 源码第 9420 行

````text
Segmented story plan recovery reused complete child node=%s child=%d/%d episodes=%d-%d
````

### 片段 3 · 源码第 9430 行

````text
{market_contract}

SEGMENTED STORY PLAN RECOVERY
The full sibling-array transport was incomplete after bounded structural recovery.
Generate exactly one high-quality child story movement for the approved parent. This is
not a summary or placeholder. Preserve the original creative direction, Story Bible,
parent conflict, references, dramatic escalation and short-drama quality requirements.

Child position: {index + 1} of {len(range_plan)}
Complete fixed sibling range plan: {json.dumps(range_plan, ensure_ascii=False)}
This child fixed episode range: {start}-{end}
Required entry_state, copy verbatim: {required_entry_state}
Required final exit_state: {required_exit_state or 'Create a concrete causal state that the next sibling can copy verbatim.'}
Approved parent turning points assigned to this child, copy each verbatim exactly once:
{json.dumps(assigned_turning_points, ensure_ascii=False)}
Previous accepted child, for distinctness and causal handoff:
{json.dumps(self._compact_previous_decomposition_child(previous_child), ensure_ascii=False, separators=(',', ':'))}

TRANSPORT RULE: begin with the first character of a JSON object and end with its closing
brace. Do not emit analysis, a Markdown fence, a quoted JSON string, or any text before
or after the object.

Return only one complete StoryPlanNodeChildOutput object. Follow the market contract above
for every human-readable value. Keep the title, synopsis, unit_story_beats, resolution
and handoff narratively distinct from every other sibling. Do not change the fixed range,
entry state, assigned parent turning points or final parent exit state.
Build a complete short-drama movement with 4-12 causal beats: trigger, concrete goal and
action, escalating resistance, irreversible choice or reversal, visible payoff, and state
change. Resolve one reachable barrier and deliver a real reward before handing a stronger
new pressure to the next sibling. Do not write scenes, dialogue, camera directions,
placeholders, or a long-form-drama restatement of the parent. Keep the transport compact:
use 4-6 turning_points and 4-6 unit_story_beats, keep ordinary prose fields under 180
Chinese characters, and do not repeat the recovery context or explain your reasoning.

Approved compact recovery context. Every included fact and reference is binding:
{recovery_context_json}
````

### 片段 4 · 源码第 9467 行

````text
Story Plan Node segmented child recovery node={parent.node_id} child={index + 1}/{len(range_plan)}
````

### 片段 5 · 源码第 9494 行

````text
FINAL SEGMENTED CHILD TRANSPORT RETRY
Return exactly one complete native JSON StoryPlanNodeChildOutput object. Do not emit
analysis, Markdown, a quoted JSON string, or any text outside the object. This is the
last bounded retry for one child; keep every required field concise and complete.

Fixed child range: {start}-{end}
Required entry_state, copy verbatim: {required_entry_state}
Required final exit_state: {required_exit_state or 'Create a concrete causal state for the next sibling.'}
Assigned parent turning points, copy each exactly once:
{json.dumps(assigned_turning_points, ensure_ascii=False, separators=(',', ':'))}
Previous accepted child checkpoint:
{json.dumps(self._compact_previous_decomposition_child(previous_child), ensure_ascii=False, separators=(',', ':'))}
Allowed recovery facts:
{json.dumps(minimal_context, ensure_ascii=False, separators=(',', ':'))}

Write 4-6 concrete unit_story_beats covering trigger, action, escalation, irreversible
choice, visible payoff and state change. Use 4-6 turning_points. Keep prose fields under
180 Chinese characters, preserve the fixed range and references, and return only JSON.
The preceding attempt failed with: {str(first_error)[:600]}
````

### 片段 6 · 源码第 9514 行

````text
Segmented child recovery entering minimal-context retry node=%s child=%d/%d error=%s
````

### 片段 7 · 源码第 9528 行

````text
{child_artifact} minimal retry
````

### 片段 8 · 源码第 9542 行

````text
Segmented story plan child exhausted model recovery; using deterministic contract fallback node=%s child=%d/%d error=%s
````

### 片段 9 · 源码第 9601 行

````text
Segmented story plan recovery completed node=%s child_count=%d reused_child_count=%d generated_child_count=%d spans=%s
````

### 片段 10 · 源码第 9621 行

````text
Segmented story plan recovery rejected reused children; regenerating the complete segmented set node=%s error=%s
````

## 源码原文

此部分按原始行提取，保留缩进、条件、占位变量和全部短字符串。

````python
    def _generate_segmented_decomposition_recovery(
        self,
        *,
        original_prompt: str,
        strategy: GenerationStrategy,
        parent: StoryPlanNode,
        story_bible: StoryBible,
        requested_child_count: int | None,
        max_episode_ready_span: int,
        source_children: list[object] | None = None,
    ) -> StoryPlanNodeDecompositionOutput:
        parent_span = self._story_plan_node_episode_span(parent)
        narrative_child_count = _narrative_decomposition_child_count(
            parent,
            story_bible,
        )
        maximum_feasible_count = min(
            12,
            parent_span // MIN_EPISODE_READY_SPAN,
        )
        recovered_child_count = len(source_children or [])
        if 2 <= recovered_child_count <= maximum_feasible_count:
            narrative_child_count = max(
                narrative_child_count,
                recovered_child_count,
            )
        spans = _fallback_decomposition_spans(
            parent_span,
            requested_child_count,
            narrative_child_count=narrative_child_count,
        )
        assert parent.planned_start_episode is not None
        allowed_character_refs = set(story_bible.character_refs)
        allowed_story_line_refs = {
            item.story_line_id for item in story_bible.story_lines
        }
        turning_point_assignments: list[list[str]] = [[] for _ in spans]
        parent_turning_points = set(parent.turning_points)
        for index, turning_point in enumerate(parent.turning_points):
            target = min(
                len(spans) - 1,
                index * len(spans) // max(1, len(parent.turning_points)),
            )
            turning_point_assignments[target].append(turning_point)

        segment_strategy = strategy.model_copy(update={
            "max_tokens": min(
                strategy.max_tokens,
                STORY_DECOMPOSITION_SEGMENT_MAX_OUTPUT_TOKENS,
            ),
        })
        children: list[StoryPlanNodeChildOutput] = []
        market_contract = self._story_bible_market_contract_text(story_bible)
        start_episode = parent.planned_start_episode
        range_plan = []
        range_cursor = start_episode
        for span in spans:
            range_plan.append([range_cursor, range_cursor + span - 1])
            range_cursor += span

        recovery_context = self._compact_segmented_decomposition_context(
            parent=parent,
            story_bible=story_bible,
        )
        recovery_context_json = json.dumps(
            recovery_context,
            ensure_ascii=False,
            separators=(",", ":"),
        )
        logger.info(
            "Segmented story plan recovery context compacted node=%s "
            "original_chars=%d compact_chars=%d child_count=%d",
            parent.node_id,
            len(original_prompt),
            len(recovery_context_json),
            len(range_plan),
        )

        reused_child_count = 0
        for index, (start, end) in enumerate(range_plan):
            previous_child = children[-1] if children else None
            required_entry_state = (
                previous_child.exit_state if previous_child else parent.entry_state
            )
            required_exit_state = (
                parent.exit_state if index == len(range_plan) - 1 else None
            )
            assigned_turning_points = turning_point_assignments[index]
            child: StoryPlanNodeChildOutput | None = None
            raw_source_child = (
                source_children[index]
                if source_children is not None and index < len(source_children)
                else None
            )
            if isinstance(raw_source_child, dict):
                try:
                    candidate_child = StoryPlanNodeChildOutput.model_validate(
                        normalize_story_plan_node_generation_output(
                            raw_source_child,
                            child=True,
                        )
                    )
                except ValidationError:
                    candidate_child = None
                if (
                    candidate_child is not None
                    and candidate_child.planned_start_episode == start
                    and candidate_child.planned_end_episode == end
                    and candidate_child.entry_state == required_entry_state
                    and (
                        required_exit_state is None
                        or candidate_child.exit_state == required_exit_state
                    )
                ):
                    child = candidate_child
                    reused_child_count += 1
                    logger.info(
                        "Segmented story plan recovery reused complete child "
                        "node=%s child=%d/%d episodes=%d-%d",
                        parent.node_id,
                        index + 1,
                        len(range_plan),
                        start,
                        end,
                    )

            if child is None:
                child_prompt = f"""{market_contract}

SEGMENTED STORY PLAN RECOVERY
The full sibling-array transport was incomplete after bounded structural recovery.
Generate exactly one high-quality child story movement for the approved parent. This is
not a summary or placeholder. Preserve the original creative direction, Story Bible,
parent conflict, references, dramatic escalation and short-drama quality requirements.

Child position: {index + 1} of {len(range_plan)}
Complete fixed sibling range plan: {json.dumps(range_plan, ensure_ascii=False)}
This child fixed episode range: {start}-{end}
Required entry_state, copy verbatim: {required_entry_state}
Required final exit_state: {required_exit_state or 'Create a concrete causal state that the next sibling can copy verbatim.'}
Approved parent turning points assigned to this child, copy each verbatim exactly once:
{json.dumps(assigned_turning_points, ensure_ascii=False)}
Previous accepted child, for distinctness and causal handoff:
{json.dumps(self._compact_previous_decomposition_child(previous_child), ensure_ascii=False, separators=(',', ':'))}

TRANSPORT RULE: begin with the first character of a JSON object and end with its closing
brace. Do not emit analysis, a Markdown fence, a quoted JSON string, or any text before
or after the object.

Return only one complete StoryPlanNodeChildOutput object. Follow the market contract above
for every human-readable value. Keep the title, synopsis, unit_story_beats, resolution
and handoff narratively distinct from every other sibling. Do not change the fixed range,
entry state, assigned parent turning points or final parent exit state.
Build a complete short-drama movement with 4-12 causal beats: trigger, concrete goal and
action, escalating resistance, irreversible choice or reversal, visible payoff, and state
change. Resolve one reachable barrier and deliver a real reward before handing a stronger
new pressure to the next sibling. Do not write scenes, dialogue, camera directions,
placeholders, or a long-form-drama restatement of the parent. Keep the transport compact:
use 4-6 turning_points and 4-6 unit_story_beats, keep ordinary prose fields under 180
Chinese characters, and do not repeat the recovery context or explain your reasoning.

Approved compact recovery context. Every included fact and reference is binding:
{recovery_context_json}"""
                child_artifact = (
                    "Story Plan Node segmented child recovery "
                    f"node={parent.node_id} child={index + 1}/{len(range_plan)}"
                )
                try:
                    child = self._generate_planning_output(
                        prompt=child_prompt,
                        strategy=segment_strategy,
                        output_model=StoryPlanNodeChildOutput,
                        artifact_name=child_artifact,
                    )
                except (
                    StoryPlanningInputError,
                    StoryPlanningTransientOutputError,
                ) as first_error:
                    # A failed child should not receive the full recovery context a
                    # second time. Keep one bounded retry small enough for gateways
                    # that cap prompt or completion size, while retaining every hard
                    # continuity and reference boundary needed for validation.
                    minimal_context = {
                        "parent": recovery_context.get("parent", {}),
                        "allowed_character_refs": recovery_context.get(
                            "allowed_character_refs", []
                        ),
                        "allowed_story_line_refs": recovery_context.get(
                            "allowed_story_line_refs", []
                        ),
                    }
                    minimal_retry_prompt = f"""FINAL SEGMENTED CHILD TRANSPORT RETRY
Return exactly one complete native JSON StoryPlanNodeChildOutput object. Do not emit
analysis, Markdown, a quoted JSON string, or any text outside the object. This is the
last bounded retry for one child; keep every required field concise and complete.

Fixed child range: {start}-{end}
Required entry_state, copy verbatim: {required_entry_state}
Required final exit_state: {required_exit_state or 'Create a concrete causal state for the next sibling.'}
Assigned parent turning points, copy each exactly once:
{json.dumps(assigned_turning_points, ensure_ascii=False, separators=(',', ':'))}
Previous accepted child checkpoint:
{json.dumps(self._compact_previous_decomposition_child(previous_child), ensure_ascii=False, separators=(',', ':'))}
Allowed recovery facts:
{json.dumps(minimal_context, ensure_ascii=False, separators=(',', ':'))}

Write 4-6 concrete unit_story_beats covering trigger, action, escalation, irreversible
choice, visible payoff and state change. Use 4-6 turning_points. Keep prose fields under
180 Chinese characters, preserve the fixed range and references, and return only JSON.
The preceding attempt failed with: {str(first_error)[:600]}"""
                    logger.warning(
                        "Segmented child recovery entering minimal-context retry "
                        "node=%s child=%d/%d error=%s",
                        parent.node_id,
                        index + 1,
                        len(range_plan),
                        str(first_error)[:500],
                    )
                    try:
                        child = self._generate_planning_output(
                            prompt=minimal_retry_prompt,
                            strategy=segment_strategy.model_copy(update={
                                "max_tokens": min(segment_strategy.max_tokens, 4_500),
                            }),
                            output_model=StoryPlanNodeChildOutput,
                            artifact_name=f"{child_artifact} minimal retry",
                        )
                    except (
                        StoryPlanningInputError,
                        StoryPlanningTransientOutputError,
                        LLMRequestError,
                        LLMStructuredOutputError,
                        ValidationError,
                    ) as final_error:
                        # A single provider failure must not discard every sibling
                        # in this parent. Keep the fixed range and continuity
                        # contract deterministic so the whole layer can be saved
                        # and reviewed.
                        logger.error(
                            "Segmented story plan child exhausted model recovery; "
                            "using deterministic contract fallback node=%s child=%d/%d "
                            "error=%s",
                            parent.node_id,
                            index + 1,
                            len(range_plan),
                            str(final_error)[:500],
                        )
                        child = self._deterministic_decomposition_child(
                            parent=parent,
                            story_bible=story_bible,
                            start_episode=start,
                            end_episode=end,
                            child_index=index,
                            child_count=len(range_plan),
                            required_entry_state=required_entry_state,
                            required_exit_state=required_exit_state,
                            assigned_turning_points=assigned_turning_points,
                            allowed_character_refs=allowed_character_refs,
                            allowed_story_line_refs=allowed_story_line_refs,
                        )
            child_span = end - start + 1
            child = child.model_copy(update={
                "planned_start_episode": start,
                "planned_end_episode": end,
                "estimated_episode_count": child_span,
                "recommended_next_step": (
                    "episode_ready"
                    if MIN_EPISODE_READY_SPAN <= child_span <= max_episode_ready_span
                    else "expand"
                ),
                "entry_state": required_entry_state,
                **(
                    {"exit_state": required_exit_state}
                    if required_exit_state is not None
                    else {}
                ),
                "turning_points": list(dict.fromkeys([
                    *assigned_turning_points,
                    *(
                        turning_point
                        for turning_point in child.turning_points
                        if turning_point not in parent_turning_points
                    ),
                ])),
                "character_refs": [
                    reference
                    for reference in child.character_refs
                    if reference in allowed_character_refs
                ],
                "story_line_refs": [
                    reference
                    for reference in child.story_line_refs
                    if reference in allowed_story_line_refs
                ],
            })
            children.append(child)

        logger.info(
            "Segmented story plan recovery completed node=%s child_count=%d "
            "reused_child_count=%d generated_child_count=%d spans=%s",
            parent.node_id,
            len(children),
            reused_child_count,
            len(children) - reused_child_count,
            spans,
        )
        output = StoryPlanNodeDecompositionOutput(children=children)
        if reused_child_count and source_children:
            try:
                self._validate_decomposition_output(
                    output,
                    parent=parent,
                    story_bible=story_bible,
                    requested_child_count=requested_child_count,
                    max_episode_ready_span=max_episode_ready_span,
                )
            except StoryPlanningInputError as reuse_error:
                logger.warning(
                    "Segmented story plan recovery rejected reused children; "
                    "regenerating the complete segmented set node=%s error=%s",
                    parent.node_id,
                    str(reuse_error)[:500],
                )
                return self._generate_segmented_decomposition_recovery(
                    original_prompt=original_prompt,
                    strategy=strategy,
                    parent=parent,
                    story_bible=story_bible,
                    requested_child_count=requested_child_count,
                    max_episode_ready_span=max_episode_ready_span,
                    source_children=None,
                )
        return output
````

片段 SHA-256：`8968f8a1896f958c8b1c61ecc4255ed9c277cc657e4569c62d48d862a9bb29c0`
