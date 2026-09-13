# 21 Current Status

## Purpose

本文件是“当前已经实现什么、哪些仍是实验性、哪些尚未实现”的唯一状态来源。它不维护路线图、运行教程或详细 API 字段。

状态更新时间：2026-09-11（Asia/Shanghai）。

当前产品核心：生成优质长剧本母本，默认中国大陆中文路径。创建页开放 8–20 万字正文档位，默认 14 万字；40–50 万字属于历史产品设想，60 万字属于隔离容量研究目标。当前“支持”指已建立长篇契约、递归规划、内容驱动的 episode-ready 叶节点、单集线路图、正文参考、持久化与有界生成路径；不代表整部最大档作品已经完成真实创意质量、一致性、连续性、速度和恢复验收。

用户明确的优先级（2026-09-08）：创意质量、一致性、连续性第一，生成速度也很重要；不考虑 token 消耗。模型、上下文、编辑和验证方案以这些目标取舍，不为节省 token 或费用降低创作质量、压缩必要信息或省略必要校验。速度以达到可用质量的端到端耗时及稳定性衡量。token 与金额仅可作为已有运行记录保留，不是优化目标、验收门槛或推进阻塞项；下方历史记录中的成本验收要求不再适用于当前工作。

用户进一步明确：优先通过生成前的详细、准确提示和完整上下文让模型一次写对，减少事后检查与返工。把已知错误转化为输入事实、人物边界、状态更新语义和可执行顺序的明确约束；不以增加泛化模型审稿轮次为默认方案。每集保留快速的结构、引用、持久化及恢复检查，仅对具体失败定向修复。完整创意与连续性审阅用于阶段验收和有依据的抽样，不默认逐集反复执行；开发测试也仅随实际变更和风险运行。

用户追加要求：整体检查并优化记忆系统，支撑最多 20 万字。历史原文和知识保留与本集召回分开处理，不能把最近 30/50 条截断当作完整长篇记忆。此次容量、来源与状态重建验证见 [41_LONG_STORY_MEMORY_AND_PROMPT_INPUT.md](41_LONG_STORY_MEMORY_AND_PROMPT_INPUT.md)；合成容量测试不代替整部作品的真实创意质量验收。

## Preproduction Plan Integration

2026-09-08 把“查看 Liblib 页面内容”对话纳入 [44_PREPRODUCTION_STORYBOARD_PLAN.md](44_PREPRODUCTION_STORYBOARD_PLAN.md) 和 D-027，当时仅完成文档整合。2026-09-11 已新增第一阶段文字分镜运行代码，范围与证据见 [55_LIBLIB_STORYBOARD_IMPLEMENTATION.md](55_LIBLIB_STORYBOARD_IMPLEMENTATION.md)。

- 目标范围：正文之后的文字分镜、视觉方案、资产设计、图片／视频提示词、检查及版本化前期包；描述由系统生成，用户可修改和确认，实际媒体生成由下游团队完成。
- 已有可复用基础：场景清单、动作对白顺序、正文 Artifact、派生连续性记录、制作索引与导出。它们不等于已完成独立分镜或生产资产库。
- 本轮实现：左侧“分镜”入口、主动按集/场编排、本集视觉方向与场景/镜头文字设计、直接编辑/拆合/排序/整镜锁定、场级 AI 候选、正文来源变化标记、独立版本存储与草稿导出。DeepSeek V4 Pro 单场真实调用通过；权限开放后已完成最新项目库与分镜页面的桌面/手机浏览器验收，包括来源变化、候选、锁定、历史、冲突恢复与实际下载。前端全量 `408 passed`，生产构建与 TypeScript 检查通过。
- 尚未实现：项目级视觉／资产设计版本、字段级局部锁定、完整图片/视频 Prompt Pack、语义 PreflightQC、不可变前期包及分镜后台 worker。三期计划及验收条件见 Roadmap 与 44 号方案。

2026-09-10 核心主链路收口：分集规划现在要求完整逐场执行蓝图；缺少阻力、信息变化、选择／代价、证据或退出状态等字段会在路线图阶段触发一次有界修复，仍不完整则阻断。生产适配器不再用模板场景静默补齐，只有离线固定／Mock 适配器保留明确标记的测试兼容路径；旧的已完成路线图检查点也会重新经过同一门禁。快速正文模型继续只接受 `execution_ready` 计划。

## 2026-09-10 Productionization Handoff

The productionization slice now has durable generation-task checkpoints, idempotent saves, pause/resume, and worker leases. An active lease blocks a second worker; expired leases can be reclaimed, and completed or paused tasks release the lease. Episode roadmap, screenplay, and story-quality Agents can resume from validated checkpoints, while stable request-key replay returns completed results without another model call.

Confirmed canonical Episode Artifacts advance the versioned `ContinuityLedger` in the same persistence transaction. The service exposes latest-version reads, rebuild, audit, and append-only rollback; the frontend synchronizes this versioned result instead of treating a local summary as authoritative.

Verification for this handoff: backend tests excluding the sandbox-restricted local-socket suite `tests/test_llm_deadline.py` pass with `1238 passed, 1 skipped`; real-generation probe tests pass `10 passed`; the story workflow probe passes save, readback, and zero-request replay. Authentication/tenant isolation, budget governance, unattended cross-leaf scheduling, and eight-episode creative-quality acceptance remain open.

## Engineering Verification

2026-09-11 DeepSeek 替换：本地真实配置、合并与分片模板、Astra 备用选择器已统一移除活跃 GLM 路由。大陆正文及修复、规划修改与备用使用 DeepSeek v4 Pro；输入分类、事实提取及独立对白翻译使用 DeepSeek v4 Flash；海外正文继续使用 Gemini 3.6 Flash。Pro/Flash 四次真实流式和非流式协议检查通过；后端全量 `1360 passed, 1 skipped`，前端 `399 passed`。正文单集抽样已保存：Pro/high JSON 模式 1,008 字符，含一次定向修复；Pro/low 对照 777 字符，均为隔离虚构样本，零请求跨进程重放通过。三集真实流程仍在分集路线图阶段因 Astra 120 秒加 DeepSeek Pro 300 秒备用路径只产生推理而失败；全流程尚未通过。Markdown/TXT/DOCX 内容一致性、浏览器确认与导出通过，但使用的是完整子集和模拟项目 API，不是整部作品创意批准。详见 [53_DEEPSEEK_WORKFLOW_ACCEPTANCE.md](53_DEEPSEEK_WORKFLOW_ACCEPTANCE.md)。

2026-09-11 数量修复第一步：以固定虚构故事注入对白缺口，捕获 Gemini 两轮不完整补丁，确认嵌套对白引用处返回空对象；展开 Gemini 非递归 schema 引用后，同输入在一个补丁回合通过 3 场、25 对对白、15 项动作与 103 秒时长检查，含一次连接重试共 2 次实际请求。本地调整已合并公共循环并保留顺序、译文和原始内容，兜底不能放行时长越界；跨进程零请求重放与捕获结果完全一致。全量后端 `1343 passed, 1 skipped`。历史失败原文缺失，不能宣称精确复现；完整流程和双市场三集仍是下一步。详见 [52_GEMINI_PRODUCTION_COUNT_REPAIR.md](52_GEMINI_PRODUCTION_COUNT_REPAIR.md)。

2026-09-10/11 对话修改和模型协议收尾（历史记录）：总纲、剧情树、分集规划修改及其有界修复已注入共享编辑器；早期样本曾使用大陆 GLM、海外 Gemini 3.6 Flash，Grill Me 使用 Astra。当前活跃配置已按后续迁移说明切换为大陆 DeepSeek V4 Pro、轻量角色 DeepSeek V4 Flash，海外正文保留 Gemini 3.6 Flash；没有活跃 GLM 路由。新增模型族协议归一化、请求级市场 ContextVar、统一结果脱敏投影、共享模块文档仓储与宿主授权/健康检查边界。历史真实隔离样本验证大陆一集和海外一集生成、保存及零请求重放；当前迁移回归以本节最新结果为准。

本轮验证：后端全量在沙箱内 `1282 passed, 1 skipped`，另 5 项因本机 socket 权限失败；随后允许回环连接复测 `test_llm_deadline.py`，`23 passed`，包括此前 5 项。补充 GLM 协议默认值后，相邻运行时、deadline 与模板测试 `60 passed`。前端 `399 passed`、TypeScript 检查、后端编译及 diff/配置语法检查通过。新开发服务位于 `http://127.0.0.1:3001`，API 位于 `http://127.0.0.1:8001`，均已验证 HTTP 200；真实生成速度及创意质量不在本次离线验证结论内。此前列出的 Liblib 前期制作实现和长期待办保持独立范围。

最新工程修复与回归（2026-09-08）：[46_ENGINEERING_FIXES_AND_WORKFLOW_RETEST.md](46_ENGINEERING_FIXES_AND_WORKFLOW_RETEST.md)。已修复跨项目 Story Bible 版本归属、创意页离页保存、Mock 规划合同、浏览器 RSC 取消误报及正文空闲文案；后端 1258 passed / 1 skipped，前端 399 passed，生产构建与桌面/移动 18 项 E2E 通过。默认 Mock API 流程已通过前两集保存、读回和零请求重放；真实规划端点仍发生 TLS 连接中断，不能计为真实全流程通过。编剧审阅所列剧情缺口、时长粗估局限及分镜待实现边界不变。

## Branch Registry

本节是当前活跃 Git 分支职责的权威登记。具体提交历史与远程同步状态仍以 `git log`、`git branch -vv` 和 GitHub 为准。

### `main`

- 职责：保存进入中国大陆长篇方向前的稳定 Script Generation 研究与能力基线。
- 当前稳定研究基线：`5b760e5`，tag 为 `script-generation-research-checkpoint-v1.1.0`。
- 主要内容：Generation Pipeline v1、Scene Causality、Story QC Explainability、Prompt Evaluation Explainability、受控 Revision / Re-QC / Acceptance Shadow、Creative Intent / Knowledge / Story Planning 等研究与验证资产。
- 不包含：`feature/cn-mainland-staged-generation` 中新增的中国大陆默认市场切换、长篇分阶段生成 UI 与 batch context、Deepening 默认关闭收口。
- 当前状态：本地稳定研究基线；尚未把当前功能分支合并回 `main`。
- 同步提示：当前本地 `main` 相对本地记录的 `origin/main` 领先 6 个提交；这只是仓库同步状态，不代表这些提交已进入远程稳定主线。

### `feature/cn-mainland-staged-generation`

- 职责：承载中国大陆漫剧市场切换与长篇分阶段生成的最小兼容实现。
- 基于：本地 `main` 的 `script-generation-research-checkpoint-v1.1.0` 基线。
- 已推送规划 API 基线：`2cdc79c`，commit 为 `feat: add persistent long story planning API`；持久化基线为 `0f6b2ec`，长篇契约基线为 `e5fdf81`。
- 主要内容：默认 `cn_mainland` market profile、保留但关闭 `overseas_tiktok`、红果 reference-only 定位、唯一递归剧情树流程、有界基础剧本批次、批次 lineage、长篇参数估算、Creative Deepening 前后端默认关闭。
- 当前增量：长篇 Contract Foundation、level-free recursive Story Plan Node、PostgreSQL/JSONB schema、Alembic migration、事务型 Repository、原子 optimistic revision、Project / Workspace Snapshot / Episode Artifact / Story Bible / Plan Node / Stage / Episode Plan 资源 API，以及 Frontend 本地优先同步、恢复、冲突提示、软删除和内容里程碑上报。
- 明确边界：仍通过现有单集 Draft API 编排；规划资源 API 不等同于自动 Story Blueprint / Episode Planning，也不等同于后台长任务或完整 60 万字自动生成 runtime。
- 验证状态：后端全量 `306 passed, 1 skipped`；前端递归工作流归一化与正文指标测试 `6 passed`，typecheck 与 production build 均通过。
- 远程状态：已推送并跟踪 `origin/feature/cn-mainland-staged-generation`。
- 合并状态：尚未合并到 `main`；应在合作方需求确认和新版手工验收完成后再决定是否合并并建立新版本 tag。

### `test1`

- 职责：承载作者主权、输入完成度识别、来源保留导入、规划审批门禁和正文自动恢复安全收口的交接分支。
- 基于：`creative-sovereignty-v1`（`f6696c1`）。
- 功能代码基线：`c0b168d`；交接文档从 `b058cdd` 开始记录，分支已推送并跟踪 `origin/test1`。
- 主要增量：Story Bible 来源保留导入草稿、分集原文 `episode_plan_import.v1` 来源审计、作者确认后的独立 `episode_plan_materializations` 原子写入、完整来源字段到 `EpisodeRoadmapItem.status=draft` 的投影、规划版本变化失效、确认规划后才允许自动续写/恢复、旧项目省略规划状态的兼容，以及全剧交付确认门禁。
- 明确边界：分集原文 materialization 会保留来源指纹、UTF-16 span、字段 provenance、Story Bible 和叶节点 lineage；字段缺失时只保存审计记录，不生成默认叙事文本或部分路线图。它不会物料化 `StoryPlanNode`、自动批准或生成正文；字段不完整批次尚无专用补齐表单。后台 durable Generation Task 的 checkpoint、租约和恢复已接入；无人值守 Story Planning Job 仍未完成。
- 验证状态：本轮完成第三集 N01–N06 独立修订、生成前约束、标题窄修复和 20 万字记忆优化。后端全量 `1253 passed, 1 skipped`，随后相邻 135 项通过；前端全量 `391 passed`，typecheck 与 API 契约通过。未重复 DOM 或 production build 验证。最新 E3 以完整记忆输入在 345.009 秒、1 次调用、零重写内生成，原距离承接和诺拉原知识键更新改善；表演通信方式、对白因果和人物表达仍使三集质量验收未通过。20 万字/120 集合成记忆测试通过，不代表完整作品创意质量验收。日常服务已加载改动，5 个用户项目和配置不变。详见交接文档 11.26 和 `40`、`41` 号报告。
- 交接文档：[22_TEST1_HANDOFF.md](22_TEST1_HANDOFF.md)。
- 合并状态：尚未合并到 `main`；应先完成交接文档列出的状态机、导入映射和真实流程验收，再决定合并或建立版本 tag。

新增分支时必须追加登记；分支合并或关闭后保留简短历史状态，避免后续开发者误判能力所在分支。

## Overseas Acceptance Progress

此前“还剩 3 步”指三集验收、八集验收、生产化三个大阶段，不是三次开发即可完成。当前停留在三集真实验收阶段；阶段内已完成的修复单独记录，测试未通过时不减少大阶段数量，也不据此估算剩余工期。

| 工作项 | 状态 |
| --- | --- |
| 产品 provisional 账本及记忆召回接线 | 已完成离线验证（27 号） |
| 有界重试和检查点恢复 | 已完成故障验证（28 号） |
| 历史正文语义审阅与验收标准 | 已完成审阅，样本仍需修订（29 号） |
| 流式终止处理 | 已修复，短输出验证通过（31 号） |
| 累计时限、响应进度与到限故障传播 | 本轮完成离线验证（33 号） |
| 固定测试规划歧义澄清 | 已新增显式 v2，旧版保留，零请求预检通过（34 号） |
| 新保护下的海外单集生成、保存与重放 | 已通过：1 次请求、224.063 秒、1,241 正文字符（34 号） |
| 新单集已知问题修订 | 已完成独立 provisional 修订，原稿保留；不能计为自动生成质量通过（35 号） |
| 修订状态进入第二集请求 | 已通过保存、读回及提示词检查；没有生成第二集（35 号） |
| 新提示下 v2 三集有界实测及审阅 | 已执行：900 秒、4 次请求，1/3 完成；新首集公开范围一致，但知识枚举冲突进入第二集（36 号） |
| 新样本知识状态与局部语义修订 | 已完成独立 revised/provisional 修订，正确状态进入第二集检查点、记忆和提示；原稿保留（37 号） |
| 知识冲突诊断、时长预算反馈及编辑成功状态 | 已完成零调用回归，后端全量 1134 passed（37 号）；38 号首集只编辑一次达标，稳定的质量与速度收益仍未验收 |
| 修复后 v2 真实生成与重放 | 第 38 号完成 2/3 集，4 次请求、900 秒；首集 73 → 103 秒一次编辑，知识状态正确；前两集副本零调用重放通过 |
| 前两集语义修订及身体能力误报 | S01–S05 已另存 revised/provisional 制品，8 处显式变更；能力限制规则收窄、原始证据保留（39 号） |
| 来源校验续跑及第三集补测 | 已完成：332.767 秒、3 次新请求；只生成第三集，三集保存及零调用恢复通过（39 号） |
| 第三集 N01–N06 显式修订及标题窄修复 | 已完成 revised/provisional 修订和保存核对；不能计为自动生成质量通过（40 号） |
| 20 万字记忆、原键与实际交接进入提示 | 已完成整体审查、优化和 120 集合成验证；真实 E3 最终提示含 22 条知识及跨路约定（41 号） |
| 海外连续三集创意质量、一致性、连续性与速度验收 | 待独立作品层复核；第 42 号最终 v6 已建立通信、落实主角代价和结尾反应，0 blocking/0 warning，第三集 294.143 秒、1 次请求，但一次样本和自动质量信号不能证明稳定创意质量或速度；token 与金额不影响放行判断 |
| 八集单元验收 | 未启动 |
| 认证、租户隔离、预算及无人值守生产化 | 未完成 |

保护范围见 [33_OVERSEAS_DEADLINE_AND_PROGRESS_GUARDS.md](33_OVERSEAS_DEADLINE_AND_PROGRESS_GUARDS.md)，历史样本见 `34`–`39` 号。最新结果见 [40_OVERSEAS_QUALITY_AND_HEADING_REPAIR.md](40_OVERSEAS_QUALITY_AND_HEADING_REPAIR.md)、[41_LONG_STORY_MEMORY_AND_PROMPT_INPUT.md](41_LONG_STORY_MEMORY_AND_PROMPT_INPUT.md) 和 [42_OVERSEAS_PROMPT_FIRST_PERFORMANCE_ACCEPTANCE.md](42_OVERSEAS_PROMPT_FIRST_PERFORMANCE_ACCEPTANCE.md)。本轮继续停在三集结果与问题报告；后续先收口结尾反应和主角代价，再进入八集单元及整部作品/生产可靠性验证。准确事实与执行约束优先进入生成提示，避免重复模型审稿。续跑或修订样本不能冒充全新三集，合成 20 万字容量不能冒充完整长篇质量验收。

## Active Market And Capability Flags

- `SCRIPT_MARKET_PROFILE=cn_mainland`：当前默认
- `overseas_tiktok`：非默认项目路径，可在创建页选择；本地启动会初始化大陆与海外两条路径的资源
- 红果：reference only，不是硬绑定平台
- Creative Deepening：实现和历史数据兼容位保留；前端入口隐藏，后端 runtime feature flag 默认关闭
- Static Creative Knowledge：大陆默认 Strategy 已启用 `knowledge_bundle.draft.cn_mainland_longform_planning_candidate.v2`，有界注入 Story Bible、递归拆分、Episode Plan 和基础 Draft；不含 TikTok 条目，不是 RAG。该 bundle 同时覆盖长篇可持续故事引擎、宏观运动、人物长期弧线和并行故事线；基础 `foundation.v1` 保留用于显式对照。知识原则仍是提示词级生成指引，不能独立证明 60 万字正文质量或替代跨批次连续性验收
- 长篇故事母本：当前目标；Story Bible、无固定层级的递归 Story Plan Node、episode-ready 叶节点、单集线路图/Episode Plan、ContinuityLedger 与 batch checkpoint 契约已实现。Story Plan Node 按剧情语义选择非均匀边界，系统强制叶节点为 8–12 集，至少 16 集继续递归，1–7 集或 13–15 集返回父层协调。每个叶节点在分集前完整定义单位剧情因果链、局部结算和交接压力。后台 Generation Task 的 checkpoint、租约、暂停/恢复与权威账本投影已接入；无人值守跨叶 Story Planning Job 和 Context Mapper 仍未完成
- 60 万字产品验收：尚未完成；真实 Story Bible / Root 样本已经验证生成、持久化、编辑与批准路径，但同时暴露出合法摘要无法证明数百集内容容量。下一验收主线先完成 Story Engine、宏观运动、人物/反派策略、信息揭示、支线贡献和重复风险的规划质量验证，再进入完整作品累计正文、跨批次一致性与连续性、失败恢复、耗时与人工创意质量检查
- 容量口径：当前创建页只开放 80,000–200,000 字的三个正文档位，默认 140,000；长篇 `StoryProject` 的 450,000 默认值和 600,000 验收脚本属于兼容/研究目标，不是当前 UI 已承诺或已完成生产验收的档位
- 模块资源持久化：配置 `DATABASE_URL` 时，ContentSpec 和 Prompt / Strategy / Asset / OntologyNode / PlatformProfile / MasterScript / OrchestrationPlan 均可跨进程读取；启动 bootstrap 只初始化缺失的默认目录，不覆盖已有记录
- `scripts/run_cn_longform_acceptance.py` 当前是旧版固定集数正文容量校准工具，直接串行调用单集 Draft，不经过 Story Bible / 递归剧情树 / Episode Plan；不得将其结果作为当前长篇主路径的正式端到端验收。正式测试从 Frontend 规划页的总纲确认开始
- `scripts/run_cn_recursive_600k_acceptance.py` 是当前隔离容量验收工具：默认 `all` 按最早未完成剧情部分逐层拆分，模型判定剧情语义已可直达正文后进入 episode-ready，再逐集生成该部分正文；每集保存本地 `continuity_snapshot.json` 并有界注入后续请求。该本地快照不是正式后端 `ContinuityLedger`

## Current Runtime Flow

```text
Raw Data
→ AnalysisResult
→ ContentSpecDraft
→ ContentSpec
→ optional ResolvedCreativeContext
→ exact-ID Mainland Long-form Knowledge Bundle
→ StoryBible / Recursive StoryPlanNode / Episode-ready Leaf / Episode Roadmap
→ Orchestrator / Retrieval
→ Prompt Retrieval
→ Prompt Builder
→ LLMAdapter
→ DraftMasterScript with Scene Causality
→ optional Creative Deepening Shadow（当前默认关闭）
→ StoryQCReport
→ RevisionDecision / RevisionStrategy / RevisionPlan
→ RevisionExecutor
→ Re-QC
→ AcceptanceDecision (shadow)
→ ScriptRevisionRun
→ Finalization Gate
→ Final MasterScript
```

### Recent Workflow Guardrails (2026-09-04)

- 输入完成度识别保持建议式行为：识别结果不会自行改变项目阶段，也不会跳过总纲、规划或正文的保存/确认门禁。
- 创建页会从创作提示和上传资料中提取最高明确集号、区间终点或显式总集数并自动填入剧集数量；实际分集覆盖仍只统计逐集标题，不会把“第1—52集”一句声明伪装成52份已上传分集内容。使用者手动修改后不再自动覆盖。
- 规划页的首层剧情、剧情树展开和分集路线图均由用户按钮触发；进入页面不会自动生成。
- 确认规划只会把规划会话锁定并解锁正文工作区；不会附带首轮正文生成意图。正文为空时由用户点击“生成下一部分”开始。
- 正文受控续写与中断恢复仍保留；刷新可恢复已由作者启动、仍符合恢复条件的任务，包括尚无已保存正文的首批。新建、暂停、完成和待审阅状态不会因页面导航或刷新启动生成。

Frontend 不再提供逐集/全部生成的产品模式选择。唯一流程先形成 Story Bible 和递归 Story Plan Node；分支根据剧情完整性停止拆分，批准叶节点在运行时均衡分批并覆盖区间内的逐集正文请求。每集仍是一次独立请求，旧 `mode` 字段只保留历史 payload 兼容。

## Implemented

### Content And Data Foundation

- Manual JSON / CSV Data Intelligence pipeline
- `RawContentRecord → AnalysisResult → ContentSpecDraft → ContentSpec`
- 关键词证据、标签映射原因和分数拆解
- `PlatformProfile` 注入；当前 active 为中国大陆参考 Profile，TikTok Profile 保留但关闭
- `OntologyNode` / `TagRef` 受控标签
- 统一 `Asset`、规则 Retrieval 与 `OrchestrationPlan`
- Prompt Library、Prompt Retrieval 与 Generation Strategy

### Generation

- `MockLLMAdapter`
- OpenAI-compatible `RealLLMAdapter`
- OpenAI-compatible Chat Completions / Responses 双 wire API；Responses 可选 reasoning effort，当前 Kimi 本地配置为 `responses + medium`
- 结构化输出、重试和 Schema 校验
- 长篇规划 provider compatibility：Story Bible、Story Plan Node、递归拆分和 Episode Plan 兼容 OpenAI strict schema 与只保证 JSON mode 的网关；Prompt 内含权威 Schema，本地执行 Pydantic 校验。Story Bible 会过滤输入重复字段；后续规划产物首次返回非 JSON 或非合约字段时最多执行一次带错误反馈的格式修复
- `CreativeIntentInput → ContentSpec + ResolvedCreativeContext`
- Character Context provenance 与 locked fields
- 策略声明的静态 Knowledge Bundle
- Scene Goal / Conflict / Outcome 与跨场 causal link
- 结构化 `DraftMasterScript`
- optional episode context，包括上一集状态、本集指令和项目连续性摘要
- optional 单集正文预算：中国大陆长篇前端按“总正文目标 ÷ 计划集数”传入 `target_script_body_characters`，Prompt Builder v0.3 将其限定为动作与对白预算，省略时保持旧行为
- 系统推荐集数会按已生成动作与对白正文的实际集均重新估算达标集数，并以有界批次继续到目标；手动集数严格按使用者设定停止，动态估算受 2000 集硬上限保护
- 长篇 Contract Foundation：`StoryProject`、`StoryBible`、人物弧/关系/故事线、level-free `StoryPlanNode`、兼容 `StoryStagePlan`、`EpisodePlan`、`ContinuityLedger`、`GenerationBatchPlan`、`GenerationJobCheckpoint`
- 长篇 Persistence Foundation：SQLModel tables、PostgreSQL JSONB、Psycopg 3、Alembic migration、事务 Session、版本不可覆盖、stale write 与非法状态倒退保护
- 长篇 Planning API：Project 分页与 optimistic update、Story Bible / Story Plan Node / Stage / Episode Plan immutable version 写入和读取；递归节点校验唯一根、父子归属、同级顺序、前驱及父子容量边界
- Story Planning Slice：复用 ContentSpec、GenerationStrategy 和 LLMAdapter 生成 Story Bible、第一层剧情与递归子节点；独立 Planning Workspace 先展示总纲，再逐分支审阅并以 immutable version 批准。达到可分集粒度的叶节点继续生成并审批单集路线图，路线图作为现有正文生成器的本集约束
- Frontend Workspace Persistence：Project 可在 ContentSpec 解析前创建；完整工作区使用 50 MB 上限的 JSONB snapshot、checksum、独立 revision 和 client lineage 保存
- Episode Artifact Persistence：确认 draft、规则 revised 和 final 使用服务端分配版本的 immutable JSONB artifact，保留 checksum、source artifact 与 bounded lineage
- Episode plan source materialization staging：`episode-plan-materializer.ts` 对审计 draft 执行 schema、原文指纹、Story Bible lineage、集号/span、叶节点版本/范围和路线图/正文占用的整批校验，成功只返回 `staging` 预览，不写入生产计划

### Quality Loop

- Story QC Explainability v1：五个维度、证据、场景引用和 revision signals
- Revision Decision / Strategy / Plan
- Rule-based Revision Executor、场景范围和保护维度检查
- Revision Execution Trace
- Re-QC
- deterministic Acceptance evaluation 与 `ScriptRevisionRun` shadow lineage
- Finalization Gate 和 Final `MasterScript` lineage
- Creative Deepening Shadow candidate、preservation trace 与 QC comparison（能力保留，当前默认关闭）

### Evaluation

- 固定 Benchmark datasets 与 runner
- Prompt Evaluation Explainability
- Revision Acceptance calibration fixtures
- Scene Causality、Creative Control、Serialized Planning 与 Knowledge / Deepening 离线实验资产
- 单元、API、Benchmark 与 E2E smoke tests

### Frontend MVP

- Next.js 中文创作界面，按项目选择中国大陆或海外发行路径
- IndexedDB 本地优先项目、角色、分集和版本快照
- PostgreSQL Project + Workspace Snapshot 同步、跨浏览器恢复、updated-at 合并、显式 revision conflict 和版本保护软删除
- 项目级市场配置：`cn_mainland` 与 `overseas_tiktok` 项目共用创作工作区，按发行地区选择对应资源和生成契约
- 两条路径均使用中文创作界面；大陆使用中文人物名与对白，海外使用中文非台词内容、双语人物提示及英文对白下的中文翻译
- 确认稿、修订稿和终稿 Episode Artifact 里程碑上报；失败不覆盖或删除本地稿件
- Creative Input、系统标签、“我的标签”和 Character Builder
- 上传资料中的 `第N集`、`Episode/E/EP N`、中文数字、明确集数声明及 `第01—33集` / `EP01–EP52` 区间可用于自动填写项目剧集数量；不连续标题按最高明确集号填写，缺号继续由来源审计报告。
- 中国大陆系统标签目录：题材类型、剧情元素、关系冲突、情绪体验与目标受众；静态“灵感推荐”需用户主动选择，不冒充实时热榜
- 旧 `element.*` 项目标签兼容迁移到正式 Ontology ID；本地完整启动初始化大陆与海外资源，标签按项目市场选用
- 递归剧情树驱动的有界基础剧本批次，包含本地 batch lineage 和 optional 阶段指令
- Story Bible、Story Plan Node 与 Episode Plan 草稿的结构化编辑、版本化保存和独立批准
- Episode Plan 的可选 `dramatic_units` / `protagonist_cost` 已支持编辑、清空、撤销、保存与 Markdown 导出，并进入批准计划的正文执行上下文；旧 `v1` 计划缺失字段仍兼容。戏剧单位不设最低数量，七项只作存储上限，不增加批准或 QC 门槛。数据契约见 `02_Data_Model.md`，创作质量仍待真实样本盲评
- 长篇字数验收仪表：以动作与对白正文计量项目目标，单独显示结构稿辅助文本、当前集、正文集均产量、目标进度、达标所需集均和按当前正文集均的完结投影；整部 Markdown / JSON 导出保留同口径统计
- 当前产品容量与历史验收容量分开：创建页可选 80,000–200,000 字，默认 140,000；600,000 字只用于隔离的长篇容量验收，不能据此宣称当前产品支持 600,000 字生产目标
- 分集切换、结构化编辑、保存、确认和 AI 修改；Deepening 入口当前隐藏
- Framework / Modification / Revised / Final 版本视图；历史 Deepening 数据仍可兼容读取
- 单集与整部 Markdown / JSON 导出
- 已有分集覆盖保护和复制新生成版本
- 海外项目的中英对照与导出检查按项目语言契约生效；大陆项目沿用中文正文
- 可编辑故事线、角色成长线和人物关系状态
- 后续分集消费 bounded 连续性摘要，不自动改写历史集

## Experimental Or Partially Calibrated

### Story QC

- 当前是轻量规则和 Rubric Explainability，不是专业 Script Expert。
- `overall_score` 和维度分数只能作为实验信号，不能作为最终剧本质量结论。
- 已增加非阻断的 `episode_quality_review.v1` 编导诊断，并在生成完成和人工复审后写入 Draft `llm_metadata`。报告覆盖既有制作数量硬边界报警、有限关键词对白功能覆盖与连续四句同功能提示、按正文 `body_order` 划分的 opening / complication / decision / exit 位置型变化候选，以及可选戏剧单位和人物代价的正文证据候选。选择与后果必须落在不同动作/对白条目；规划摘要不算正文证据；旧计划没有可选设计时仍运行通用诊断。
- 该报告有固定明细上限，只提供 `review_reasons` 和候选定位，不证明语义因果、不阻断保存或 Finalization。Workspace 已提供可折叠审阅面板，显示制作范围、对白功能、四段位置型信号和可选设计证据；作者手动保存正文前会调用现有复审接口并刷新报告。五种节奏形态的固定计数基线已加入；自动修改建议、真人盲评和软目标误报校准仍未完成。

### Revision And Acceptance

- Revision 执行仍以规则式修改为主，创意质量有限。
- Acceptance 当前只观察目标维度改善、回退和场景对齐，不阻断 Finalization。
- Acceptance calibration 仍为 `review_required`，未达到 enforcement 标准。

### Creative Deepening

- 实现和 preservation contract 保留，但当前产品流程关闭。
- 前端不展示候选入口，后端默认拒绝执行；历史候选数据只作兼容读取，不代表当前可用能力。

### Real LLM

- 已验证一个 OpenAI-compatible 接入。
- 跨 provider 稳定性、成本、延迟、429 / 5xx 和 Schema 失败率尚未完成生产校准。

### Knowledge

- 已实现 bounded static bundle 和 source lineage。
- 中国大陆通用基础 bundle 已覆盖规划与 Draft，但题材知识和大陆市场知识覆盖仍有限，不是完整 Knowledge Base runtime。

## Not Implemented

- Story Plan Node 的转折点、引用集合等低频字段的完整表单编辑；当前核心叙事字段和 Episode Plan 核心字段已支持编辑、保存和批准
- Episode Artifact 审计/恢复 UI 和编辑过程细粒度版本
- 后台 Job executor 的持久化 checkpoint、暂停/恢复、幂等重放和 worker 租约已完成；全自动递归、自动批量批准、无人值守跨叶调度和独立持久化 Context Mapper 仍未完成
- Continuity Ledger 已会随确认的 canonical Episode Artifact 自动推进，并提供 rebuild/audit/rollback；模型自动提取、跨批次冲突处理和审计 UI 仍未完成
- Frontend 已有可点击人物节点、关系记录、人物卡入口和逐集关系详情；仍缺正式自由布局关系图、与递归故事线树交叉跳转及后端权威状态同步
- 后端 Relationship / Story Line authoring contract、渐进式 proposed/confirmed fact lifecycle、future effective point、impact analysis 与分支再生成
- 按当前规划节点/分集生成 bounded continuity slice 的 Context Mapper；当前只有 Frontend 本地摘要，不足以承担完整长篇约束
- 后台 Generation Job 的服务端 checkpoint、暂停、恢复、断点重试和租约 claim 已完成；无人值守执行器仍未完成
- Authentication、租户/权限隔离、多用户协作和账户级云空间（单用户工作区服务端同步已实现）
- Story Planning 的后台自动递归、跨叶子调度与 durable job runtime
- Character Decision Logic runtime
- 动态 Knowledge Retrieval、RAG、向量库和 Skill Registry
- 标签来源证据聚合、Tag Knowledge Profile、动态 Tag Context Retrieval 和实时热门标签接入
- Project-scoped `CustomTagContext` 语义确认；当前“我的标签”仍只是本地创作关键词
- Prompt-only 与受控 Ontology Tag-only 输入已支持；confirmed CustomTagContext-only 仍待语义确认契约
- Tag Context 到可审阅 Story Synopsis / Story Direction 的正式映射
- 自动 Prompt 优化或自主学习
- Acceptance enforcement、多轮 Revision 和无限质量循环
- Script Generation 正式统一 Facade
- 文字 Storyboard：已实现第一阶段运行链路，浏览器验收待补；项目级视觉／资产设计、完整图片／视频 Prompt Pack、语义 PreflightQC 和前期制作包仍待实现，见 55 号核对记录
- 实际图片、Voice、Animation、Video 生成、剪辑与发布：下游团队范围，本次不接入

## Important Boundaries

- Frontend 项目数据先保存在 IndexedDB，并在 PostgreSQL 可用时同步 Project + Workspace Snapshot；远端新版本可恢复到本地，版本冲突只提示不自动覆盖。
- Workspace Snapshot 是当前兼容恢复边界，不代表 Draft / Revised / Final episode 已成为独立、可查询的服务端领域版本。
- 用户界面只提供递归规划后的有界基础剧本批次，不再展示“逐集/全部生成”；批次尚不具备后端持久化 Job 或断点任务恢复。
- 新 `StoryPlanNode` 允许任意深度、非平衡递归拆分：`episode_ready` 由事件链、选择后果、转折和退出状态是否足以直接指导正文决定，与集数无关。当前前端已经可以调用 LLM 生成第一层、拆分分支，并逐项编辑、保存和批准；系统仍不会自动递归整棵树。
- 长篇字数仪表是验收与容量投影工具，不是后台 60 万字生成 Job；60 万目标只计动作与对白中的字母、数字与中文字符，不将梗概、人物说明、Goal / Conflict / Outcome 等规划字段凑入正文字数。
- 正文 Key Pool 只在后端读取 `LLM_API_KEY_01` 到 `LLM_API_KEY_XX`，每个 Key 同时只执行一个请求；未配置编号 Key 时自动回退主 `LLM_API_KEY`。Key Pool 不绕过供应商账户级限制。
- 系统推荐集数模式可以在前端继续追加有界批次直到正文目标，但仍需要使用者触发下一阶段；当前没有无人值守后台 Job，也未把 60 万字一次性锁定为单个 LLM 请求。
- 故事线和人物关系是本地 authoring / continuity artifact，不是 Final `MasterScript` 字段。
- Bilingual View 是开发者 / 中文用户审阅工件，不进入目标语言正式剧本。
- Static Knowledge 只在 Strategy 明确声明并通过适用性校验时注入。
- Deepening 和 Acceptance 都不得绕过 Finalization Gate。
- EpisodeRoadmapAgent 与 EpisodeScriptAgent 已接入受约束运行和检查点。通用 Creator Agent / Copilot 尚未实现；未来扩展应调用已有 Application Use Cases，并复用其校验、版本和恢复机制。

## Last Recorded Validation

2026-09-11 最新升级验证：后端 `1323 passed, 1 skipped`；前端 `399 passed`，typecheck 通过；两市场各一集真实生成及跨进程零模型请求重放通过。详细范围和未通过样本见 [51_MODULE_UPGRADE_EXECUTION.md](51_MODULE_UPGRADE_EXECUTION.md)。以下保留此前阶段记录：

- 后端全量测试：`1084 passed, 1 skipped`（2026-09-08，公开状态诊断及提示修复后；真实模型测试显式关闭），1 条 TestClient 依赖弃用警告。连续性、生成提示及编辑专项 `103 passed`，详见第 35 号报告；此前时限和跨模块故障新增测试共 `32 passed`，详见第 33 号报告。
- 前端相邻恢复与 API 元数据测试：`27 passed`（2026-09-08）；本轮无前端代码变动，未重复 UI 全量验收。
- 后续探针版本化与传输/总时限脚本专项：`23 passed`（2026-09-08）；无产品运行代码变动，未重复全量。真实海外单集生成、制品保存、零调用跨进程重放和前端双语数据转换通过，语义审阅仍需修订，见第 34 号报告。
- 大陆/海外标签 bootstrap 与 Ontology 模型定向测试：`5 passed`
- 前端正文计数、推荐集数调度与旧模式归一化测试：`6 passed`
- 长篇模型、ContentSpec durable Repository、migration、Planning API、非平衡递归 Story Plan Node、Workspace Snapshot 与 Episode Artifact 定向测试：通过
- 前端 TypeScript：通过
- 分集原文 materializer 纯函数定向测试：`5 passed`；相邻规划回归合计 `49 passed`（2026-09-07）
- 分集物料化后端模型、Repository、API 与 migration 定向回归：`83 passed`；桌面/手机真实服务端到端检查通过（2026-09-07）
- 分集质量诊断、连续性、分层合同与正文生成服务定向回归：`136 passed`（2026-09-07）
- 分集质量诊断固定节奏样本：五种形态的计数基线通过，硬边界保持非阻断诊断；尚未替代真人盲评（2026-09-07）
- 前端分集质量诊断解析与 Workspace 接线测试：`4 passed`（2026-09-07）
- 上传资料集数自动提取：前端定向测试 `5 passed`、后端 readiness 测试 `17 passed`；真实创建页上传 `第01—33集` 自动填入 `33`，手动改为 `12` 后保持使用者输入；在线接口验证区间边界与实际逐集覆盖分离（2026-09-07）
- 前端全量测试：`387 passed, 0 failed`；最新为海外重试与恢复修复后运行，TypeScript 通过。此前产品账本与连续性专项见 27 号记录（2026-09-07）。
- 桌面/手机 Playwright：`14 passed`；生产依赖审计本次为 0 个已知漏洞。范围与剩余限制见 `24_FULL_STACK_ENGINEERING_REVIEW.md`
- 前端 production build：通过
- `git diff --check`：通过
- Alembic upgrade / check / downgrade / re-upgrade：通过 SQLite 自动化验证
- 真实 PostgreSQL 集成：已使用本地 PostgreSQL 完成 migration、Workspace Snapshot 写入/读回、进程重启后恢复和版本保护软归档
- ContentSpec durable lifecycle：本地 PostgreSQL 已升级到 `20260804_0005 (head)` 且 Alembic 无 schema drift；Creative Intent 创建的 ContentSpec 在完整前后端重启后按原 ID 读取返回 `200`，大陆 Platform Profile 与内容保持一致

### Overseas Real Generation Probe - 2026-09-07

- 固定海外规划输入、隔离 SQLite、真实 `gpt-5.6-sol` 路由；完成 1/3 集。第 1 集有效正文 1,189 字符，耗时 462.211 秒；第 2 集触发全轮 900 秒时限，第 3 集未启动。
- 30 句英文对白的中文人物名、逐句译文和前端展示转换检查通过；阅读发现钥匙归属状态冲突、未来转运被提前标记和证据推断过强，自动连续性诊断未捕获。
- 完成集在新进程中以零模型请求读回，正文和稳定业务结果一致；不代表未完成流式生成支持断点续传。
- 海外三轮累计 9 次物理请求，已知 28,172 tokens，其余 8 次用量未知，未填金额或全长成本。完整证据及限制见 [25_OVERSEAS_REAL_GENERATION_PROBE.md](25_OVERSEAS_REAL_GENERATION_PROBE.md)。
- 后续 medium 隔离复测完成 2/3 集，共 2,907 正文字符，900 秒内 6 次请求；已知 57,044 tokens，另外 3 次用量未知。两集零模型请求跨进程重放与前端双语转换通过；仍有证据含义偏移、译文加重和后处理动机问题。日常 high 配置未改，详见 [26_OVERSEAS_CONTINUITY_AND_LATENCY_RETEST.md](26_OVERSEAS_CONTINUITY_AND_LATENCY_RETEST.md)。
- 两轮探针均使用正文交接摘要，未注入完整结构化临时账本；连续性报告的 `not_applicable` 或零阻断项不能作为跨集账本检查通过的证据。
- 后续已将探针接入产品的 provisional 账本和本集记忆召回，修复物品键前缀漂移、压缩类别被挤空与会面时间召回优先级。已有两集原文零模型调用保存/读回及第 1–3 集请求构造通过；第 3 集只构造请求，没有新增真实正文。前端全量 `383 passed`，Python 相关专项 `58 passed`，TypeScript 通过。QC 账本仍有预算省略，真实三集、长篇质量与成本仍待验收，详见 [27_OVERSEAS_PRODUCT_CONTINUITY_WIRING.md](27_OVERSEAS_PRODUCT_CONTINUITY_WIRING.md)。
- 海外重试与恢复故障验收通过：修复重复空响应恢复、推理预算耗尽后原样重复请求和浏览器尾部 JSON 截断无法重试；验证共享传输请求上限、失败集稳定 ID、初稿阶段复用及成功集跨进程重放。全量后端 `1019 passed, 1 skipped`、前端 `387 passed`，没有新增真实模型调用。供应商长任务和全局金额预算仍未验收，详见 [28_OVERSEAS_RETRY_AND_RECOVERY_ACCEPTANCE.md](28_OVERSEAS_RETRY_AND_RECOVERY_ACCEPTANCE.md)。
- 海外语义审阅完成：逐句检查两集 60 对对白及 34 项动作，对照计划、账本与编辑前后稿，记录 5 组 P2 和 2 组 P3 问题，样本结论为 `revise`。编辑模型已接收只读场景因果，生成提示补充时间字段、信息来源与会面达成证据要求；无新增模型阶段或自动语义 Gate。后端全量 `1020 passed, 1 skipped`，零真实模型调用。第 3 步完成，下一步为有界海外三集真实复测；不等同于正文质量已通过或提示改进已证实。标准及原文指纹见 [29_OVERSEAS_SEMANTIC_ACCEPTANCE_REVIEW.md](29_OVERSEAS_SEMANTIC_ACCEPTANCE_REVIEW.md)。
- 后续海外三集真实复测未通过：在全新隔离目录运行，6 次请求上限内实际发起 1 次，首集未形成初稿，900 秒由独立进程 watchdog 终止，0/3 集完成、tokens/金额未知。未进入后处理、未启动第二三集，因此语义和本轮跨集继承不可评估。终止后补充响应头/首字节即时落盘及启动 manifest，专项 `19 passed`，未追加真实请求。第 4 步仍待通过，完整证据及后续诊断方向见 [30_OVERSEAS_THREE_EPISODE_RETEST.md](30_OVERSEAS_THREE_EPISODE_RETEST.md)。
- 海外流式终止诊断：已修复明确终止后继续读 socket、失败流 JSON 误收及探针正常关闭误分类。真实短 JSON 使用 1 次海外 medium 请求，HTTP 200、8.374 秒返回预期对象，已知 4,461 tokens；原始日志保留随后修复的 `GeneratorExit` 统计误分类，没有追加真实请求。全量后端 `1029 passed, 1 skipped`，专项 `133 passed`。不能确定上一轮 900 秒阻塞的唯一原因，也不能用短输出证明长篇质量；第 4 步仍需三集复测，详见 [31_OVERSEAS_STREAM_TERMINATION_DIAGNOSIS.md](31_OVERSEAS_STREAM_TERMINATION_DIAGNOSIS.md)。
- 流式修复后三集复测仍未通过：900 秒、3 次请求、0/3 完成；首请求 9.305 秒收到 HTTP 200，累计解析 12,535 个结构化文本字符后于 671.610 秒读取超时，非流式 high 恢复在 131.680 秒返回 524，最后重试被总时限终止。3 次 usage 均未知，0 个初稿检查点与制品，不能评估新正文质量。零请求预检与源码指纹核对通过，日常配置不变；本轮未改运行代码或重复全量回归。固定规划的比较字段、信息来源和内外景标记歧义另行记录。下一项先处理累计时限与响应进度诊断，仍剩 3 步，见 [32_OVERSEAS_POST_FIX_THREE_EPISODE_RETEST.md](32_OVERSEAS_POST_FIX_THREE_EPISODE_RETEST.md)。

### Overseas Deadline And Progress Guards - 2026-09-08

- 请求操作及初稿主请求/修复/非流式恢复共享累计截止，默认请求上限沿用角色 socket timeout，初稿链路默认 900 秒。到限后拒绝迟到结果、停止换 Key 和自动恢复；API/SSE 显式不可重试，Agent 保存失败状态。
- 新增无正文活动计数，覆盖响应头、首字节、首段文字/可见推理、最后活动和 SSE 注释行。HTTP/1.1 本地实网验证持续活动无法无限延长预算、连接复用与并发预算隔离；初稿跨路线失败持久化及日志脱敏通过。
- 本轮没有真实模型调用。全量后端 `1061 passed, 1 skipped`，前端相邻 `27 passed`。后端已重启并恢复双市场开发资源，API/前端 200，5 个现有项目完整列表响应及 `.env.local` 指纹不变。DNS/自定义传输等限制、真实生成未验收范围见 [33_OVERSEAS_DEADLINE_AND_PROGRESS_GUARDS.md](33_OVERSEAS_DEADLINE_AND_PROGRESS_GUARDS.md)。

### Overseas Versioned Single Episode - 2026-09-08

- 在独立项目启用 v2 测试规划，明确时间字段、诺拉获知新证据的渠道、仓库内外位置、作者与人物知识及姐姐生前签字。原 v1 规划及历史样本保留；预检 0 次请求，正式规划与预检除隔离节点 ID 外一致。
- 1/1 集生成完成，224.063 秒、1,241 正文字符、3 场、16 项动作、30 对对白。只调用 1 次海外 `gpt-5.6-sol` medium，已知 25,380 tokens，未触发恢复、编辑或截止。2 个检查点和 1 个 provisional 制品保存成功，跨进程重放模型请求为 0，前端双语转换 62 个唯一路径、0 警告。
- 内容结论为 `revise`：付款截图已公开展示而账本称未公开，另有屏幕指代及译文行为主体两项 P3。机器 QC 的零警告没有捕获前述冲突；检查前集数为 0，不代表跨集验收。无追加模型请求，20 份源码、用户项目与日常配置指纹不变；下一项先收口语义与账本一致性。证据和边界见 [34_OVERSEAS_VERSIONED_SINGLE_EPISODE_ACCEPTANCE.md](34_OVERSEAS_VERSIONED_SINGLE_EPISODE_ACCEPTANCE.md)。

### Overseas Disclosure Revision - 2026-09-08

- 增加材料持有/公开、屏幕/渠道/受众边界提示；同集非阻断诊断识别有限模式下的公开展示与笼统未公开状态冲突，排除已识别的计划/转述/私密屏幕/无人场景等，并避免多份材料共用简称归错对象。不是通用语义判断或自动修订 Gate。
- 第 34 号三项问题已在独立副本编辑修订，8 处内容字段修改并保存 before/after；原始草稿与新 revised 制品均为 provisional，来源关联、内容和读回检查通过。产品 review-draft 重新计算诊断，修正公开范围已进入第二集检查点及结构化提示词；本轮没有生成新集或调用模型。
- 全量后端 `1084 passed, 1 skipped`，定向 `103 passed`，修订稿双语投影 62 个唯一路径无警告。下一项为新提示下的 v2 三集实测；不能用手工修订结果证明模型已稳定修复语义问题。证据见 [35_OVERSEAS_DISCLOSURE_REVISION_AND_GUARDS.md](35_OVERSEAS_DISCLOSURE_REVISION_AND_GUARDS.md)。

### Mainland China MVP Acceptance - 2026-08-02

- 独立验收 runtime 只注册 `cn_mainland_comic_drama_v1`、大陆 Strategy 和两个中文 Prompt；未注册海外/TikTok Strategy，Creative Deepening 为 `disabled`
- OpenAI-compatible 真实模型完成连续 2 集中文生成：两次均为 HTTP 200；第 1 集耗时约 271 秒，第 2 集耗时约 58 秒；合计 6 个场景、20 条对白、26 条动作
- Scene Causality 验收全部通过：每场 Goal / Conflict / Outcome 完整，Goal 与 Outcome 不同，场景 2/3 具有前序因果引用，最终场景提供 cliffhanger 和 next episode question
- 逐集连续性验收通过：第 2 集直接承接第 1 集的诱饵访问记录，由苏晚主动设计三份标记副本验证嫌疑人，并将“账户权限提前调用”作为新的下集问题；未重置冲突、未重复第 1 集揭露、未提前公布幕后主谋
- 用户锁定角色 `苏晚`、`顾沉舟` 被保留；生成正文未发现 TikTok、livestream、Mara、Adrian 等海外模板残留
- Story QC Explainability 两集均正常输出 5 个维度，但都评为 `character_agency=2.5/5`；第 2 集已有苏晚拒绝盲目扣人、主动设计分层诱饵、限制顾沉舟信息范围等明确选择，该分数与文本证据不充分一致，暴露的是 Story QC 可信度缺口，不宜直接当作生成质量事实
- 发现一项输出规范缺口：第 2 集内容连续，但标题未稳定包含“第2集”；后续应将集号视为结构化展示信息，不应仅依赖模型自由命名
- 约 88 KB Frontend Workspace Snapshot 成功写入 PostgreSQL，checksum 长度 64；后端进程重启后读回内容、市场来源和标题一致
- 验收项目已按 expected revision 软归档，不出现在正常项目列表
- 前端 TypeScript 与 production build 通过；由于执行环境不能接管用户当前 Chrome / Next dev 会话，本轮未替代人工完成浏览器按钮级验收

该记录是当前 Project + Workspace Snapshot + 内容里程碑 Artifact 的验证快照，不代表后台任务、编辑过程细粒度历史或全部旧 Repository 已完成持久化接入，也不代表 60 万字长篇已完成端到端生产验收。

### 600K Script Body Calibration - 2026-08-02

- 60 万字目标口径固定为 `character_actions + dialogues.text` 的有效中文、字母和数字字符；不计梗概、人物说明、Scene Causality、标点和 JSON 格式。
- 旧真实样本正文分别约 643 和 630 字，按 334 集只能投影约 21.2 万字，确认旧 Prompt 无法支撑真实 60 万正文。
- Prompt Builder v0.3 接收 `target_script_body_characters=1797` 后，固定样本首次生成 1505 字正文，HTTP 200，耗时约 125 秒；较 643 字旧样本提升约 134%，但按 334 集仅投影 502,670 字。
- 第二次有依据校准请求目标为 2150，实际生成 1670 字正文，HTTP 200，耗时约 378 秒；没有发现明显重复灌水，按 334 集投影 557,780 字，按当前集均达到 60 万需要约 360 集。
- 因真实模型不会严格命中字符预算，系统推荐集数不再把 334 视为硬停止点：在 334 集仅有 557,780 字时，下一批范围为 335-339，动态估算总集数为 360；累计达到 600,000 后停止。手动 334 集仍保持硬停止。
- 当前结论：单集正文扩展和基于实际产量的有界续写调度已得到真实样本支持；完整 60 万字作品尚未实际生成，因此不能宣称全量质量、成本、连续性和失败恢复已经验收。
- 上述 334 / 360 集数字仅属于 2026-08-02 的单集容量校准记录，不再定义当前递归规划树的结构或硬编码集数；当前正式流程应由总纲和各分支内容决定拆分深度，episode-ready 叶子最多覆盖 10 集并直接进入逐集正文。

## Current Hold

- 暂停旧手工测试清单；旧清单已从当前文档集移除，待长篇主流程形成可用切片后重建验收清单。
- 暂停 Creative Deepening、海外 TikTok 默认适配、视频生产、Agent runtime 和大型架构重构。
- 当前运行开发仍围绕长篇生成基础、持久化和有界阶段生产；前期制作三期方案已归档待实现，实际媒体生成归下游团队。
