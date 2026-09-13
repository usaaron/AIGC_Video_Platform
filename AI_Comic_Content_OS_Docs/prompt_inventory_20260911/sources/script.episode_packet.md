# 分集正文执行资料包

编号：`script.episode_packet`。状态：`默认分集主链`。

来源：[backend/app/modules/script_engine/generation_service.py:2726](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/generation_service.py:2726)。符号：`ScriptGenerationService._episode_execution_context_payload`。

上下文编译而非独立提示词，展示传给正文模型的上游事实、规划和连续性资料。

本页保留当前工作区原文，不是优化后的替代提示词，也不是某次模型调用的完整展开结果。

## 长文本阅读视图

按源码位置列出长字符串；静态文本按字符串值显示，花括号内动态表达式仅供识别，未执行。条件分支分别列出，不代表一次调用全部生效。短标签、拼装顺序和完整条件见后面的源码原文。

### 片段 1 · 源码第 2782 行

````text
provisional_continuity_checkpoint
````

### 片段 2 · 源码第 2783 行

````text
confirmed_continuity_checkpoint
````

### 片段 3 · 源码第 2786 行

````text
confirmed_continuity_checkpoint
````

## 源码原文

此部分按原始行提取，保留缩进、条件、占位变量和全部短字符串。

````python
    @classmethod
    def _episode_execution_context_payload(
        cls,
        episode_context: EpisodeGenerationContext,
        *,
        model_context_tokens: int,
    ) -> dict[str, object]:
        """Compile the stored episode context into one bounded writing packet."""

        payload = episode_context.model_dump(mode="json", exclude_none=True)
        decisions = payload.get("creative_decisions")
        if isinstance(decisions, list):
            open_statuses = {"unresolved", "delegated", "proposed", "conflicted"}
            prioritized = [
                item for item in decisions
                if isinstance(item, dict) and item.get("status") in open_statuses
            ]
            prioritized.extend(
                item for item in reversed(decisions)
                if isinstance(item, dict) and item not in prioritized
            )
            compact_decisions: list[dict[str, object]] = []
            for item in prioritized[:30]:
                compact_item = dict(item)
                value = compact_item.get("value")
                if isinstance(value, str):
                    compact_item["value"] = value[:600]
                compact_decisions.append(compact_item)
            payload["creative_decisions"] = compact_decisions
        supporting_context_scale = min(
            1.0,
            max(0.35, model_context_tokens / 128_000),
        )
        for field_name, limit in (
            ("previous_episode_summary", 1_200),
            ("module_handoff", 3_000),
            ("long_range_anchor", 1_800),
            ("story_bible_context", 2_200),
            ("reference_material_context", 1_800),
            ("project_continuity_summary", 2_400),
        ):
            value = payload.get(field_name)
            if isinstance(value, str):
                scaled_limit = max(480, round(limit * supporting_context_scale))
                payload[field_name] = value[:scaled_limit]

        payload.pop("planned_story_beat", None)
        if str(payload.get("previous_episode_handoff") or "").strip():
            payload.pop("previous_episode_summary", None)
        if str(payload.get("story_bible_context") or "").strip():
            payload.pop("long_range_anchor", None)
        if payload.get("approved_story_node") is not None:
            payload.pop("module_handoff", None)

        memory_recall = payload.pop("memory_recall", None)
        continuity_checkpoint = (
            payload.pop("provisional_continuity_checkpoint", None)
            or payload.pop("confirmed_continuity_checkpoint", None)
            or payload.pop("project_continuity_summary", None)
        )
        payload.pop("confirmed_continuity_checkpoint", None)
        payload.pop("project_continuity_summary", None)
        if memory_recall is not None:
            payload["memory_recall"] = cls._compact_memory_recall_for_prompt(
                memory_recall
            )
            # Older recall packets flatten knowledge into prose. Preserve the
            # stable update keys from a checkpoint at the same working boundary.
            checkpoint = cls._decode_json_context(continuity_checkpoint)
            keyed_character_refs = {
                ref
                for capsule in memory_recall.get("capsules", [])
                if isinstance(capsule, dict) and capsule.get("knowledge_states")
                for ref in capsule.get("entity_refs", [])
            } if isinstance(memory_recall, dict) else set()
            if (
                isinstance(checkpoint, dict)
                and isinstance(memory_recall, dict)
                and checkpoint.get("version") == "provisional"
                and memory_recall.get("memory_layer") == "provisional"
                and checkpoint.get("through_episode_number")
                == memory_recall.get("through_episode_number")
                and isinstance(checkpoint.get("through_episode_number"), int)
                and checkpoint["through_episode_number"] < episode_context.episode_number
            ):
                checkpoint_characters = checkpoint.get("character_states")
                knowledge_index = [
                    {"character_ref": item["character_ref"],
                     "knowledge_states": item["knowledge_states"]}
                    for item in (checkpoint_characters if isinstance(checkpoint_characters, list) else [])
                    if isinstance(item, dict)
                    and item.get("character_ref") and item.get("knowledge_states")
                    and item["character_ref"] not in keyed_character_refs
                ]
                if knowledge_index:
                    payload["character_knowledge_index"] = {
                        "memory_layer": "provisional",
                        "through_episode_number": checkpoint["through_episode_number"],
                        "characters": knowledge_index,
                    }
        elif continuity_checkpoint:
            payload["continuity_checkpoint"] = cls._decode_json_context(
                continuity_checkpoint
            )

        approved_plan = payload.get("approved_episode_plan")
        if isinstance(approved_plan, dict):
            approved_plan.pop("episode_number", None)
            planned_scene_count = approved_plan.get("planned_scene_count")
            if isinstance(planned_scene_count, int):
                approved_plan["planned_scene_count"] = min(
                    EPISODE_SCENE_MAX,
                    max(EPISODE_SCENE_MIN, planned_scene_count),
                )
            planned_shot_count = approved_plan.get("planned_shot_count")
            if isinstance(planned_shot_count, int):
                approved_plan["planned_shot_count"] = min(
                    EPISODE_SHOT_UNIT_MAX,
                    max(EPISODE_SHOT_UNIT_MIN, planned_shot_count),
                )
            planned_dialogue_line_count = approved_plan.get(
                "planned_dialogue_line_count"
            )
            if isinstance(planned_dialogue_line_count, int):
                approved_plan["planned_dialogue_line_count"] = min(
                    EPISODE_DIALOGUE_LINE_MAX,
                    max(EPISODE_DIALOGUE_LINE_MIN, planned_dialogue_line_count),
                )
            source_beats = approved_plan.pop("source_unit_story_beats", [])
            source_turns = approved_plan.pop("source_turning_points", [])
            key_events: list[str] = []
            for value in [*source_beats, *source_turns]:
                if isinstance(value, str) and value.strip() and value not in key_events:
                    key_events.append(value)
                if len(key_events) >= 8:
                    break
            if key_events:
                approved_plan["key_events"] = key_events
            cls._drop_empty_context_values(approved_plan)

            for redundant_field in (
                "relevant_character_refs",
                "planned_story_line_refs",
                "planned_setup_refs",
                "planned_payoff_refs",
            ):
                payload.pop(redundant_field, None)

            story_node = payload.get("approved_story_node")
            if isinstance(story_node, dict):
                for redundant_field in (
                    "node_id",
                    "node_version",
                    "entry_state",
                    "central_conflict",
                    "emotional_direction",
                    "exit_state",
                    "turning_points",
                    "unit_story_beats",
                ):
                    story_node.pop(redundant_field, None)
                cls._drop_empty_context_values(story_node)

        cls._drop_empty_context_values(payload)
        return payload
````

片段 SHA-256：`e8fb800cabbeb76d67504429ff8f02a148f325ecb67b8892f7538cf15fadc0b0`
