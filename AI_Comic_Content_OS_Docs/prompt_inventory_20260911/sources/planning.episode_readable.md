# 分集梗概与实际场地合同

编号：`planning.episode_readable`。状态：`active_shared`。

来源：[backend/app/modules/script_engine/story_planning_service.py:717](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_planning_service.py:717)。符号：`EPISODE_HUMAN_READABLE_FIELDS_CONTRACT`。

可读因果梗概、具体场地与批准角色引用。

本页保留当前工作区原文，不是优化后的替代提示词，也不是某次模型调用的完整展开结果。

## 长文本阅读视图

按源码位置列出长字符串；静态文本按字符串值显示，花括号内动态表达式仅供识别，未执行。条件分支分别列出，不代表一次调用全部生效。短标签、拼装顺序和完整条件见后面的源码原文。

### 片段 1 · 源码第 717 行

````text
【分集可读字段】
- `synopsis` 是本集完整、连续、可直接阅读的剧情梗概，建议 120-320 个中文字符；必须交代主要人物在具体场地中的行动、冲突、选择和状态变化，不写镜头脚本或对白。
- `locations` 是本集实际使用的 1-4 个具体场地名称，例如“现代甜品店前厅”“后厨”；不要填写“核心行动地点”之类占位词。
- `character_refs` 仍只填写已批准的角色 ID；界面会根据项目角色资料显示姓名和性别，不能在该数组里混入性别或新角色。
- synopsis、locations、episode_title 与现有 episode_goal 等字段必须描述同一组事件，不能为了补格式另造剧情。
````

## 源码原文

此部分按原始行提取，保留缩进、条件、占位变量和全部短字符串。

````python
EPISODE_HUMAN_READABLE_FIELDS_CONTRACT = """【分集可读字段】
- `synopsis` 是本集完整、连续、可直接阅读的剧情梗概，建议 120-320 个中文字符；必须交代主要人物在具体场地中的行动、冲突、选择和状态变化，不写镜头脚本或对白。
- `locations` 是本集实际使用的 1-4 个具体场地名称，例如“现代甜品店前厅”“后厨”；不要填写“核心行动地点”之类占位词。
- `character_refs` 仍只填写已批准的角色 ID；界面会根据项目角色资料显示姓名和性别，不能在该数组里混入性别或新角色。
- synopsis、locations、episode_title 与现有 episode_goal 等字段必须描述同一组事件，不能为了补格式另造剧情。"""
````

片段 SHA-256：`1f2b3865af03c5196cf489d1e92ddaf86e3a7f0bd35c7075532df1b111a72e4a`
