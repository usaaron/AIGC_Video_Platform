# 02 大纲、剧情拆分与单集规划：现有提示词导览

本页是 2026-09-11 工作区代码的阅读整理，不是新提示词方案。下列“现有要求”来自正在使用或仍保留的源码；本次问答确认的创作方向单列在末尾，尚未改入程序。完整方法和字符串合同见同目录原文导出，提取清单为 `02-extract.json`。

常用原文入口：[总纲](sources/planning.bible_main.md)、[递归拆分](sources/planning.decomposition.md)、[分集主合同](sources/planning.episode_batch_contract.md)、[当前分块指令](sources/planning.episode_chunk.md)、[场景蓝图补全](sources/planning.scene_completion.md)、[剧情质量审阅](sources/planning.tree_quality.md)、[可选编导设计](sources/planning.dramatic_design.md)。

## 先看实际流程

| 环节 | 当前怎么工作 | 提示词位置与状态 |
| --- | --- | --- |
| 生成故事总纲 | 根据用户输入、标签、人物、参考材料、作者决策和知识条目生成可审核草稿 | [总纲主提示](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_planning_service.py:12547)，由 `generate_story_bible_draft` 调用 |
| 保留的旧交互式总纲合成 | 把已经逐步确认的框架与作者补充合成完整总纲；当前 Grill 主前端不走此接口 | [交互合成提示](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_planning_service.py:5353)，与普通总纲共用主要合同 |
| 第一层剧情部分 | 通常由已批准总纲的宽阶段在本地编译；不是再让模型写一遍整剧根节点 | [顶层生成入口](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_planning_service.py:5881)、[本地编译分支](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_planning_service.py:6621) |
| 后续递归拆分 | 大部分继续细分，直到可以逐集展开；各分支层数可不同 | [递归拆分提示](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_planning_service.py:11007)，当前主要拆分提示 |
| 单个剧情节点草稿 | 保留独立节点生成接口；前端主流程使用顶层生成和递归拆分 | [节点提示](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_planning_service.py:12326)，可调用的辅助入口 |
| 分集路线图 | 前端按连续分块生成并保存草稿检查点，直到覆盖整个叶节点 | [前端调用](/Users/simonriley/Downloads/docs/frontend/lib/story-planning-client.ts:1648) → [分块生成](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_planning_service.py:7490) → [整段合同](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_planning_service.py:11291) + [当前分块指令](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_planning_service.py:10610) |
| 单集路线图接口 | 一次只生成一集；服务内批量接口也会逐集调用它 | [单集提示](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_planning_service.py:11399)、[服务内批量入口](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_planning_service.py:7465)；不能把它描述为当前前端的主路径 |

顶层本地编译的条件是技术根节点、没有指定子节点数量、没有本轮作者指令；其他拆分进入模型提示。整个项目仅 8-12 集时，服务会直接从总纲建立一个叶节点。旧 `StoryStagePlan` 仍有数据模型、保存和读取能力，但本次核查没有发现对应的新建阶段提示方法；当前剧情部分规划采用 `StoryPlanNode` 剧情树。参见 [旧阶段模型](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/long_story_models.py:1338) 与 [保存方法](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/long_story_service.py:1792)。

## 1. 故事总纲：先稳定全剧方向

现有总纲不是每集详纲。它承担全剧承诺、核心人物和关系、主支线、宽阶段、高潮及结局方向，明确不写集数分配、逐集情节、场景、对白或镜头。后续递归剧情树与路线图再加细节。来源：[总纲主提示](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_planning_service.py:12582)。

共享格式合同规定十部分阅读顺序：故事定位、核心故事、核心人物、核心关系、核心剧情线、核心冲突、故事发展方向、高潮方向、结局方向、创作核心原则。它借用参考开发大纲的组织方式，而不是其具体情节。

> “参考《前期故事开发大纲》的开发母大纲结构，但不要复制参考文档中的人物、世界、情节或措辞。”

> “不要为了套模板强制凑成三条，也不要写成分集列表。”

来源：[参考格式合同](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_planning_service.py:653)。

总纲现有的主要创作边界：

- 原始用户输入与标签优先于所选创意方向；创意方向只能细化留白，不得覆盖原输入。
- 主要人物使用稳定身份登记表；不擅自改名、复用另一个角色姓名，不允许把某个人描述为自己的亲属或伴侣。
- 关系必须说清是哪种关系，不能用“关系复杂”“情感张力”等替代真实关系。
- 只登记素材中实际存在、能够持续推进的主线、支线和人物线，不为了数量硬凑支线。
- 每条支线需要自己的目标、阻力、推进方向、与主线的联系及收束方向；可以延期，但要留下原因、复核条件与后续事项。
- 有依据时形成 3-5 个不同的宽阶段，各写目标、门槛、局部回报与下一阶段压力；最终对抗和结局留在最后阶段。
- 已确认的世界规则、人物特质、关系方向、伏笔和结局约束后续规划。

来源：[主支线合同](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_planning_service.py:667)、[总纲具体规则](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_planning_service.py:12634)。

这里有一条对后续问答很关键的现有边界：身份、秘密、背叛、死亡、关系结果、主题结论和结局等高影响内容，如果作者未决定，不能仅为把总纲写完整而擅自决定。只有决策账本中 `ai_permission=decide` 的项目才允许模型代为决定；仅建议权限不能变成故事事实。

> “只有决策账本中 ai_permission=decide 的项目可以由模型代为决定；suggest_only 只能形成待作者确认的临时建议。”

来源：[总纲作者控制](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_planning_service.py:12627)。因此，当前程序允许结局方向保留“待定”，并不是每一份初始总纲都强制确定全部底牌。

总纲篇幅目标为 3,500-5,500 个中文字符，提示明确不要超过 7,000；要求压缩重复信息，不以堆字达到下限。它是提示中的创作密度目标，不等于数据结构字段上限。来源：[总纲密度合同](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_planning_service.py:679)。

## 2. 剧情树：从自然剧情边界逐层展开

每个剧情部分必须回答：这部分为何存在、从什么状态进入、发生哪些事件与选择、形成什么结果、离开时状态如何变化、为什么因此需要下一部分。子节点只增加属于本层的因果与变化，避免把总纲再说一遍。

> “Their episode ranges must be contiguous, ordered, cover the parent range exactly, and never overlap.”

> “Do not force equal depth across future branches.”

来源：[递归拆分规则](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_planning_service.py:11223)。

现有值得保留的规则：

- 拆分数量服从真正的叙事边界：新目标、阻力机制变化、不可逆选择、关系变化、揭示或兑现、局部冲突结束后带来的下一步。不能默认四段，也不能默认二段、三段。
- 除用户明确指定子节点数量外，模型在可行数量内判断；局部分析给出的数量只是起点，不是配额。
- 不默认均分集数、正文预算或树深。叙事负荷不同，允许分支数量与深度不同。
- 第一子节点的进入状态照抄父节点进入状态；后续子节点承接前一节点退出状态；末节点退出状态照抄父节点退出状态。
- 已批准的父级转折须原句分配给且只分配给一个子节点，不得弱化、合并、改写或漏掉。
- 不提前解决下一段或全剧结局，也不能重复上一段已解决的问题。
- 主线之外，已批准、当前需要承担职责的支线必须有真实状态变化；支线接近沉默阈值只提示复核，不为消除提醒自动编造事件。

来源：[递归拆分主提示](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_planning_service.py:11007)、[剧情树故事线合同](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_planning_service.py:691)。

规划深度已有明确约束：叶节点要交付足够完整的核心事件链和局部结算，让单集规划分配、展开已批准事件，而不是把缺失的核心剧情留给正文模型猜测。

> “Episode Plans downstream may distribute and stage approved events, but may not invent the missing core plot.”

> “For an episode-ready child, every content decision required for its episodes must be confirmed before script generation”

来源：[拆分深度要求](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_planning_service.py:11245)。未决内容可以在规划草稿中保留功能位置和“待定”；它不能在下游被静默改成确定事实。

现有数量与篇幅边界：

| 项目 | 当前值/要求 | 性质 |
| --- | --- | --- |
| 可逐集展开的叶节点 | 每部分 8-12 集 | 程序硬约束与提示共同要求 |
| 还要继续拆分的节点 | 至少 16 集 | 不能出现 1-7 或 13-15 集的子节点 |
| 每次子节点数 | 通常 2 到可行上限，最多 12；用户指定数量时必须可行 | 硬范围内按故事判断 |
| 顶层大部分篇幅 | 每节点 800-1,200 字 | 提示密度目标 |
| 中间部分篇幅 | 每节点 500-900 字 | 提示密度目标 |
| 叶节点篇幅 | 每节点 350-650 字 | 提示密度目标 |
| 事件/转折条目 | 主提示既出现“4-12 个事件或功能位置”，又要求紧凑输出时使用“4-6 个转折、4-6 个事件” | 两组原文并存，后续可统一措辞 |

来源：[树密度合同](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_planning_service.py:685)、[叶节点硬门槛](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_planning_service.py:11209)、[紧凑输出要求](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_planning_service.py:11253)、[模型集数常量](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/long_story_models.py:31)。这些数量是当前项目选择，不应直接解释成短剧创作的普遍规律。

## 3. 分集规划：给正文一份可执行的任务

每集交付标题、完整梗概、实际场地、进入状态、本集目标、核心冲突、主角决定、情绪变化、阶段阻力、局部回报、压力变化、退出状态、故事线职责、伏笔引用、下一集义务和制作负荷。提示要求 250-650 字的人类可读路线图，其中 `synopsis` 建议 120-320 字；不能只返回抽象字段和策划术语。

来源：[路线图密度](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_planning_service.py:697)、[可读字段合同](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_planning_service.py:717)、[批量主提示](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_planning_service.py:11291)。

现有分集创作要求主要是：

- 每集要有不同的因果贡献，至少推进一条已批准故事线。相邻集不能换词重复同一揭示、障碍或钩子功能。
- 已批准的转折与事件要完整分配，并在目标、冲突、决定、结果等字段中真正执行。不可漏掉后另造一条核心事件链补缺。
- 当前主路径要求每集至少出现一个不可逆或难以逆转、观众能看见或听见的变化；局部回报来自本集行动，不能只是未来承诺。
- 允许对抗、试探、追逐、关系误读与纠正、信息交换、付出代价、平行动作、延迟回收等不同方式；明确不强迫每集采用同一套“压力→行动→回报”顺序。
- 本段末集必须完成本段局部结算，再交出下一段压力，不能把该完成的高潮一直延期。
- 尚未决定或仅为建议的作者事项仍是可见规划阻塞项，不能被套路自动补成事实。
- 伏笔、未结钩子、人物与关系状态、下一集义务都应从已保存记忆连续继承。

来源：[批量规则](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_planning_service.py:11363)、[单集规则](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_planning_service.py:11534)。

### 结尾钩子

连载集默认 `serial_hook`，必须有可延续的结尾压力；若已批准故事方向要求季终或剧终，则使用正式收束，不能硬造钩子。钩子必须来自本集行动与退出状态，不能为悬念凭空加电话、来人、开门或身份揭示。

> “A serial_hook episode must provide a continuable cliffhanger; a finale must describe its formal resolution instead of manufacturing a hook.”

来源：[结尾模式规则](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_planning_service.py:11359)、[钩子职责](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_planning_service.py:11368)。这与本次确认的“短剧默认有追看动力”方向接近，但当前文本使用更强的 `cliffhanger` 表述。

### 可选编导设计

`dramatic_units` 用来说明已有事件中的触发处境、人物选择和可见后果，不是固定节拍表；列表为空合法，七项只是存储上限。`protagonist_cost` 只写已发生行动带来的个人代价，依据不足可为 `null`，不能为了填字段新增死亡、背叛或秘密。

> “同一单位可以跨场，一场也可以容纳多个单位；不逐场凑数，也不把每个单位写成小反转。”

来源：[可选编导设计合同](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_planning_service.py:723)。这条与“不把剧情公式化”的目标直接相容。

### 场景执行蓝图

当前分集主提示要求返回完整 `scene_execution_plan`。每场需要具体目标、阻力、信息变化、选择或代价、观众可见证据、不可改变事实、可见动作、转折、对白目的、对白和镜头数量、退出状态。目的已在原文中写明：让后续正文模型不再推测缺失的场景决策。

> “The scene_execution_plan is the execution contract that a fast screenplay model will receive, so do not leave it empty and do not make the screenplay model infer missing scene decisions.”

来源：[场景蓝图要求](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_planning_service.py:11378)。生产模型缺失或部分缺失蓝图时，服务另外调用规划模型只补这一项；补全失败会阻断。固定、模拟或测试适配器保留旧的本地兜底路径。来源：[补全方法](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_planning_service.py:8516)、[旧适配器判断](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_planning_service.py:8676)。

这里存在一处现有文本差异：共享篇幅合同仍写“场景执行蓝图由服务根据已验证字段和制作预算本地派生”，但当前主提示和生产代码要求模型生成或补全。整理保留两者，后续应讨论并统一，不能把旧句子当作当前完整行为。

### 制作数量

每集当前要求 75-115 秒、1-5 场、25-35 行对白、15-20 个镜头单位，整剧不少于 100 分钟。提示要求按本集实际戏剧工作量独立分配，不能每集复制同样数值，也不能为了凑数拆场或填充。这里的镜头单位属于规划负荷，不等于已经产出了最终分镜。

来源：[共享制作常量](/Users/simonriley/Downloads/docs/backend/app/script_delivery_contract.py:186)、[负荷分配提示](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_planning_service.py:11377)。

## 4. 修改、审阅和修复

| 类型 | 现有要求 | 来源 |
| --- | --- | --- |
| 总纲局部修改/整篇重写 | 局部修改只动涉及字段；重写可以重新组织，但保留硬项目事实、身份、引用和明确用户边界。选中文本变化时同步处理有关因果、人物线和结局义务 | [总纲修改](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_planning_service.py:5608) |
| 剧情节点修改 | 保留集数、父子关系、前后交接、引用；只改本节点相关叙事。不能将未决决定擅自落实；子孙节点重建由应用处理 | [节点修改](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_planning_service.py:6446) |
| 单集规划修改 | 保留集号、身份引用、已分配事件及前后义务；修改事件要同步梗概、场地、标题及场景蓝图 | [分集修改](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_planning_service.py:8130) |
| 剧情树质量审阅 | 只审不改，检查重复、人物选择因果、关系变化、升级、伏笔、结局方向和状态连续；只把实质影响分集/正文的问题判为需修改 | [审阅提示](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_planning_service.py:7158) |
| 总纲格式/语言/身份修复 | 修报错字段，保留故事意思和身份，不新增剧情；语言修复可以是逐字段补丁 | [总纲修复组](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_planning_service.py:12758) |
| 递归拆分修复 | 修容器、单个残缺子节点或连续性失败；保留有效内容、集数、引用与父级转折。大响应失败时改为逐子节点生成 | [通用/子节点修复](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_planning_service.py:10429)、[拆分语义修复](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_planning_service.py:11272)、[逐子节点恢复](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_planning_service.py:9303) |
| 分集分块/格式恢复 | 缩小本次返回的集数，保持整段剧情、结算和交接不变；本次数量指令覆盖原整段数量指令 | [分块覆盖指令](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_planning_service.py:10610) |
| 单集重复修复 | 单集接口发现重复时尝试修局部回报和结尾压力，不改事件链和结果；当前分块主路径对重复检查只记录警告 | [单集重复修复](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_planning_service.py:11870)、[分块接受警告](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_planning_service.py:7627) |

审阅使用全部叶节点索引和代表节点详审，并不等于逐字审核每个节点；程序另做范围覆盖等确定性检查。来源：[审阅执行](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_planning_service.py:6858)。

两条保留方法 `_build_segmented_episode_plan_repair_prompt`、`_build_episode_plan_repair_prompt` 在本次仓库生产代码搜索中只有定义，未见调用。它们仍收入原文清单，标为“保留，未见生产调用”，避免遗漏，但不算当前主流程必经步骤。

## 5. 共用的外部边界来自哪里

市场合同来自 [market_profile.py](/Users/simonriley/Downloads/docs/backend/app/modules/content_spec/market_profile.py:36)，经 [市场文本拼装器](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_planning_service.py:4343) 注入：大陆路径使用简体中文和大陆文化背景；海外路径的总纲、剧情树、路线图、标签与审阅仍为简体中文，方便中文创作者审核，文化背景则遵循海外英语语境且不默认具体国家。海外正文的动作和表演意图使用中文，口语对白使用自然英语；不能将“海外”误读成所有规划都用英语。

知识条目由策略选择的知识包动态注入，并按阶段类别选取。拼装器明确写：`Use these principles as bounded guidance, not rigid plot formulas`，还会附上每条知识的应用条件、限制和反例。具体条目会随配置与输入变化，不是一份永久固定的总提示。来源：[知识注入](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_planning_service.py:12982)。

参考材料按用户声明用途使用：格式模板只取文档结构；风格参考只取节奏语气；故事参考服从当前用户要求；世界设定和人物参考作为对应连续性事实。参考文字是来源材料，不是系统指令。来源：[材料用途合同](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_planning_service.py:12697)。

## 6. 留给后续一问一答的具体位置

以下是整理后识别的讨论入口，不是已经通过的新规则，也未据此修改提示：

1. **大纲与规划如何共同达到足够深度。** 用户新确认的目标是让两层协同把每集规划写深入，减少正文返工。现有分层和场景执行蓝图已经支持这个方向；仍需确定“结局与悬念真相在何时必须确认”，以及允许哪种待定内容停留在草稿中。
2. **留白的自主创作权限。** 本次对话允许 AI 补全未指定的人物和剧情；现有规则对高影响事项要求逐项有 `decide` 权限。可讨论授权如何表达，而不是直接删除已有作者保护。
3. **每集观看价值的范围。** 本次认可情绪体验、人物理解等也能产生观看价值；现有分集文字更强，要求“不可逆或难逆的可观察变化”“本集局部结果”。这两者未完全等同，后续需要具体辨析。
4. **一致性冲突如何交还用户。** 本次确定冲突要提示用户选择；规划层目前包含自动格式修复、语义修复和质量修复，节点辅助入口还写着作者指令与硬约束冲突时保留硬约束。需要区分哪些修复只是格式纠错，哪些已经改变作者内容，再逐项确认。
5. **同一要求的文字是否统一。** 例如路线图密度主合同是 250-650 字，单集修复提示仍写 250-450；场景蓝图“本地派生”和“模型生成”同时出现。这是现有文本一致性问题，可在约定边界后单独处理。

保留现有内容的依据很充分：用户原意优先、自然剧情拆分、主支线职责、完整因果交接、避免为了钩子凭空编造、不给每集强套固定循环、可选编导设计、把场景决策前置，都已经写在原提示或当前执行链中。
