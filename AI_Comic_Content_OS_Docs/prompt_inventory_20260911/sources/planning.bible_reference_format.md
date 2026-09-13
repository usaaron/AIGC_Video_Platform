# 故事总纲参考组织结构

编号：`planning.bible_reference_format`。状态：`active_shared`。

来源：[backend/app/modules/script_engine/story_planning_service.py:653](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_planning_service.py:653)。符号：`STORY_BIBLE_REFERENCE_FORMAT_CONTRACT`。

总纲生成、交互合成和修改共同注入；十部分结构参考，不复制具体剧情。

本页保留当前工作区原文，不是优化后的替代提示词，也不是某次模型调用的完整展开结果。

## 长文本阅读视图

按源码位置列出长字符串；静态文本按字符串值显示，花括号内动态表达式仅供识别，未执行。条件分支分别列出，不代表一次调用全部生效。短标签、拼装顺序和完整条件见后面的源码原文。

### 片段 1 · 源码第 653 行

````text
参考《前期故事开发大纲》的开发母大纲结构，但不要复制参考文档中的人物、世界、情节或措辞。
总纲必须按以下阅读顺序组织其信息（通过现有 JSON 字段承载，不新增顶层字段）：
一、故事定位：作品类型/核心看点/整剧承诺，映射 project_title、theme、core_premise。
二、核心故事：用连续的整剧叙述说明主角从起点到结局的主要变化，映射 core_premise、series_goal、central_conflict、ending_direction。
三、核心人物：每个关键人物的身份、功能、起点和目标状态，映射 character_registry、character_arc_targets。
四、核心关系：只写会改变主线因果的关系及其方向，映射 relationships。
五、核心剧情线：整理素材中已经存在且能够持续发展的主线、支线和人物线，映射 story_lines；不要为了套模板强制凑成三条，也不要写成分集列表。
六、核心冲突：同时交代外部压力的升级顺序和主角的内部问题，映射 central_conflict、character_arc_targets、escalation_stages。
七、故事发展方向：明确前期/中段/后段各自的叙事重点，映射 escalation_stages 及其 stage_goal、stage_payoff、escalation_to_next；只写宽阶段，不写集数和场景。
八、高潮方向：说明全剧最终反转、核心对抗和主角主动选择，映射最后一个 escalation_stage。
九、结局方向：整理作者已经明确的收束；未决定的危机、关系、身份或价值结果继续标记待定，映射 ending_direction、story_lines.planned_resolution。
十、创作核心原则：锁定主角行动主体、人物能力的结构作用、爱情/阴谋/危机的边界和不可违背的主题问题，映射 locked_facts、major_setup_payoff_refs、avoid_patterns、world_rules。
每一部分都要服务同一个核心问题；不要把“故事定位”写成营销文案，也不要把“核心故事”拆成章节梗概。
````

## 源码原文

此部分按原始行提取，保留缩进、条件、占位变量和全部短字符串。

````python
STORY_BIBLE_REFERENCE_FORMAT_CONTRACT = """参考《前期故事开发大纲》的开发母大纲结构，但不要复制参考文档中的人物、世界、情节或措辞。
总纲必须按以下阅读顺序组织其信息（通过现有 JSON 字段承载，不新增顶层字段）：
一、故事定位：作品类型/核心看点/整剧承诺，映射 project_title、theme、core_premise。
二、核心故事：用连续的整剧叙述说明主角从起点到结局的主要变化，映射 core_premise、series_goal、central_conflict、ending_direction。
三、核心人物：每个关键人物的身份、功能、起点和目标状态，映射 character_registry、character_arc_targets。
四、核心关系：只写会改变主线因果的关系及其方向，映射 relationships。
五、核心剧情线：整理素材中已经存在且能够持续发展的主线、支线和人物线，映射 story_lines；不要为了套模板强制凑成三条，也不要写成分集列表。
六、核心冲突：同时交代外部压力的升级顺序和主角的内部问题，映射 central_conflict、character_arc_targets、escalation_stages。
七、故事发展方向：明确前期/中段/后段各自的叙事重点，映射 escalation_stages 及其 stage_goal、stage_payoff、escalation_to_next；只写宽阶段，不写集数和场景。
八、高潮方向：说明全剧最终反转、核心对抗和主角主动选择，映射最后一个 escalation_stage。
九、结局方向：整理作者已经明确的收束；未决定的危机、关系、身份或价值结果继续标记待定，映射 ending_direction、story_lines.planned_resolution。
十、创作核心原则：锁定主角行动主体、人物能力的结构作用、爱情/阴谋/危机的边界和不可违背的主题问题，映射 locked_facts、major_setup_payoff_refs、avoid_patterns、world_rules。
每一部分都要服务同一个核心问题；不要把“故事定位”写成营销文案，也不要把“核心故事”拆成章节梗概。"""
````

片段 SHA-256：`8620f28dd76cc7c04cdd204395c10d915932cc4f82ba3b8252be6816b1b6f02b`
