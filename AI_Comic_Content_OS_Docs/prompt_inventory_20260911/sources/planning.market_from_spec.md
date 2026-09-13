# 从项目内容规格注入市场合同

编号：`planning.market_from_spec`。状态：`active_shared`。

来源：[backend/app/modules/script_engine/story_planning_service.py:4342](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_planning_service.py:4342)。符号：`StoryPlanningService._market_contract_text`。

市场合同内容来自 content_spec/market_profile.py；同时输出文化背景。

本页保留当前工作区原文，不是优化后的替代提示词，也不是某次模型调用的完整展开结果。

## 长文本阅读视图

按源码位置列出长字符串；静态文本按字符串值显示，花括号内动态表达式仅供识别，未执行。条件分支分别列出，不代表一次调用全部生效。短标签、拼装顺序和完整条件见后面的源码原文。

### 片段 1 · 源码第 4346 行

````text
WORKFLOW MARKET CONTRACT ({contract.profile})
{contract.prompt_contract}
Cultural context: {contract.cultural_context}
````

## 源码原文

此部分按原始行提取，保留缩进、条件、占位变量和全部短字符串。

````python
    @staticmethod
    def _market_contract_text(content_spec: ContentSpec) -> str:
        contract = content_spec_market_contract(content_spec)
        return (
            f"WORKFLOW MARKET CONTRACT ({contract.profile})\n"
            f"{contract.prompt_contract}\n"
            f"Cultural context: {contract.cultural_context}"
        )
````

片段 SHA-256：`c9cfaec1e18c30683bba16dea00af249de8b5c294612c2a76c635a59126cdb5b`
