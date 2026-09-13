# 从总纲注入市场合同

编号：`planning.market_from_bible`。状态：`active_shared`。

来源：[backend/app/modules/script_engine/story_planning_service.py:4351](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_planning_service.py:4351)。符号：`StoryPlanningService._story_bible_market_contract_text`。

后续剧情树与分集继承总纲市场路径。

本页保留当前工作区原文，不是优化后的替代提示词，也不是某次模型调用的完整展开结果。

## 长文本阅读视图

按源码位置列出长字符串；静态文本按字符串值显示，花括号内动态表达式仅供识别，未执行。条件分支分别列出，不代表一次调用全部生效。短标签、拼装顺序和完整条件见后面的源码原文。

### 片段 1 · 源码第 4355 行

````text
WORKFLOW MARKET CONTRACT ({contract.profile})
{contract.prompt_contract}
Cultural context: {contract.cultural_context}
````

## 源码原文

此部分按原始行提取，保留缩进、条件、占位变量和全部短字符串。

````python
    @staticmethod
    def _story_bible_market_contract_text(story_bible: StoryBible) -> str:
        contract = market_profile_contract(getattr(story_bible, "market_profile", None))
        return (
            f"WORKFLOW MARKET CONTRACT ({contract.profile})\n"
            f"{contract.prompt_contract}\n"
            f"Cultural context: {contract.cultural_context}"
        )
````

片段 SHA-256：`477c099d9325dda48ca89ad4ef169b985adfdd1f7aceab83f6611e4788d9861e`
