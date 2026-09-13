# 正文主提示词装配入口

编号：`script.master_builder`。状态：`默认主链`。

来源：[backend/app/modules/script_engine/prompt_builder.py:56](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/prompt_builder.py:56)。符号：`TemplatePromptBuilder.build_master_prompt`。

模板库所选内容加结构化合同；完整方法用于展示拼接过程，实际运行数据库模板未核实。

本页保留当前工作区原文，不是优化后的替代提示词，也不是某次模型调用的完整展开结果。

## 长文本阅读视图

按源码位置列出长字符串；静态文本按字符串值显示，花括号内动态表达式仅供识别，未执行。条件分支分别列出，不代表一次调用全部生效。短标签、拼装顺序和完整条件见后面的源码原文。

### 片段 1 · 源码第 73 行

````text
No prompt library items matched the generation strategy.
````

### 片段 2 · 源码第 92 行

````text
[{prompt_item.prompt_type.value}:{prompt_item.id}]
{rendered_template}
````

## 源码原文

此部分按原始行提取，保留缩进、条件、占位变量和全部短字符串。

````python
    def build_master_prompt(
        self,
        *,
        prompts: list[PromptLibraryItem],
        context: PromptBuildContext,
        strategy: GenerationStrategy,
        build_purpose: KnowledgeTargetStage = KnowledgeTargetStage.draft_generation,
        prompt_ids_override: list[str] | None = None,
    ) -> PromptBuildResult:
        prompt_map = {item.id: item for item in prompts}
        selected_prompt_ids = prompt_ids_override or strategy.prompt_ids
        selected_prompts = [
            prompt_map[prompt_id]
            for prompt_id in selected_prompt_ids
            if prompt_id in prompt_map
        ]
        if not selected_prompts:
            raise ValueError("No prompt library items matched the generation strategy.")

        rendered_variables = {
            "content_spec_id": context.content_spec_id,
            "content_spec_title": context.content_spec_title,
            "creative_brief_summary": context.creative_brief_summary,
            "platform_profile_id": context.platform_profile_id,
            "audience_profile_summary": context.audience_profile_summary,
            "commercial_goal_summary": context.commercial_goal_summary,
            "retrieved_asset_ids": ", ".join(context.retrieved_asset_ids) or "none",
            "generation_strategy_id": context.generation_strategy_id,
        }
        rendered_variables.update(context.extra_variables)

        sections: list[str] = []
        for prompt_item in selected_prompts:
            rendered_template = prompt_item.prompt_template.format_map(
                _SafeFormatDict(rendered_variables)
            )
            sections.append(f"[{prompt_item.prompt_type.value}:{prompt_item.id}]\n{rendered_template}")

        if build_purpose == KnowledgeTargetStage.draft_generation:
            # Preserve compatibility with evaluation builders that override the
            # pre-v2 single-argument Draft context method.
            structured_context = self._build_structured_context_section(
                rendered_variables
            )
        else:
            structured_context = self._build_structured_context_section(
                rendered_variables,
                build_purpose=build_purpose,
            )
        sections.append(structured_context)
        prompt_text = "\n\n".join(sections)
        return PromptBuildResult(
            prompt_text=prompt_text,
            rendered_variables=rendered_variables,
            trace=PromptBuildTrace(
                generation_strategy_id=strategy.id,
                prompt_ids=[item.id for item in selected_prompts],
                builder_version=self._builder_version,
                build_purpose=build_purpose,
                knowledge_refs=self._extract_knowledge_refs(rendered_variables),
                creative_context_version=self._extract_creative_context_version(
                    rendered_variables
                ),
            ),
        )
````

片段 SHA-256：`bd9bcb5c604fb4fac35f25dffff5ced3f4f8b9b0d9fe4e3adbc9116fb3c822ca`
