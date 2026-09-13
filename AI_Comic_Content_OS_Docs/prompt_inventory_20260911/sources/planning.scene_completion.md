# 缺失或残缺场景执行蓝图补全

编号：`planning.scene_completion`。状态：`active_conditional_repair`。

来源：[backend/app/modules/script_engine/story_planning_service.py:8516](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_planning_service.py:8516)。符号：`StoryPlanningService._complete_episode_scene_execution_plan`。

含局部 prompt 字符串；生产模型缺蓝图时额外请求，只补 scene_execution_plan，失败阻断。

本页保留当前工作区原文，不是优化后的替代提示词，也不是某次模型调用的完整展开结果。

## 长文本阅读视图

按源码位置列出长字符串；静态文本按字符串值显示，花括号内动态表达式仅供识别，未执行。条件分支分别列出，不代表一次调用全部生效。短标签、拼装顺序和完整条件见后面的源码原文。

### 片段 1 · 源码第 8540 行

````text
scene_execution_plan_count_mismatch
````

### 片段 2 · 源码第 8541 行

````text
scene_execution_plan_numbering_invalid
````

### 片段 3 · 源码第 8549 行

````text
你是分集规划阶段的执行蓝图补全器。以下是已经批准的单集创意合同，只补齐 scene_execution_plan，不改动任何集级字段、人物引用、地点、剧情结果、预算或集数。每个场景必须把抽象意图翻译成正文模型可以直接执行的动作合同：对抗、信息变化、主角选择或代价、可观察证据、禁止改变的事实、可见动作、转折、对白目的和退出状态。场景数量、编号、对白行数和镜头数必须精确匹配批准合同。

当前硬问题：{json.dumps(scene_issue_codes, ensure_ascii=False)}
批准合同：{json.dumps(item_payload, ensure_ascii=False, separators=(',', ':'))}

只返回一个 JSON 对象，唯一顶层字段为 scene_execution_plan。不要 Markdown、解释、额外字段或占位语句。
````

### 片段 4 · 源码第 8568 行

````text
Episode scene execution plan completion
````

### 片段 5 · 源码第 8586 行

````text
Episode scene execution plan completion returned no scene list; the production roadmap is blocked and no fallback blueprint is allowed.
````

### 片段 6 · 源码第 8602 行

````text
scene_execution_plan_count_mismatch
````

### 片段 7 · 源码第 8602 行

````text
scene_execution_plan_numbering_invalid
````

### 片段 8 · 源码第 8606 行

````text
Episode scene execution plan completion remained incomplete:
````

### 片段 9 · 源码第 8612 行

````text
Episode scene execution plan completion failed validation; the production roadmap is blocked.
````

## 源码原文

此部分按原始行提取，保留缩进、条件、占位变量和全部短字符串。

````python
    def _complete_episode_scene_execution_plan(
        self,
        item: EpisodePlanGenerationItem,
        *,
        adapter: LLMAdapter,
        strategy: GenerationStrategy,
    ) -> EpisodePlanGenerationItem:
        """Ask the planning model to complete a missing or partial scene blueprint."""

        get_model_info = getattr(adapter, "get_model_info", None)
        model_info = get_model_info() if callable(get_model_info) else None
        # Deterministic test/fixed adapters intentionally exercise the legacy
        # envelope and do not implement a second model response. Production
        # adapters always take the bounded completion path below.
        if model_info is None or model_info.provider.casefold() in {"fixed", "mock", "test"}:
            return item

        issues = episode_execution_readiness_issues(item)
        scene_issue_codes = [
            code
            for code in issues
            if code == "scene_execution_plan_missing"
            or code.startswith("scene_execution_plan.")
            or code in {
                "scene_execution_plan_count_mismatch",
                "scene_execution_plan_numbering_invalid",
            }
        ]
        if not scene_issue_codes:
            return item.model_copy(update={"execution_ready": True})

        item_payload = item.model_dump(mode="json", exclude={"layer_contracts"})
        prompt = (
            "你是分集规划阶段的执行蓝图补全器。以下是已经批准的单集创意合同，"
            "只补齐 scene_execution_plan，不改动任何集级字段、人物引用、地点、"
            "剧情结果、预算或集数。每个场景必须把抽象意图翻译成正文模型可以直接"
            "执行的动作合同：对抗、信息变化、主角选择或代价、可观察证据、禁止改变"
            "的事实、可见动作、转折、对白目的和退出状态。场景数量、编号、对白行数"
            "和镜头数必须精确匹配批准合同。\n\n"
            f"当前硬问题：{json.dumps(scene_issue_codes, ensure_ascii=False)}\n"
            f"批准合同：{json.dumps(item_payload, ensure_ascii=False, separators=(',', ':'))}\n\n"
            "只返回一个 JSON 对象，唯一顶层字段为 scene_execution_plan。不要 Markdown、"
            "解释、额外字段或占位语句。"
        )
        completion_strategy = strategy.model_copy(
            update={"max_tokens": min(max(strategy.max_tokens, 1800), 5000)}
        )
        generated = self._generate_structured_planning_response(
            adapter,
            prompt,
            strategy=completion_strategy,
            output_schema=_episode_scene_execution_completion_schema(),
            artifact_name="Episode scene execution plan completion",
            allow_stream=True,
            allow_relaxed_transport=False,
        )
        source: object = generated
        while isinstance(source, dict):
            if "scene_execution_plan" in source:
                source = source["scene_execution_plan"]
                break
            for wrapper in ("data", "result", "patch", "episode_plan"):
                nested = source.get(wrapper)
                if isinstance(nested, dict):
                    source = nested
                    break
            else:
                break
        if not isinstance(source, list):
            raise EpisodeSceneExecutionCompletionError(
                "Episode scene execution plan completion returned no scene list; "
                "the production roadmap is blocked and no fallback blueprint is allowed."
            )
        try:
            completed_scenes = TypeAdapter(list[EpisodeSceneExecutionBeat]).validate_python(source)
            completed = item.model_copy(
                update={
                    "scene_execution_plan": completed_scenes,
                    "execution_ready": True,
                }
            )
            remaining = episode_execution_readiness_issues(completed)
            remaining_scene_issues = [
                code for code in remaining
                if code == "scene_execution_plan_missing"
                or code.startswith("scene_execution_plan.")
                or code in {"scene_execution_plan_count_mismatch", "scene_execution_plan_numbering_invalid"}
            ]
            if remaining_scene_issues:
                raise StoryPlanningInputError(
                    "Episode scene execution plan completion remained incomplete: "
                    + ", ".join(remaining_scene_issues)
                )
            return completed
        except ValidationError as error:
            raise EpisodeSceneExecutionCompletionError(
                "Episode scene execution plan completion failed validation; "
                "the production roadmap is blocked."
            ) from error
````

片段 SHA-256：`597c03ecf8700fc3cd27455657665b01dcb490369b8c1725632e8ce2fd400118`
