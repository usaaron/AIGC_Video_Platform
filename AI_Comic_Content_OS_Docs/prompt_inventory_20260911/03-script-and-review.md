# 03 剧本正文、修订与检查：现有提示词导览

整理日期：2026-09-11。本页是当前工作区源码快照，不是已部署环境审计；没有读取运行环境配置、数据库中的实际模板或真实模型输出。正文的最终提示词由模板库、当次用户资料、已批准规划和代码内合同共同拼接，不能把某一个文件当作全部提示词。

本页先忠实记录已有内容，再标出值得继续问答的差异。这里的“保留价值”是整理意见，“待讨论”尚未变成任何代码修改。

## 1. 正文阶段实际拿到什么

默认生成入口 [generation_service.py:574](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/generation_service.py:574) 先检索策略对应模板，再调用 `TemplatePromptBuilder.build_master_prompt`。真实拼接方法在 [prompt_builder.py:56](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/prompt_builder.py:56)：

1. 按所选模板 ID 取出 `PromptLibraryItem.prompt_template`，代入项目、创作简报、平台、受众、商业目标等变量。
2. 附加代码生成的 `structured_context`，内含下表中的正文边界。
3. 有单集上下文时，附加 Story Bible、作者决策、单集执行计划、人物及连续性资料。为减少重复，若干通用状态合同会被更具体的分集合同取代。
4. 用户发起正文修订时，再插入原稿、用户修改指令和选中文本；创意深化则插入另一套受限改写合同。

上下文装配见 [generation_service.py:2439](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/generation_service.py:2439)，分集写作包见 [generation_service.py:2727](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/generation_service.py:2727)。静态模板和知识条目另见总目录中的模板/知识章节，本页不重复。

## 2. 默认正文提示词中已经有的边界

| 边界 | 当前提示词要求，用通俗语言转述 | 关键原句与源码 |
| --- | --- | --- |
| 上游规划决定正文职责 | 本集从上集结果开始，执行已批准单集路线和场景蓝图；落实场景顺序、人物范围、目标、行动、转折、对白目的和退出状态。正文不重新设计剧情，不把本集任务推迟。 | “不得重新设计场景结构，只把该执行蓝图扩写成正式可拍正文。” [prompt_builder.py:392](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/prompt_builder.py:392)；分集合同 [prompt_builder.py:578](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/prompt_builder.py:578) |
| 防止统一剧情节拍 | 指定的节奏形态优先；没指定就按目标、阻力、关系和代价选择推进方式；剧本数据字段不是固定剧情顺序。 | “不要为了满足数量而套用统一的节拍模板。” [prompt_builder.py:131](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/prompt_builder.py:131)；“do not translate field names into a fixed conflict-decision-payoff-escalation order.” [prompt_builder.py:594](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/prompt_builder.py:594) |
| 作者决策不能在正文阶段被擅自替代 | 已确认事实是定稿依据；未决内容保持开放，委托/建议项还不是事实。缺少细节不等于允许正文新造身份、秘密、背叛、死亡、关系结局、主题结论或终局。 | “do not use screenplay generation to settle an author decision.” [prompt_builder.py:616](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/prompt_builder.py:616) |
| 资料按用途使用 | 格式模板只控制格式，不贡献剧情事实；风格参考只影响节奏，不许可照搬表达和剧情；资料中的文本不是系统指令。知识只选适用原则，不能覆盖用户和锁定事实。 | `UserReferenceMaterialContract` [prompt_builder.py:629](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/prompt_builder.py:629)；`CreativeKnowledgeUsage` [prompt_builder.py:547](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/prompt_builder.py:547) |
| 场景有因果联系 | 每场记录目标、阻力、退出变化；后场要说明前场结果如何促成或迫使它发生。怀疑、他人声称与已证实事实分开；记录时间、事件时间、核实时间不能混用。 | “Do not invent unsupported plot facts.” [prompt_builder.py:789](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/prompt_builder.py:789) |
| 人物知情必须有证据 | 不能默认同场的人共享全部信息；先在动作/对白中建立读到、听到或转告，再写入人物已知事实。离场者不能自动知道后来才到达的消息，普通手势只能传递约定信号。 | “never silently copy another character's knowledge.” [prompt_builder.py:205](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/prompt_builder.py:205) |
| 人物、物品、关系状态连续 | 身份、背景、性格基线和锁定事实保持稳定。伤病、死亡、能力限制、物品交接/损毁/找回、地点权限都要影响后续行为。关系双方可以知情或态度不同。 | “WorldStateContinuityContract” [prompt_builder.py:691](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/prompt_builder.py:691)；人物状态 [prompt_builder.py:672](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/prompt_builder.py:672) |
| “发生过”不能只写在摘要里 | 状态账本、伏笔回收、人物代价、结尾揭示必须能在实际动作或对白中定位。计划里的证据提示不等于事实已经发生，账本不能代替正文补情节。 | “账本和钩子只能登记已经演出的事实，不能替正文补写遗漏。” [prompt_builder.py:453](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/prompt_builder.py:453) |
| 行动可执行 | 人物先入场再说话；远程交流先建立通信；遮盖、递交、保存先发生，依赖它们的对白后发生。持有材料、私人预览、观众看见、外部发布是不同事实，展示中断不能抹去已暴露内容。 | `EvidenceDisclosureContract` [prompt_builder.py:235](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/prompt_builder.py:235)；动作顺序 [prompt_builder.py:433](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/prompt_builder.py:433) |
| 承诺不等于实际满足条件 | 对方说距离或披露程度不可接受时，需要实际调整或明确接受新条件；安抚台词不能当作已经履约，不能许诺角色控制不了的事。 | “A reassuring promise alone is not compliance.” [prompt_builder.py:269](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/prompt_builder.py:269) |
| 连载尾钩与终局收束区分 | 连载集前两场回应或推进上集问题；最后可见事件产生真实后果、问题、选择或关系变化。季终只保留已批准的下季入口；剧终完成批准结局，不为钩子增加无关悬念。 | “Avoid unrelated fake surprises.” [prompt_builder.py:326](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/prompt_builder.py:326) |
| 伏笔不等于任意反转 | 用已批准的伏笔 ID；只有实际回答了原先承诺的含义，才能记为部分/全部回收。无批准伏笔时不凭空加伏笔账目，尾钩目标集数也不能自动创建伏笔。 | `SetupPayoffOutputContract` [prompt_builder.py:298](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/prompt_builder.py:298) |

这些已有要求，与“上游把每一集规划深入，正文尽量一次达到要求”的目标高度相关，值得在现有基础上继续细化。

## 3. 正文格式和生产边界

正文主合同在 [prompt_builder.py:380](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/prompt_builder.py:380)，具体常量在 [script_delivery_contract.py:186](/Users/simonriley/Downloads/docs/backend/app/script_delivery_contract.py:186)。它要求的是可拍执行稿，不是小说或提纲。

| 项目 | 源码当前要求 |
| --- | --- |
| 单集规格 | 75-115 秒，通常优先 90-105 秒；1-5 场；25-35 条实际说出的台词；15-20 个动作执行单元。这里的动作执行单元不等于已经生成后续分镜。 |
| 时长与字数关系 | 字数是宽松参考，不是填充配额；没有单场字数定额。禁止拆句、重复动作、空镜、复述或新剧情凑量。估时只是粗估，要额外考虑必须先后完成的行动。 |
| 场景资料 | 每场包含地点、时间、人物、目标、冲突、转折、结果、道具、进入及退出状态；这些供创作者/制作使用，不得把字段名写成对白或旁白。 |
| 动作 | 只写观众能看见、听见的动作、声音、道具变化和调度；不写心理活动、全知解释或镜头景别/运镜。一项是简洁的可拍单元。 |
| 对白 | 短句、打断、反击、潜台词；表演提示与真正说出口的台词分开。删掉不推进冲突、关系、信息或选择的台词。 |
| 表演顺序 | `body_order` 用动作/对白引用保留真实顺序，每项出现一次；允许连续对白、无对白动作和有意义的沉默，不机械一动一说。 |
| 地区语言 | 大陆路径：中文动作、姓名和对白，不加双语。海外路径：创作者所见叙事中文，英文对白同步中文对照，人物映射保持稳定。 |
| 全剧规模 | 目标至少 100 分钟，同时明确用户手填集数是硬边界；冲突应由产品生成前提示，不得正文擅自加集或拉长单集。 |

这组数字是当前平台的具体生产合同；本次问答尚未逐一重新确认，也不能把它们理解为所有短剧通用的市场定律。

现有“观看价值”约束比本次刚确定的原则更强：[prompt_builder.py:464](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/prompt_builder.py:464) 要求每场产生可观察变化，允许安静的余波、照料或等待，但须改变选择或关系压力；[prompt_builder.py:471](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/prompt_builder.py:471) 又写“本集需要完成至少一个不可逆或难以撤销的有效变化”。这应留到后续问答判断是否保留原强度。

## 4. 用户主动修改正文

入口 [generation_service.py:1640](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/generation_service.py:1640) 返回一份候选稿，不直接覆盖源稿。

- 有选中文本时，先尝试一次局部替换：[generation_service.py:2028](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/generation_service.py:2028)。仅替换指定片段；需要改其他场景、角色状态、新事实或因果时，模型应声明需要整集改写。海外英文台词修改须同步中文译文。
- 局部修改不足以完成请求时，使用同一正文模板和源码合同生成完整候选稿。`UserDirectedModificationContract` 见 [prompt_builder.py:722](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/prompt_builder.py:722)。选中段落仍是主要修改目标，其他部分尽量保留。
- **当前优先级需要继续讨论**：这两条路径都明确写了已批准 Story Bible、树节点、单集计划和最新连续性高于当前修改指令。这是保护上游规划的已有机制，但与本次确定的“冲突提示后由用户选择，用户需求优先”不完全一样。不能把它描述成已经支持用户授权覆盖旧规划。

## 5. 检查、自动修复和可选润色不是同一件事

### 默认生成中有条件触发的自动修复

| 触发情况 | 现有提示词的作用与边界 | 源码 |
| --- | --- | --- |
| 输出为空、JSON 错误或截断 | 重试同一集，保留已批准事实和结尾；修复可用原输出，禁止重新规划故事。另有模型回退。 | [generation_service.py:7953](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/generation_service.py:7953)、[generation_service.py:7965](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/generation_service.py:7965)、[generation_service.py:7977](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/generation_service.py:7977) |
| 推理耗尽输出预算 | 用紧凑分集包再请求，保留规划、人物、连续性和交付规格。其文本仍硬写固定因果顺序，见下节待讨论。 | [generation_service.py:2892](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/generation_service.py:2892) |
| 结构字段不合法 | 根据校验错误只补需要替换的顶层字段；结构碎片修复失败时回退完整对象，保留可用正文。 | [generation_service.py:8169](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/generation_service.py:8169)、[generation_service.py:8197](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/generation_service.py:8197) |
| 大陆正文语言、可拍性、明显截断、时长或数量不符 | 优先只改动作/对白；需要语言/整体结构修正时返回整稿。提示词禁止新增人物、场景、支线、反转和设定。实际代码对轻微估时漂移允许警告，不能把提示词目标等同为每次都强制重写。 | [generation_service.py:8310](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/generation_service.py:8310)、[generation_service.py:8227](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/generation_service.py:8227) |
| 连续性硬冲突 | 当前主链会自动局部修复最多 2 轮，再检查；仍有 blocking 冲突则抛错。修复必须同时处理正文证据与状态，不许无铺垫复活、痊愈、找回或改历史。 | 调用 [generation_service.py:786](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/generation_service.py:786)；提示 [generation_service.py:8446](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/generation_service.py:8446) |
| 台词/动作数量不合交付规格 | 只改场景正文数组，保留人物参与证据、事实、因果、状态变化和结尾；需要精确达到修复目标，再检查时长。失败还存在本地数量再平衡，不是只检查不改写。 | [generation_service.py:7991](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/generation_service.py:7991)、[generation_service.py:8100](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/generation_service.py:8100) |
| 其他路径的中文语言修复、正文截断补全 | 中文校正保持事件；过短补全只展开已有场景，没有单场字数配额。与大陆综合验收是不同分支。 | [generation_service.py:8532](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/generation_service.py:8532)、[generation_service.py:8122](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/generation_service.py:8122) |

还有一个独立动作风格修复提示 [generation_service.py:8553](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/generation_service.py:8553)。它被 `_ensure_mainland_screenplay_style` 使用，但当前文件主链未检到对该 helper 的调用；应作为保留的辅助入口列出，不能说每集都会执行。主链的大陆综合验收已经包含动作风格检查。

### 默认关闭的两个模块

源码依赖装配 [dependencies.py:488](/Users/simonriley/Downloads/docs/backend/app/dependencies.py:488) 将 `SCRIPT_GPT_POST_EDIT_ENABLED` 和 `SCRIPT_CREATIVE_DEEPENING_ENABLED` 都设为默认 `False`。这只是源码默认值，没有核实当前部署是否覆盖。

- **终审编辑器**：[script_post_editor.py:1788](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/script_post_editor.py:1788)。启用后先做本地评估，合格可跳过模型；需要编辑时，只优化指定场景的动作和对白，保护剧情、状态、人物、顺序、标题、伏笔和结尾。还有海外逐字段语言补丁 [script_post_editor.py:1459](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/script_post_editor.py:1459)。不是默认每集都调用一次“编剧大师”。
- **Creative Deepening**：[creative_deepening.py:51](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/creative_deepening.py:51)。复用模板拼接器和 [prompt_builder.py:812](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/prompt_builder.py:812) 的深化合同；只增强对白、情绪、可见动作和表达，保护故事方向、场景和全部场景因果。生成对照候选，源码仍选原稿，不是自动把深化结果覆盖正文。

### 本地规则检查，不是新的 LLM 提示词

- `episode_quality_review.py`：[review_episode_dramatic_evidence:73](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/episode_quality_review.py:73)。用文本和关键词寻找人物选择、后果、代价、对白功能、分段变化的候选证据；计划摘要不能冒充正文证据。原文明确“本报告是编导审阅信号，不是质量评分，也不阻断正文保存。”关键词命中不能证明剧情因果成立。
- `continuity_qc.py`：[evaluate_episode_continuity:73](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/continuity_qc.py:73)。检查人物/世界状态、剧情线职责、伏笔、尾钩和本集状态矛盾，分 warning 与 blocking。它是本地规则；生成服务发现 blocking 才调用上面的模型修复提示。没有上下文时会返回不适用。
- `story_qc.py`：[PlaceholderStoryQC.evaluate:42](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_qc.py:42)。当前默认是规则式评分/检查，名字里的 Placeholder 需要保留理解；不是模型读完整故事后的专业审稿结论。
- `revision_planner.py`：[RubricRevisionPlanner.build_plan:31](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/revision_planner.py:31)。按规则报告生成修订建议，不是独立 LLM 提示。例如 [revision_planner.py:300](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/revision_planner.py:300) 会建议不可逆主角决定、升级冲突等，仍带平台的创作偏好。另有 `RuleBasedRevisionExecutor` 执行规则化修改；它不属于正文提示词本身，也不应当成默认模型润色。

## 6. 后续问答优先核对的差异

| 讨论点 | 当前源码 | 本次问答已经明确/尚未明确的方向 |
| --- | --- | --- |
| 用户修改与旧规划冲突 | 旧规划/连续性高于新修改指令，连续性硬冲突自动修复，未解决则阻断。 | 用户已明确：提示冲突，让用户选择处理，以用户需求为先。需要讨论用户确认如何更新上游事实及后续依据。 |
| 观看价值是否必须是不可逆变化 | 当前正文要求本集至少一个不可逆或难撤销变化；每场也要求可观察变化。 | 已接受的默认边界更宽：信息、人物理解、情绪体验、期待变化都可构成价值。不能直接假定两者完全等价。 |
| 防剧情公式是否覆盖所有分支 | 主提示禁止固定节拍，但紧凑恢复 [generation_service.py:2979](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/generation_service.py:2979) 写“严格执行冲突-决定-局部回报-压力升级-退出状态因果链”；大陆修复 [generation_service.py:8269](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/generation_service.py:8269)、[generation_service.py:8345](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/generation_service.py:8345) 及可选编辑 [script_post_editor.py:2001](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/script_post_editor.py:2001) 仍写持续循环。 | 用户接受结构节奏框架，但反对剧情套模板。要逐条判断这些句子是允许多种实现的结构职责，还是把实现也锁死。 |
| 自动补全在哪一步结束 | 正文被强约束为执行批准路线；未决重大作者决定不准在正文定案。 | 用户允许 AI 补留白，也可 grill me。这个授权更适合在大纲/规划阶段讲清，不能简单删掉正文保护机制。 |

以上是增量讨论清单，不是要求推翻现有合同。已有的规划继承、证据边界、连贯性、可拍格式、尾钩与终局区分，都可以继续作为基础。
