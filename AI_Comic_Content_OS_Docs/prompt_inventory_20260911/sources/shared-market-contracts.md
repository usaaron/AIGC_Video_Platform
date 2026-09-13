# 大陆与海外市场语言合同

编号：`shared-market-contracts`。状态：`shared`。

来源：[backend/app/modules/content_spec/market_profile.py:36](/Users/simonriley/Downloads/docs/backend/app/modules/content_spec/market_profile.py:36)。符号：`_CONTRACTS`。

按项目市场选择，不是两条市场合同同时生效；海外合同还引用共享正文语言合同。

本页保留当前工作区原文，不是优化后的替代提示词，也不是某次模型调用的完整展开结果。

## 长文本阅读视图

按源码位置列出长字符串；静态文本按字符串值显示，花括号内动态表达式仅供识别，未执行。条件分支分别列出，不代表一次调用全部生效。短标签、拼装顺序和完整条件见后面的源码原文。

### 片段 1 · 源码第 42 行

````text
Chinese-language and Chinese-mainland cultural context.
````

### 片段 2 · 源码第 44 行

````text
Market path: cn_mainland. Use Simplified Chinese (zh-CN) for every human-readable value, name, label, planning field, and dialogue. You are creating a Chinese mainland serialized comic story. Follow Chinese-mainland language and cultural context. Do not switch to English output or overseas cultural assumptions.
````

### 片段 3 · 源码第 61 行

````text
English-language overseas/international cultural context by default; do not assume a specific country until a country profile is selected.
````

### 片段 4 · 源码第 65 行

````text
Market path: overseas (current profile: overseas_tiktok). Keep all creator-facing planning artifacts, including the Story Bible, story tree, episode roadmap, labels, and review text, in Simplified Chinese so the Chinese-speaking author can review them. Preserve the established partner screenplay delivery template: actions, visual descriptions, and performance intent remain Simplified Chinese; only the internal stable dialogue speaker ID and spoken dialogue use natural English for the English-speaking audience. Character cards and their visible names remain Simplified Chinese. Follow the default English-language overseas/international cultural context. Do not assume a specific country; country-specific profiles will be added later. Do not apply Chinese-mainland cultural assumptions.
````

## 源码原文

此部分按原始行提取，保留缩进、条件、占位变量和全部短字符串。

````python
_CONTRACTS = {
    CN_MAINLAND_MARKET: MarketProfileContract(
        profile=CN_MAINLAND_MARKET,
        family=CN_MAINLAND_MARKET,
        output_language="zh",
        language_name="Simplified Chinese (zh-CN)",
        cultural_context="Chinese-language and Chinese-mainland cultural context.",
        prompt_contract=(
            "Market path: cn_mainland. Use Simplified Chinese (zh-CN) for every "
            "human-readable value, name, label, planning field, and dialogue. "
            "You are creating a Chinese mainland serialized comic story. Follow "
            "Chinese-mainland language and cultural context. Do not switch "
            "to English output or overseas cultural assumptions."
        ),
    ),
    OVERSEAS_TIKTOK_MARKET: MarketProfileContract(
        profile=OVERSEAS_TIKTOK_MARKET,
        family="overseas",
        output_language="en",
        # The creator-facing planning artifacts remain in Simplified Chinese.
        # ``output_language`` stays English because the established overseas
        # screenplay contract uses English dialogue for the audience-facing
        # delivery while keeping actions and intent in Chinese.
        language_name="Simplified Chinese (zh-CN)",
        cultural_context=(
            "English-language overseas/international cultural context by default; "
            "do not assume a specific country until a country profile is selected."
        ),
        prompt_contract=(
            "Market path: overseas (current profile: overseas_tiktok). Keep all "
            "creator-facing planning artifacts, including the Story Bible, story tree, "
            "episode roadmap, labels, and review text, in Simplified Chinese so the "
            "Chinese-speaking author can review them. Preserve the established partner "
            "screenplay delivery template: actions, visual descriptions, and performance "
            "intent remain Simplified Chinese; only the internal stable dialogue speaker ID "
            "and spoken dialogue use natural English for the English-speaking audience. "
            "Character cards and their visible names remain Simplified Chinese. Follow the default "
            "English-language overseas/international cultural context. Do not assume a "
            "specific country; country-specific profiles will be added later. Do not "
            "apply Chinese-mainland cultural assumptions. "
            + OVERSEAS_EPISODE_LANGUAGE_WORKFLOW_CONTRACT
        ),
    ),
}
````

片段 SHA-256：`c62a887322651b3ffca045d981e0bec065e8ff15db58a3532f7feb2e2daba4d6`
