# 知识包选择与适用条件

编号：`shared-knowledge-selector`。状态：`shared`。

来源：[backend/app/modules/script_engine/knowledge_bundle.py:104](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/knowledge_bundle.py:104)。符号：`StaticKnowledgeBundleCatalog._select`。

辅助追溯片段，不是自然语言提示词；记录按ID、阶段、市场、类别和数量选知识的方式。

本页保留当前工作区原文，不是优化后的替代提示词，也不是某次模型调用的完整展开结果。

## 长文本阅读视图

按源码位置列出长字符串；静态文本按字符串值显示，花括号内动态表达式仅供识别，未执行。条件分支分别列出，不代表一次调用全部生效。短标签、拼装顺序和完整条件见后面的源码原文。

### 片段 1 · 源码第 118 行

````text
KnowledgeBundle '{requested_bundle_id}' is not present in the static catalog.
````

### 片段 2 · 源码第 122 行

````text
KnowledgeBundle '{requested_bundle_id}' cannot be used for {target_stage.value}.
````

### 片段 3 · 源码第 133 行

````text
KnowledgeBundle '{requested_bundle_id}' is not applicable:
````

### 片段 4 · 源码第 159 行

````text
Knowledge selection max_items must be positive.
````

### 片段 5 · 源码第 169 行

````text
The exact GenerationStrategy bundle matched its target stage, ContentSpec tags, and target platform; task categories were prioritized within the governed bundle.
````

### 片段 6 · 源码第 173 行

````text
The exact GenerationStrategy bundle matched its target stage, ContentSpec tags, and target platform.
````

## 源码原文

此部分按原始行提取，保留缩进、条件、占位变量和全部短字符串。

````python
    def _select(
        self,
        *,
        requested_bundle_id: str,
        content_spec: ContentSpec,
        target_platform: str,
        target_stage: KnowledgeTargetStage,
        preferred_categories: list[str] | None = None,
        max_items: int | None = None,
        excluded_knowledge_ids: set[str] | None = None,
    ) -> tuple[KnowledgeBundle, list[StaticKnowledgeItem], KnowledgeSelectionTrace]:
        bundle = self._bundles.get(requested_bundle_id)
        if bundle is None:
            raise InvalidKnowledgeBundleError(
                f"KnowledgeBundle '{requested_bundle_id}' is not present in the static catalog."
            )
        if bundle.target_stage != target_stage:
            raise InvalidKnowledgeBundleError(
                f"KnowledgeBundle '{requested_bundle_id}' cannot be used for "
                f"{target_stage.value}."
            )

        mismatch_reasons = self._find_condition_mismatches(
            bundle=bundle,
            content_spec=content_spec,
            target_platform=target_platform,
        )
        if mismatch_reasons:
            raise InvalidKnowledgeBundleError(
                f"KnowledgeBundle '{requested_bundle_id}' is not applicable: "
                + "; ".join(mismatch_reasons)
            )

        selected_items = [self._items[item_id] for item_id in bundle.knowledge_ids]
        if excluded_knowledge_ids:
            selected_items = [
                item
                for item in selected_items
                if item.knowledge_id not in excluded_knowledge_ids
            ]
        if preferred_categories:
            category_order = {
                category.casefold(): index
                for index, category in enumerate(preferred_categories)
            }
            original_order = {
                knowledge_id: index
                for index, knowledge_id in enumerate(bundle.knowledge_ids)
            }
            selected_items.sort(key=lambda item: (
                category_order.get(item.category.casefold(), len(category_order)),
                original_order[item.knowledge_id],
            ))
        if max_items is not None:
            if max_items < 1:
                raise InvalidKnowledgeBundleError("Knowledge selection max_items must be positive.")
            selected_items = selected_items[:max_items]
        selected_refs = [item.knowledge_id for item in selected_items]
        trace = KnowledgeSelectionTrace(
            selector_version=self.catalog_version,
            target_stage=target_stage,
            requested_bundle_id=requested_bundle_id,
            selected_bundle_id=bundle.bundle_id,
            selected_knowledge_refs=selected_refs,
            selection_reason=(
                "The exact GenerationStrategy bundle matched its target stage, "
                "ContentSpec tags, and target platform; task categories were "
                "prioritized within the governed bundle."
                if preferred_categories or max_items is not None or excluded_knowledge_ids
                else "The exact GenerationStrategy bundle matched its target stage, "
                "ContentSpec tags, and target platform."
            ),
        )
        return bundle, selected_items, trace
````

片段 SHA-256：`64a55700758e831cc9e7faaca20b05cde7f8a30a37de5d12810c88dff1c87c4d`
