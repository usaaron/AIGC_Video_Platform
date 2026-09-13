# 递归拆分连续性语义修复

编号：`planning.decomposition_semantic_repair`。状态：`active_conditional_repair`。

来源：[backend/app/modules/script_engine/story_planning_service.py:11271](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_planning_service.py:11271)。符号：`StoryPlanningService._build_decomposition_semantic_repair_prompt`。

结构正确但规划连续性失败后调用。

本页保留当前工作区原文，不是优化后的替代提示词，也不是某次模型调用的完整展开结果。

## 长文本阅读视图

按源码位置列出长字符串；静态文本按字符串值显示，花括号内动态表达式仅供识别，未执行。条件分支分别列出，不代表一次调用全部生效。短标签、拼装顺序和完整条件见后面的源码原文。

### 片段 1 · 源码第 11278 行

````text
{original_prompt}

The previous decomposition was structurally valid JSON but violated approved planning continuity.
Repair the child nodes once. Preserve all valid content, ranges and IDs, while fixing the exact failure below.
Do not remove or paraphrase any approved parent turning point.
Failure: {validation_error}

Previous decomposition:
{output.model_dump_json()}

Return one corrected JSON object only.
````

## 源码原文

此部分按原始行提取，保留缩进、条件、占位变量和全部短字符串。

````python
    @staticmethod
    def _build_decomposition_semantic_repair_prompt(
        *,
        original_prompt: str,
        output: StoryPlanNodeDecompositionOutput,
        validation_error: StoryPlanningInputError,
    ) -> str:
        return f"""{original_prompt}

The previous decomposition was structurally valid JSON but violated approved planning continuity.
Repair the child nodes once. Preserve all valid content, ranges and IDs, while fixing the exact failure below.
Do not remove or paraphrase any approved parent turning point.
Failure: {validation_error}

Previous decomposition:
{output.model_dump_json()}

Return one corrected JSON object only."""
````

片段 SHA-256：`c59e9eaeb667a01e8967423867d8e8bd3eeed17da780b663580000098ebde3e3`
