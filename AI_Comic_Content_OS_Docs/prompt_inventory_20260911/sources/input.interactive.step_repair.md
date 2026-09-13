# 保留的逐节候选输出修复包装

编号：`input.interactive.step_repair`。状态：`legacy_conditional`。

来源：[backend/app/modules/script_engine/story_planning_service.py:4758](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_planning_service.py:4758)。符号：`StoryPlanningService.generate_story_bible_interactive_step`。

完整方法包含 _build_interactive_story_bible_step_prompt 调用及附加严格四候选修复要求；只有旧入口被调用且输出无效时触发。

本页保留当前工作区原文，不是优化后的替代提示词，也不是某次模型调用的完整展开结果。

## 长文本阅读视图

按源码位置列出长字符串；静态文本按字符串值显示，花括号内动态表达式仅供识别，未执行。条件分支分别列出，不代表一次调用全部生效。短标签、拼装顺序和完整条件见后面的源码原文。

### 片段 1 · 源码第 4766 行

````text
Interactive Story Bible steps require the Story Project's current ContentSpec.
````

### 片段 2 · 源码第 4770 行

````text
ContentSpec '{content_spec_id}' was not found.
````

### 片段 3 · 源码第 4774 行

````text
GenerationStrategy '{payload.generation_strategy_id}' was not found.
````

### 片段 4 · 源码第 4819 行

````text
The previous step was invalid.
````

### 片段 5 · 源码第 4821 行

````text

Raw model content:
{initial_error.raw_content[:6000]}
````

### 片段 6 · 源码第 4824 行

````text
{prompt}

{repair_context}
Return exactly four candidates with unique candidate_id values and no commentary.
````

## 源码原文

此部分按原始行提取，保留缩进、条件、占位变量和全部短字符串。

````python
    def generate_story_bible_interactive_step(
        self,
        payload: StoryBibleInteractiveStepRequest,
    ) -> StoryBibleInteractiveStepOutput:
        project = self._long_story_service.get_project(payload.story_project_id)
        content_spec_id = payload.content_spec_id or project.content_spec_id
        if not content_spec_id or project.content_spec_id != content_spec_id:
            raise StoryPlanningInputError(
                "Interactive Story Bible steps require the Story Project's current ContentSpec."
            )
        content_spec = self._content_spec_repository.get(content_spec_id)
        if content_spec is None:
            raise StoryPlanningInputError(f"ContentSpec '{content_spec_id}' was not found.")
        strategy = self._generation_strategy_repository.get(payload.generation_strategy_id)
        if strategy is None:
            raise StoryPlanningInputError(
                f"GenerationStrategy '{payload.generation_strategy_id}' was not found."
            )
        # Interactive review only needs four compact decision cards. Keep this
        # bounded independently from the larger Story Bible synthesis budget.
        interactive_strategy = strategy.model_copy(
            update={
                "max_tokens": min(
                    strategy.max_tokens,
                    INTERACTIVE_STORY_BIBLE_COMPLEX_MAX_OUTPUT_TOKENS
                    if payload.step in INTERACTIVE_STORY_BIBLE_COMPLEX_STEPS
                    else INTERACTIVE_STORY_BIBLE_SIMPLE_MAX_OUTPUT_TOKENS,
                )
            }
        )
        prompt = self._build_interactive_story_bible_step_prompt(
            payload=payload,
            project_title=project.title,
            content_spec=content_spec,
        )
        output: object | None = None
        initial_error: Exception | None = None
        try:
            output = self._story_bible_llm_adapter.generate_structured_output(
                prompt,
                strategy=interactive_strategy,
                output_schema=StoryBibleInteractiveStepOutput.model_json_schema(),
            )
        except LLMStructuredOutputError as exc:
            initial_error = exc
        parsed: StoryBibleInteractiveStepOutput | None = None
        if output is not None:
            try:
                parsed = StoryBibleInteractiveStepOutput.model_validate(
                    _without_adapter_metadata(output)
                )
            except ValidationError as exc:
                initial_error = exc
        if parsed is None and isinstance(initial_error, LLMStructuredOutputError):
            # Salvage a complete candidate set locally before spending another
            # full model round trip on a schema repair.
            parsed = self._coerce_interactive_story_bible_step_output(
                initial_error.raw_content,
                step=payload.step,
            )
        if parsed is None:
            repair_context = str(initial_error) if initial_error else "The previous step was invalid."
            if isinstance(initial_error, LLMStructuredOutputError) and initial_error.raw_content:
                repair_context += f"\nRaw model content:\n{initial_error.raw_content[:6_000]}"
            try:
                repaired = self._story_bible_llm_adapter.generate_structured_output(
                    f"{prompt}\n\n{repair_context}\nReturn exactly four candidates with unique candidate_id values and no commentary.",
                    strategy=interactive_strategy,
                    output_schema=StoryBibleInteractiveStepOutput.model_json_schema(),
                )
            except LLMStructuredOutputError as repair_error:
                parsed = self._coerce_interactive_story_bible_step_output(
                    repair_error.raw_content,
                    step=payload.step,
                ) or self._coerce_interactive_story_bible_step_output(
                    initial_error.raw_content if isinstance(initial_error, LLMStructuredOutputError) else output,
                    step=payload.step,
                )
                if parsed is None:
                    parsed = self._fallback_interactive_story_bible_step(payload.step)
            else:
                try:
                    parsed = StoryBibleInteractiveStepOutput.model_validate(
                        _without_adapter_metadata(repaired)
                    )
                except ValidationError:
                    parsed = self._coerce_interactive_story_bible_step_output(
                        repaired,
                        step=payload.step,
                    ) or self._fallback_interactive_story_bible_step(payload.step)
        if parsed.step != payload.step or len({candidate.candidate_id for candidate in parsed.candidates}) != 4:
            normalized = self._coerce_interactive_story_bible_step_output(
                parsed.model_dump(),
                step=payload.step,
            )
            parsed = normalized or self._fallback_interactive_story_bible_step(payload.step)
        return parsed
````

片段 SHA-256：`fd3140026d13c991213703f8c23d7902e6ede43711a87a8768e7c3f5e94cc710`
