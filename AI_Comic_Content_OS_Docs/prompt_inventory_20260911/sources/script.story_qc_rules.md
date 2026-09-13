# 默认规则式Story QC入口

编号：`script.story_qc_rules`。状态：`本地规则，非LLM提示词`。

来源：[backend/app/modules/script_engine/story_qc.py:42](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_qc.py:42)。符号：`PlaceholderStoryQC.evaluate`。

源码默认PlaceholderStoryQC，本地rubric信号不应冒充模型专业审稿。

本页保留当前工作区原文，不是优化后的替代提示词，也不是某次模型调用的完整展开结果。

## 长文本阅读视图

按源码位置列出长字符串；静态文本按字符串值显示，花括号内动态表达式仅供识别，未执行。条件分支分别列出，不代表一次调用全部生效。短标签、拼装顺序和完整条件见后面的源码原文。

### 片段 1 · 源码第 77 行

````text
Rubric-aligned check for hook presence.
````

### 片段 2 · 源码第 83 行

````text
Rubric-aligned check for scene structure presence.
````

### 片段 3 · 源码第 89 行

````text
Rubric-aligned check for strategy QC configuration.
````

### 片段 4 · 源码第 96 行

````text
Story quality rubric aggregate score.
````

### 片段 5 · 源码第 98 行

````text
Mode-aware finale rubric aggregate; formal closure replaces continuation-pressure scoring.
````

### 片段 6 · 源码第 108 行

````text
Use the story rubric deductions and suggestions to build a revision plan.
````

## 源码原文

此部分按原始行提取，保留缩进、条件、占位变量和全部短字符串。

````python
    def evaluate(
        self,
        draft_script: Mapping[str, Any],
        *,
        strategy: GenerationStrategy,
    ) -> StoryQCReport:
        rubric_result = self._rubric_evaluator.evaluate(draft_script, stage="draft")
        requires_hook = ending_mode_requires_hook(draft_script.get("ending_mode"))
        rubric_categories = (
            rubric_result.categories
            if requires_hook
            else self._adapt_finale_rubric_categories(
                rubric_result.categories,
                draft_script,
            )
        )
        rubric_overall_score = (
            rubric_result.overall_score
            if requires_hook
            else self._aggregate_rubric_categories(rubric_categories)
        )
        rubric_passed = (
            rubric_result.passed
            if requires_hook
            else rubric_overall_score >= 0.65
        )
        dimension_evaluations = self._build_dimension_evaluations(
            draft_script,
            rubric_categories,
        )
        checks = [
            StoryQCCheck(
                check_name="hook_present",
                passed=bool(draft_script.get("hook")),
                score=1.0 if draft_script.get("hook") else 0.3,
                note="Rubric-aligned check for hook presence.",
            ),
            StoryQCCheck(
                check_name="scenes_present",
                passed=bool(draft_script.get("scenes")),
                score=1.0 if draft_script.get("scenes") else 0.2,
                note="Rubric-aligned check for scene structure presence.",
            ),
            StoryQCCheck(
                check_name="strategy_qc_enabled",
                passed=strategy.qc_enabled,
                score=0.8 if strategy.qc_enabled else 0.4,
                note="Rubric-aligned check for strategy QC configuration.",
            ),
            StoryQCCheck(
                check_name="rubric_score",
                passed=rubric_passed,
                score=rubric_overall_score,
                note=(
                    "Story quality rubric aggregate score."
                    if requires_hook
                    else "Mode-aware finale rubric aggregate; formal closure replaces continuation-pressure scoring."
                ),
            ),
        ]
        overall_score = round(sum(check.score for check in checks) / len(checks), 3)
        return StoryQCReport(
            overall_score=overall_score,
            status=StoryQCStatus.placeholder,
            checks=checks,
            recommended_actions=[
                "Use the story rubric deductions and suggestions to build a revision plan."
            ],
            rubric_overall_score=rubric_overall_score,
            rubric_categories=[
                StoryQCRubricCategory(
                    category_name=category.category_name,
                    score=category.score,
                    max_score=category.max_score,
                    deduction_reasons=category.deduction_reasons,
                    revision_suggestions=category.revision_suggestions,
                )
                for category in rubric_categories
            ],
            report_version="story_qc_report.v1",
            explainability_status="partial",
            dimension_evaluations=dimension_evaluations,
            evidence_summary=self._build_evidence_summary(dimension_evaluations),
            knowledge_refs=self._build_knowledge_refs(
                dimension_evaluations,
                ending_mode=draft_script.get("ending_mode"),
            ),
        )
````

片段 SHA-256：`f6f1ed18fd4e7ff59ac5a298220defc03452ac4c1def9ee483361345a2865ac1`
