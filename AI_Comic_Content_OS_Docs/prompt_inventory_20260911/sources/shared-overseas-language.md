# 海外正文的中文意图与英文对白合同

编号：`shared-overseas-language`。状态：`conditional`。

来源：[backend/app/script_delivery_contract.py:199](/Users/simonriley/Downloads/docs/backend/app/script_delivery_contract.py:199)。符号：`OVERSEAS_EPISODE_LANGUAGE_WORKFLOW_CONTRACT`。

海外项目适用，保留已有中英交付约定。

本页保留当前工作区原文，不是优化后的替代提示词，也不是某次模型调用的完整展开结果。

## 长文本阅读视图

按源码位置列出长字符串；静态文本按字符串值显示，花括号内动态表达式仅供识别，未执行。条件分支分别列出，不代表一次调用全部生效。短标签、拼装顺序和完整条件见后面的源码原文。

### 片段 1 · 源码第 200 行

````text
海外路径每一集都必须遵守同一语言与人物身份合同。OutputLanguage=en仅表示dialogues.text使用英文，不表示整份剧本使用英文；dialogues.text使用自然英文，必须简洁、可表演。dialogues.character_name使用稳定英文名作为内部说话人标识；除这两个字段外，title、logline、synopsis、hook、episode_goal、next_episode_question、characters人物卡、人物与关系状态、场景标题、动作、画面描述、因果字段、表演intent及所有其他创作者可见文字必须在首次输出时直接生成，所有可见叙事字段统一使用简体中文，不得先生成英文再整集翻译。每条dialogues.chinese_translation必须在同一次输出中写该句准确、自然的简体中文对照，语义、语气、称谓和信息量必须一致；dialogues.chinese_character_name写该说话人的稳定中文名。动作中提到人物时只用对应中文名，不得混入英文名；显示层会呈现中文名（ENGLISH NAME），不得在同一个text字段中混写中英台词。characters中的name、role、description、motivation全部只用简体中文，并且同一真实人物在一集内只能出现一条人物记录。职位、亲属称谓、昵称、代号、假名、曾用名、公开身份、秘密身份或身份变化只能作为同一人物的称呼或身份事实记录，绝不能据此新建重复人物。跨集必须沿用Story Bible、人物卡、连续性账本和canonical_character_names已经确认的同一身份；不得把同名的不同人物错误合并，也不得把同一人物的不同称呼错误拆分。如果两个不同人物确实同名，必须沿用稳定的纯中文消歧名，例如李伟（医生）与李伟（记者），并在后续每集保持不变；不得用英文消歧。
````

## 源码原文

此部分按原始行提取，保留缩进、条件、占位变量和全部短字符串。

````python
OVERSEAS_EPISODE_LANGUAGE_WORKFLOW_CONTRACT = (
    "海外路径每一集都必须遵守同一语言与人物身份合同。OutputLanguage=en仅表示"
    "dialogues.text使用英文，不表示整份剧本使用英文；dialogues.text使用自然英文，"
    "必须简洁、可表演。"
    "dialogues.character_name使用"
    "稳定英文名作为内部说话人标识；除这两个字段外，title、logline、synopsis、hook、"
    "episode_goal、next_episode_question、characters人物卡、人物与关系状态、场景标题、"
    "动作、画面描述、因果字段、表演intent及所有其他创作者可见文字必须在首次输出时直接"
    "生成，所有可见叙事字段统一使用简体中文，不得先生成英文再整集翻译。每条"
    "dialogues.chinese_translation必须在同一次输出中写该句准确、自然的简体中文对照，"
    "语义、语气、称谓和信息量必须一致；"
    "dialogues.chinese_character_name写该说话人的稳定中文名。动作中提到人物时只用"
    "对应中文名，不得混入英文名；"
    "显示层会呈现中文名（ENGLISH NAME），不得在同一个text字段中混写中英台词。"
    "characters中的name、role、description、motivation全部只用简体中文，并且同一真实人物"
    "在一集内只能出现一条人物记录。职位、亲属称谓、昵称、代号、假名、曾用名、公开身份、"
    "秘密身份或身份变化只能作为同一人物的称呼或身份事实记录，绝不能据此新建重复人物。"
    "跨集必须沿用Story Bible、人物卡、连续性账本和canonical_character_names已经确认的"
    "同一身份；不得把同名的不同人物错误合并，也不得把同一人物的不同称呼错误拆分。"
    "如果两个不同人物确实同名，必须沿用稳定的纯中文消歧名，例如李伟（医生）与"
    "李伟（记者），并在后续每集保持不变；不得用英文消歧。"
)
````

片段 SHA-256：`98fa9df9e409edd2c0a952f65b04da16967dc026ae07a4688e8a4be9eedad07d`
