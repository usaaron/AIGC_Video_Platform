# 作者决策优先级与授权合同

编号：`shared-author-decisions`。状态：`shared`。

来源：[backend/app/modules/script_engine/story_planning_service.py:216](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_planning_service.py:216)。符号：`_creative_decision_prompt_contract`。

供总纲及规划注入；已确认、待定、授权建议分别处理。原文未授权空白不能发明高影响事实，尚未按本次讨论改写。

本页保留当前工作区原文，不是优化后的替代提示词，也不是某次模型调用的完整展开结果。

## 长文本阅读视图

按源码位置列出长字符串；静态文本按字符串值显示，花括号内动态表达式仅供识别，未执行。条件分支分别列出，不代表一次调用全部生效。短标签、拼装顺序和完整条件见后面的源码原文。

### 片段 1 · 源码第 220 行

````text
No structured author-decision ledger was supplied; preserve the raw user sources exactly.
````

### 片段 2 · 源码第 221 行

````text
Author decision ledger (higher authority than generated suggestions):
{ledger}

Decision authority rules:
- confirmed/canonical values are author-owned facts. Preserve their meaning and never contradict them.
- an author_revision record means the current saved Story Bible text is the author's newer decision and takes
  precedence over an older raw-input statement where those two differ.
- unresolved values must remain visibly open. Do not choose a concrete outcome, identity, betrayal, death, twist,
  relationship result, theme conclusion, or ending on the author's behalf.
- delegated values grant only the recorded ai_permission. suggest_only permits a provisional draft direction,
  never a new canonical fact. If the author later saves and confirms the resulting visible Story Bible text,
  that approved text becomes canonical while any field still visibly marked 待定 remains unresolved.
- Missing content is not permission to invent high-impact story facts. Use an explicit Chinese “待定” structural
  statement when the schema needs a value, and leave optional collections empty.
- Structural derivations may organize episode capacity, pacing functions, causal slots, and review checkpoints,
  but they must not silently decide story content.
````

## 源码原文

此部分按原始行提取，保留缩进、条件、占位变量和全部短字符串。

````python
def _creative_decision_prompt_contract(
    decisions: list[CreativeDecisionRecord],
) -> str:
    if not decisions:
        return "No structured author-decision ledger was supplied; preserve the raw user sources exactly."
    return """Author decision ledger (higher authority than generated suggestions):
{ledger}

Decision authority rules:
- confirmed/canonical values are author-owned facts. Preserve their meaning and never contradict them.
- an author_revision record means the current saved Story Bible text is the author's newer decision and takes
  precedence over an older raw-input statement where those two differ.
- unresolved values must remain visibly open. Do not choose a concrete outcome, identity, betrayal, death, twist,
  relationship result, theme conclusion, or ending on the author's behalf.
- delegated values grant only the recorded ai_permission. suggest_only permits a provisional draft direction,
  never a new canonical fact. If the author later saves and confirms the resulting visible Story Bible text,
  that approved text becomes canonical while any field still visibly marked 待定 remains unresolved.
- Missing content is not permission to invent high-impact story facts. Use an explicit Chinese “待定” structural
  statement when the schema needs a value, and leave optional collections empty.
- Structural derivations may organize episode capacity, pacing functions, causal slots, and review checkpoints,
  but they must not silently decide story content.""".format(
        ledger=json.dumps(
            [decision.model_dump(mode="json") for decision in decisions],
            ensure_ascii=False,
            separators=(",", ":"),
        )
    )
````

片段 SHA-256：`aa86a70662c09418a2fc5be3ae936b8127fe10fa7c1cac5598652c060a75377a`
