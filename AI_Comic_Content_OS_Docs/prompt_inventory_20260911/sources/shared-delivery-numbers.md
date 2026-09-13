# 被提示词引用的当前时长与数量常量

编号：`shared-delivery-numbers`。状态：`shared`。

来源：[backend/app/script_delivery_contract.py:186](/Users/simonriley/Downloads/docs/backend/app/script_delivery_contract.py:186)。符号：`指定原文片段`。

这是交付约束常量，不是独立提示词。原样记录供后续讨论，未调整。

本页保留当前工作区原文，不是优化后的替代提示词，也不是某次模型调用的完整展开结果。

## 源码原文

此部分按原始行提取，保留缩进、条件、占位变量和全部短字符串。

````python
EPISODE_RUNTIME_MIN_SECONDS = 75
EPISODE_RUNTIME_MAX_SECONDS = 115
EPISODE_RUNTIME_PREFERRED_MIN_SECONDS = 90
EPISODE_RUNTIME_PREFERRED_MAX_SECONDS = 105
EPISODE_SCENE_MIN = 1
EPISODE_SCENE_MAX = 5
EPISODE_DIALOGUE_LINE_MIN = 25
EPISODE_DIALOGUE_LINE_MAX = 35
EPISODE_SHOT_UNIT_MIN = 15
EPISODE_SHOT_UNIT_MAX = 20
SERIES_RUNTIME_MIN_MINUTES = 100
PARTNER_SCREENPLAY_FORMAT_VERSION = "partner_screenplay.v1"
PARTNER_SCREENPLAY_CONTENT_TEMPLATE_VERSION = "partner_screenplay.content_complete.v1"
````

片段 SHA-256：`b4339a2ef632f53f5ba0204358fe1b1d7eaec3e3b2f7b549700d417f1f33052b`
