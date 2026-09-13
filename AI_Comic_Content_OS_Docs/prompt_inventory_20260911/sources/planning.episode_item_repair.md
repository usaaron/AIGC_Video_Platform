# 单集路线图失败定向修复

编号：`planning.episode_item_repair`。状态：`active_conditional_repair`。

来源：[backend/app/modules/script_engine/story_planning_service.py:11842](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_planning_service.py:11842)。符号：`StoryPlanningService._build_episode_plan_item_repair_prompt`。

单集接口失败重试；其 250-450 字与主合同 250-650 字不同。

本页保留当前工作区原文，不是优化后的替代提示词，也不是某次模型调用的完整展开结果。

## 长文本阅读视图

按源码位置列出长字符串；静态文本按字符串值显示，花括号内动态表达式仅供识别，未执行。条件分支分别列出，不代表一次调用全部生效。短标签、拼装顺序和完整条件见后面的源码原文。

### 片段 1 · 源码第 11855 行

````text
{original_prompt}

TARGETED SINGLE-ITEM REPAIR
The previous attempt for Episode {episode_number} failed this exact contract check:
{failure or 'No complete structured item was returned.'}

Previous response, usable only for valid episode content:
{json.dumps(previous, ensure_ascii=False, separators=(',', ':'))}

Correct only Episode {episode_number}. Return one complete native JSON object with the
exact root fields required above. Do not return an array, wrapper, fragment, Markdown,
or explanation. Keep the repaired item within the 250-450 Chinese-character roadmap target
and compress repetition before returning if necessary.
````

## 源码原文

此部分按原始行提取，保留缩进、条件、占位变量和全部短字符串。

````python
    @staticmethod
    def _build_episode_plan_item_repair_prompt(
        *,
        original_prompt: str,
        episode_number: int,
        generated: dict[str, object] | None,
        failure: Exception | None,
    ) -> str:
        previous = (
            {key: value for key, value in generated.items() if key != "_meta"}
            if generated is not None
            else None
        )
        return f"""{original_prompt}

TARGETED SINGLE-ITEM REPAIR
The previous attempt for Episode {episode_number} failed this exact contract check:
{failure or 'No complete structured item was returned.'}

Previous response, usable only for valid episode content:
{json.dumps(previous, ensure_ascii=False, separators=(',', ':'))}

Correct only Episode {episode_number}. Return one complete native JSON object with the
exact root fields required above. Do not return an array, wrapper, fragment, Markdown,
or explanation. Keep the repaired item within the 250-450 Chinese-character roadmap target
and compress repetition before returning if necessary."""
````

片段 SHA-256：`94277f66601d197a971930303b76f9a036118d45ff9735900b3231a5f6e6a7c5`
