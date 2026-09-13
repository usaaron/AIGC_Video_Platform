# 用户选中文本局部修订

编号：`script.targeted_modification`。状态：`用户主动修改时触发`。

来源：[backend/app/modules/script_engine/generation_service.py:2028](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/generation_service.py:2028)。符号：`ScriptGenerationService._build_targeted_modification_prompt`。

仅替换选中片段，需要改事实或其他字段则请求整集改写；现有文案仍规定上游规划高于本次指令。

本页保留当前工作区原文，不是优化后的替代提示词，也不是某次模型调用的完整展开结果。

## 长文本阅读视图

按源码位置列出长字符串；静态文本按字符串值显示，花括号内动态表达式仅供识别，未执行。条件分支分别列出，不代表一次调用全部生效。短标签、拼装顺序和完整条件见后面的源码原文。

### 片段 1 · 源码第 2064 行

````text
The target is an overseas English dialogue line. Return updated_chinese_translation as the complete Chinese translation of the updated full dialogue line, generated in this same response.
````

### 片段 2 · 源码第 2068 行

````text
Set updated_chinese_translation to null.
````

### 片段 3 · 源码第 2071 行

````text
TARGETED SCREENPLAY TEXT REVISION
Market path: {source_run.release_region.value}.
Revise exactly one selected text fragment without regenerating the episode. The server deterministically inserts replacement_text at target_path and rejects every other mutation.

Decision rule:
- Use requires_full_episode_rewrite=false only when the instruction can be satisfied by replacing the selected fragment alone.
- Set requires_full_episode_rewrite=true with a concise reason if satisfying the request requires another field, another scene, a character/state update, a new story fact, or a changed causal/continuity contract.
- replacement_text is only the replacement for selected_text, not the full field and not an explanation. Preserve language, names, established facts, tone, causality, and handoff obligations. Do not weaken production clarity.
- The user instruction is subordinate to story_bible_context, approved_story_node, approved_episode_plan, and confirmed continuity. Never change their required outcome, route obligations, or locked facts.
- {translation_rule}

Release region: {source_run.release_region.value}
Target path: {target_path}
UserDirectedModificationContract:
User instruction: {payload.instruction}
DocumentSelectionContext:
````

### 片段 4 · 源码第 2095 行

````text

Current complete target field:
````

### 片段 5 · 源码第 2104 行

````text


Canonical episode and continuity packet:
````

### 片段 6 · 源码第 2106 行

````text


Immutable episode context and relevant scene evidence:
````

## 源码原文

此部分按原始行提取，保留缩进、条件、占位变量和全部短字符串。

````python
    def _build_targeted_modification_prompt(
        self,
        *,
        payload: ScriptDraftModificationRequest,
        source_run: ScriptGenerationDraftRun,
        source_draft: DraftMasterScript,
        content_spec,
        target_path: str,
        source_value: str,
        requires_translation: bool,
        knowledge_items: list[StaticKnowledgeItem],
    ) -> str:
        episode_context: dict[str, object] = {}
        if source_run.episode_context is not None:
            episode_context = self._episode_execution_context_payload(
                source_run.episode_context,
                model_context_tokens=self._llm_adapter.get_model_info().max_context_tokens,
            )
        creative_contract = {
            "title": content_spec.title,
            "audience_goal": content_spec.audience_goal.model_dump(mode="json"),
            "commercial_goal": content_spec.commercial_goal.model_dump(mode="json"),
            "platform_goal": content_spec.platform_goal.model_dump(mode="json"),
            "creative_brief": content_spec.creative_brief.model_dump(mode="json"),
            "resolved_creative_context": (
                source_run.resolved_creative_context.model_dump(
                    mode="json",
                    exclude_none=True,
                )
                if source_run.resolved_creative_context is not None
                else None
            ),
        }
        selection = payload.selection_context
        assert selection is not None
        translation_rule = (
            "The target is an overseas English dialogue line. Return "
            "updated_chinese_translation as the complete Chinese translation of the "
            "updated full dialogue line, generated in this same response."
            if requires_translation
            else "Set updated_chinese_translation to null."
        )
        return (
            "TARGETED SCREENPLAY TEXT REVISION\n"
            f"Market path: {source_run.release_region.value}.\n"
            "Revise exactly one selected text fragment without regenerating the episode. "
            "The server deterministically inserts replacement_text at target_path and "
            "rejects every other mutation.\n\n"
            "Decision rule:\n"
            "- Use requires_full_episode_rewrite=false only when the instruction can be "
            "satisfied by replacing the selected fragment alone.\n"
            "- Set requires_full_episode_rewrite=true with a concise reason if satisfying "
            "the request requires another field, another scene, a character/state update, "
            "a new story fact, or a changed causal/continuity contract.\n"
            "- replacement_text is only the replacement for selected_text, not the full "
            "field and not an explanation. Preserve language, names, established facts, "
            "tone, causality, and handoff obligations. Do not weaken production clarity.\n"
            "- The user instruction is subordinate to story_bible_context, approved_story_node, "
            "approved_episode_plan, and confirmed continuity. Never change their required outcome, "
            "route obligations, or locked facts.\n"
            f"- {translation_rule}\n\n"
            f"Release region: {source_run.release_region.value}\n"
            f"Target path: {target_path}\n"
            "UserDirectedModificationContract:\n"
            f"User instruction: {payload.instruction}\n"
            "DocumentSelectionContext:\n"
            + json.dumps(selection.model_dump(mode="json"), ensure_ascii=False)
            + "\nCurrent complete target field:\n"
            + source_value
            + "\n\nCreative contract:\n"
            + json.dumps(creative_contract, ensure_ascii=False)
            + "\n\nGoverned generation guidance:\n"
            + json.dumps(
                [item.model_dump(mode="json") for item in knowledge_items],
                ensure_ascii=False,
            )
            + "\n\nCanonical episode and continuity packet:\n"
            + json.dumps(episode_context, ensure_ascii=False)
            + "\n\nImmutable episode context and relevant scene evidence:\n"
            + json.dumps(
                self._targeted_modification_context(source_draft, target_path),
                ensure_ascii=False,
            )
        )
````

片段 SHA-256：`376a50770bb025c81dc8aec1819fbaf56dd93615dbe24d0d69bf14300830a3ae`
