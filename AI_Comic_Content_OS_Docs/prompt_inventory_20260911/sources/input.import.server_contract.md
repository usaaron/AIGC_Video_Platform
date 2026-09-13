# 服务端显式原文总纲导入合同

编号：`input.import.server_contract`。状态：`conditional`。

来源：[backend/app/modules/script_engine/story_planning_service.py:619](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_planning_service.py:619)。符号：`STORY_BIBLE_IMPORT_INSTRUCTION`。

仅显式 import-draft 路由注入，并强制 preserve_source_document；未确定的高影响内容保持待定。

本页保留当前工作区原文，不是优化后的替代提示词，也不是某次模型调用的完整展开结果。

## 长文本阅读视图

按源码位置列出长字符串；静态文本按字符串值显示，花括号内动态表达式仅供识别，未执行。条件分支分别列出，不代表一次调用全部生效。短标签、拼装顺序和完整条件见后面的源码原文。

### 片段 1 · 源码第 621 行

````text
将用户原文作为第一事实来源，忠实映射到现有故事总纲字段；原文没有明确的高影响内容必须保留为“待定”，不得擅自补写人物身份、关系结果、秘密、死亡或结局。
````

### 片段 2 · 源码第 622 行

````text
原文必须保留在 imported_source_document 中。输出只能是 status=draft 的可编辑总纲，不能批准、跳过审核或进入分集正文。
````

## 源码原文

此部分按原始行提取，保留缩进、条件、占位变量和全部短字符串。

````python
STORY_BIBLE_IMPORT_INSTRUCTION = "\n".join((
    "这是一次作者原文导入整理，不是重新构思任务。",
    "将用户原文作为第一事实来源，忠实映射到现有故事总纲字段；原文没有明确的高影响内容必须保留为“待定”，不得擅自补写人物身份、关系结果、秘密、死亡或结局。",
    "原文必须保留在 imported_source_document 中。输出只能是 status=draft 的可编辑总纲，不能批准、跳过审核或进入分集正文。",
))
````

片段 SHA-256：`987fcf11cefce5ec93d5166faf90f24c998a172698c2110aad5c34e368c4fb36`
