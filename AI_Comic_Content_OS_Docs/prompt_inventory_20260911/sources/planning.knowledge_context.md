# 动态知识条目注入合同

编号：`planning.knowledge_context`。状态：`active_shared`。

来源：[backend/app/modules/script_engine/story_planning_service.py:12982](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_planning_service.py:12982)。符号：`StoryPlanningService._knowledge_context`。

策略动态选择原则、应用条件、限制和反例；明确不是固定剧情公式。

本页保留当前工作区原文，不是优化后的替代提示词，也不是某次模型调用的完整展开结果。

## 长文本阅读视图

按源码位置列出长字符串；静态文本按字符串值显示，花括号内动态表达式仅供识别，未执行。条件分支分别列出，不代表一次调用全部生效。短标签、拼装顺序和完整条件见后面的源码原文。

### 片段 1 · 源码第 12995 行

````text
{prefix}Creative knowledge bundle: not selected for this strategy.
````

### 片段 2 · 源码第 13009 行

````text
Creative knowledge bundle: {bundle.bundle_id} ({bundle.version})
````

### 片段 3 · 源码第 13010 行

````text
Knowledge selector: {trace.selector_version}
````

### 片段 4 · 源码第 13011 行

````text
Use these principles as bounded guidance, not rigid plot formulas:
````

### 片段 5 · 源码第 13014 行

````text
- [{item.knowledge_id}] {item.principle}
````

## 源码原文

此部分按原始行提取，保留缩进、条件、占位变量和全部短字符串。

````python
    def _knowledge_context(
        self,
        *,
        strategy: GenerationStrategy,
        content_spec: ContentSpec,
        include_market_contract: bool = True,
        preferred_categories: list[str] | None = None,
        max_items: int | None = None,
    ) -> str:
        bundle_id = strategy.draft_knowledge_bundle_id
        market_contract = self._market_contract_text(content_spec)
        if bundle_id is None:
            prefix = f"{market_contract}\n\n" if include_market_contract else ""
            return f"{prefix}Creative knowledge bundle: not selected for this strategy."
        try:
            bundle, items, trace = self._knowledge_bundle_catalog.select_for_draft(
                requested_bundle_id=bundle_id,
                content_spec=content_spec,
                target_platform=strategy.target_platform,
                preferred_categories=preferred_categories,
                max_items=max_items,
            )
        except InvalidKnowledgeBundleError as exc:
            raise StoryPlanningInputError(str(exc)) from exc

        lines = [
            *([market_contract, ""] if include_market_contract else []),
            f"Creative knowledge bundle: {bundle.bundle_id} ({bundle.version})",
            f"Knowledge selector: {trace.selector_version}",
            "Use these principles as bounded guidance, not rigid plot formulas:",
        ]
        for item in items:
            lines.append(f"- [{item.knowledge_id}] {item.principle}")
            lines.append("  Apply: " + " | ".join(item.application_rules))
            if item.limitations:
                lines.append("  Limits: " + " | ".join(item.limitations))
            if item.anti_patterns:
                lines.append("  Avoid: " + " | ".join(item.anti_patterns))
        return "\n".join(lines)
````

片段 SHA-256：`94aabf54fcf1f5907389dbf0f851130d0c5220642e8b0369cfacbf7e7a4a87cc`
