# 19 Decisions

## 目的

本文件记录当前已经明确的架构决策，作为后续实现、讨论与评审时的共同基线。

---

## D-001 项目定位

状态：Accepted

决策：

AI Comic Content OS 被定义为数据驱动、模块化、可扩展的 Content Operating System，而不是单一的 AI 视频生成工具。

原因：

- 长期竞争力来自内容决策与资产沉淀
- 视频生成模型可替换，系统知识与数据不可轻易替代

影响：

- 系统设计优先支持知识沉淀、可复用资产与反馈学习
- 不以“单次生成成功”为架构核心

---

## D-002 V1 平台策略

状态：Superseded by D-020

决策：

V1 只支持 TikTok。

原因：

- 先聚焦单一平台，便于建立高质量的平台理解与内容闭环

影响：

- 当时的平台知识优先围绕 TikTok 建设
- 但平台逻辑不得硬编码到核心领域模型中

---

## D-003 平台架构策略

状态：Accepted

决策：

采用 Platform First, Platform Agnostic Architecture。

平台相关逻辑统一放入：

- `PlatformProfile`
- `PlatformAdapter`

原因：

- 既满足 V1 的 TikTok 聚焦，又保留未来扩展能力

影响：

- 新增平台时应通过新增 Profile / Adapter 扩展
- 不应通过修改核心内容模块来接入新平台

---

## D-004 ContentSpec 作为系统核心中间对象

状态：Accepted

决策：

`ContentSpec` 是系统最重要的中间对象，也是模块间内容决策交换的首要载体。

原因：

- 降低模块之间的松散耦合
- 让内容决策结果可被追踪、复用、更新

影响：

- 其他模块应尽量读取、更新或生成 `ContentSpec`
- 不鼓励模块间直接传递大量临时字段

当前实现：

- 已有 `Pydantic` 模型
- 已有最小 `FastAPI` API
- 已有基础测试

---

## D-005 标签系统受 Ontology 管理

状态：Accepted

决策：

标签必须遵循统一 Ontology，不允许自由散乱增长。

原因：

- 避免标签失控
- 保持检索、分析与资产复用的一致性

影响：

- 资产标签必须引用受控分类
- 新增标签时需要同步考虑 Ontology 文档更新

---

## D-006 统一 Asset 模型

状态：Accepted

决策：

剧本、人物、声音、动作、镜头、场景、风格等内容资源统一视为 `Asset`，通过 `asset_type` 区分。

原因：

- 简化系统模型
- 提高资产复用与检索一致性

影响：

- 默认不为每类资产建立完全独立的数据系统
- 如需特殊结构，应在统一模型基础上局部扩展

---

## D-007 生成流程决策

状态：Accepted (Updated)

决策：

当前剧本 MVP 的有效受控主链路应遵循：

Raw Data
→ `RawContentRecord`
→ `AnalysisResult`
→ `ContentSpecDraft`
→ `ContentSpec`
→ optional `ResolvedCreativeContext`
→ Retrieval / `Orchestrator`
→ Prompt Retrieval
→ optional strategy-declared Static Creative Knowledge
→ Prompt Builder
→ `LLMAdapter`
→ `DraftMasterScript`
→ optional Creative Deepening Shadow comparison
→ `StoryQCReport`
→ `RevisionDecision`
→ `RevisionStrategy`
→ `RevisionPlan`
→ `RevisionExecutor`
→ `RevisedDraftMasterScript`
→ `ReQCReport`
→ `AcceptanceDecision`（shadow）
→ `ScriptRevisionRun`
→ Finalization Gate
→ Final `MasterScript`

当前说明：

- 该决策编号保留，但其早期“`MasterScript` 直接进入 Shot Script / Animation Pipeline”的表述已被当前受控剧本生成链路取代
- Creative Deepening 和 Acceptance 在当前链路中只是 shadow / observational 信号，不替代 source Draft 或 Finalization Gate
- 后端 Draft runtime 仍以单集调用为原子步骤；Frontend 已通过 optional episode context 支持逐集与全部框架的有界顺序编排
- 该前端编排不等同于 Story Blueprint、Episode Plan、统一多集事务或完整系列规划 runtime
- Storyboard、Animation、Seedance、Voice、Video Composition 等能力属于后续 `Media Production Phase`
- 它们不属于当前剧本 MVP 主链路

原因：

- 保持可控性
- 支持局部修改
- 支持资产调度与反馈回流
- 将剧本质量验证与媒体生产链路解耦

影响：

- 不允许把系统简化成“Prompt 直接生成视频”
- 当前必须先稳定 `Draft -> QC -> Revision -> Re-QC -> Final` 的受控链路
- 后续媒体生产模块应消费稳定剧本结果，而不是反向主导当前剧本 MVP

---

## D-008 视频模型通过 Adapter 接入

状态：Accepted

决策：

视频生成能力通过 `VideoGenerationAdapter` 接入，当前计划兼容 Seedance 2.0 / 2.5，未来可替换为 Kling、Runway、Veo 等。

原因：

- 保持模型供应商可替换
- 避免业务逻辑与供应商 API 耦合

影响：

- Seedance 不能被写死在核心业务逻辑中

---

## D-009 成本与质量优化模块暂时保留接口

状态：Accepted

决策：

`CostQualityOptimizationModule` 在当前阶段只保留接口和占位，不实现复杂决策逻辑。

原因：

- 当前优先搭建核心内容与平台架构
- 该模块依赖更多实际反馈与成本数据

影响：

- 当前实现中可以预留扩展点
- 不应过早引入复杂策略引擎

---

## D-010 当前后端实现策略

状态：Accepted

决策：

当前已采用以下技术基线：

- FastAPI
- Pydantic
- pytest

当前 `ContentSpec` 仓储为内存实现，后续再演进到 `SQLModel + PostgreSQL`。

原因：

- 先稳定核心数据契约与 API 边界
- 避免在数据库设计尚未细化前过早固化表结构

影响：

- 当前代码适合作为领域模型和接口基线
- 后续引入数据库时应尽量保持 API 契约稳定

---

## D-011 当前 MVP 唯一目标

状态：Accepted

决策：

当前 MVP 阶段唯一目标是构建能够持续产出高质量剧本的 `Content Planning Engine`，当前阶段最终输出是 `MasterScript`。

---

## D-012 Script Industry Knowledge 进入方式

状态：Accepted

决策：

专业剧作知识必须作为结构化、可版本化、可追踪资产进入系统，不允许直接硬编码到 `Script Engine`。

原因：

- 便于复用、评估和文化适配
- 降低“某次 Prompt 灵感”对系统质量的偶然性依赖

影响：

- 后续行业知识应通过 `Knowledge Base`、`Prompt Library`、`GenerationStrategy`、Retriever 等标准机制接入
- `Prompt Evaluation` 和 `Story QC` 后续应能追踪使用了哪些知识条目

---

## D-013 Production Artifact 与 Developer Artifact 分离

状态：Accepted

决策：

正式生产工件与开发者工件分离管理。

原因：

- 避免调试信息污染正式生产内容
- 保证正式剧本始终服务目标市场语言与最终生产链路

影响：

- 正式 `MasterScript` 保持目标市场语言，不混入中英双语注释
- `StoryQCReport`、`RevisionPlan`、`Evaluation Report`、`Bilingual Developer View` 等仅作为开发者工件存在

---

## D-014 Bilingual Developer View 的定位

状态：Accepted

决策：

`BilingualScriptView` 已作为 presentation-only 开发者审阅工件实现。当前输入是英文 `DraftMasterScript`，输出是按稳定文本路径对齐的中英双语视图；未来可兼容 Final `MasterScript` 审阅。

原因：

- 便于中文研发团队审阅英文目标市场剧本
- 保留正式生产工件语言纯度

影响：

- 它不进入 Final `MasterScript` 的正式生成主链路
- 它应保留原文与译文并存，而不是用译文覆盖正式字段
- 中文界面可按 Draft 缓存该工件；英文界面不请求或显示中文翻译

---

## D-015 海外适配优先于直接照搬

状态：Superseded by D-020 for the current active market; retained as the overseas-mode rule

决策：

借鉴国内 AI 漫剧工业化经验时，优先借鉴结构与流程抽象，不直接照搬内容表达和文化外壳。

原因：

- 作出本决策时的产品目标是 TikTok 出海和海外商业化
- 海外平台、受众、语境与内容政策不同

影响：

- 后续知识调用必须结合 `PlatformProfile`、地区、语言、culture cluster、受众与商业目标做适配
- 任何“行业最佳实践”都不能作为无条件默认值

当前说明：该决策继续约束 `overseas_tiktok` 模式，但不再定义当前默认市场。

---

## D-016 当前阶段聚焦剧本生产链路

状态：Accepted

决策：

在剧本生产链路稳定之前，不提前投入视频生成相关模块的实际开发。

原因：

- 现阶段真正需要优先验证的是内容规划链路是否稳定
- 剧本质量优先级高于视频生成能力

影响：

- Storyboard、视频生成、动画、配音、剪辑、发布系统全部放入 Phase 2
- 当前这些模块只允许保留接口、数据结构和扩展位置

---

## D-017 Data Intelligence 采用 Manual Import First

状态：Accepted

决策：

当前 Data Intelligence 统一采用 `Manual Import First`，所有数据源通过 `DataSourceAdapter` 接入，优先实现：

- `ManualJSONImportAdapter`
- `ManualCSVImportAdapter`

原因：

- 先稳定数据模型、分析链路与输出契约
- 避免在 MVP 阶段过早投入高风险的数据抓取开发

影响：

- 当前支持的标准流程为：
  - `RawContentRecord`
  - → Cleaning
  - → Basic Feature Extraction
  - → Rule-based Tag Mapping
  - → Preference Score
  - → `AnalysisResult`
  - → `ContentSpecDraft`
  - → `ContentSpec`
- `TikTokScraperAdapter`、`ApifyAdapter`、`RedditAdapter`、`YouTubeAdapter`、`WebtoonAdapter` 仅保留占位

---

## D-018 开源工作流复用策略

状态：Accepted

决策：

项目可以优先借鉴开源社区在以下方面的成熟方案：

- Prompt / Benchmark 回归评测
- 结构化输出校验与重试
- 有状态工作流建模
- 标准化剧本导出格式

但不得让外部框架取代以下核心资产：

- `ContentSpec`
- Prompt Library
- Generation Strategy
- Story QC
- Final `MasterScript` lineage

原因：

- 当前项目真正的长期壁垒在核心域模型，而不是通用 LLM 工作流框架
- 借鉴成熟基础设施可以减少重复造轮子
- 但如果让外部框架接管主链路，会削弱项目的可控性与可解释性

影响：

- 后续可以选择性引入评测、校验、导出相关方案
- 不能为了集成开源框架而绕过当前受控主链路
- 任何引入都必须先通过 Research，再同步到 Architecture，最后进入代码

---

## D-019 Script Engine 采用单入口、单出口、版本化契约

状态：Accepted

决策：

`Script Engine` 的长期公共边界采用：

- `ScriptGenerationRequest`
- `ScriptGenerationResult`

内部步骤继续保留，但不作为长期唯一公共契约。

原因：

- 降低上游与下游对内部步骤的耦合
- 允许内部工作流继续演进，而不强迫所有调用方同步理解 Draft、Revision、Finalize 细节
- 便于未来通过 facade 统一封装现有稳定步骤链路

影响：

- 上游变化应优先通过 `ScriptGenerationRequestMapper` 适配
- 下游变化应优先通过 Handoff Mapper 适配
- `generate-draft`、`build-revision-plan`、`revise-draft`、`finalize` 当前保留，但应逐步视为内部步骤 API / 调试 API / 评估 API
- 本轮不删除现有 API，也不大规模重构当前主链路

---

## D-020 默认市场切换为中国大陆并保留海外能力

状态：Accepted

决策：

- 当前默认市场配置为 `cn_mainland`
- 当前不绑定单一发行平台，红果只作为市场与产品形态参考
- 原 `overseas_tiktok` Profile、Prompt、Knowledge、Benchmark 与代码路径完整保留，但默认 disabled
- 本地 runtime 通过 `SCRIPT_MARKET_PROFILE` 显式切换；默认值为 `cn_mainland`
- Creative Deepening 实现保留，但当前中国大陆配置为 disabled
- 当前内容目标从海外短内容转向中文长篇故事母本，现有单集生成器继续作为底层有界执行能力

原因：

- 合作目标已切换到中国大陆漫剧市场
- 60 万字故事母本需要长程结构、人物状态、伏笔和连续性能力，不能由连续单集摘要扩展替代
- 删除海外能力会损失已建立的验证资产，也违背平台可替换原则

影响：

- 中国大陆资料提高的是市场适用度，不自动提高来源可信度；未经验证的爆款公式仍不得成为硬规则
- 当前 Story QC 的平台维度改为通用 `Platform Fit`，中文不再被 Cultural Fit 默认降分
- 中国大陆长篇 Knowledge Bundle、Story Bible、故事阶段规划和 Continuity Ledger 尚未实现，必须小步设计和验证
- D-002 被本决策取代；D-015 只在重新启用海外模式时继续适用

---

## D-021 长篇项目采用使用者可控的有界阶段生成

状态：Accepted

决策：

- 保留“逐集生成”和“全部生成”两个产品模式
- 逐集模式一次生成一集；全部模式通过使用者设定的有界批次逐步完成总集数，不一次请求完整长篇
- 总集数支持系统透明推荐和使用者手动设定；推荐值只作创作规划参考，不是平台规则
- 每个阶段保留批次编号、起止集数、阶段指令、完成进度和时间；批次间允许更新标签、角色、关系、故事线和创作说明，更新只影响后续剧集
- `GenerationBatchContext` 是兼容式单集请求 lineage，不是新的 Workflow Engine、热点检索器或 Story Planning runtime
- Creative Deepening 代码保留，但由独立前后端 feature flag 统一关闭；默认 `SCRIPT_CREATIVE_DEEPENING_ENABLED=false`

原因：

- 内容创作者需要按更新频率生产，并把后续出现的新梗或市场元素受控融入尚未生成的内容
- 数十万字长篇无法通过一次 LLM 调用可靠生成，必须具备暂停、审阅、补充输入和继续执行的边界
- 当前先复用稳定单集生成能力，避免为基础批次需求提前增加调度引擎

影响：

- 当前批次状态和项目历史仍保存在浏览器 IndexedDB，后端 PostgreSQL 项目聚合、Generation Job 和断点恢复仍是下一阶段能力
- 阶段生成提高了创作可控性，但不解决 Story Bible、跨阶段 Setup/Payoff、长期人物弧和专业连续性规划
- 后续热点或 Data Intelligence 推荐必须由使用者确认后进入下一阶段输入，不得自动改写已确认剧集

---

## D-022 长篇持久化采用 PostgreSQL 关系字段与 JSONB 版本快照

状态：Accepted

决策：

- 生产环境使用 PostgreSQL；SQLite 只用于 Repository 和 migration 自动化测试
- 使用 SQLModel / SQLAlchemy 映射、Psycopg 3 驱动和 Alembic migration，不依赖应用启动时自动建表
- 项目、版本号、状态、集数范围、时间等查询与约束字段采用关系列和索引
- Story Bible、Stage Plan、Episode Plan、Continuity Ledger 等完整版本对象保存为 JSONB snapshot，避免将领域契约拆散为不可维护的超细表结构
- Story Bible、Stage Plan、Episode Plan 和 Continuity Ledger 采用 immutable version；已保存版本不得原地覆盖
- Story Project、Generation Batch 和 Generation Job 使用 optimistic revision；Repository 拒绝 stale write 和非法状态倒退
- 一个 Application Use Case 使用一个数据库 Session / transaction；Repository 不自行提交事务
- 所有 schema 变化必须通过可升级、可降级并可检查 metadata drift 的 migration 交付

原因：

- 数十万字长篇需要可靠保存总纲、阶段、分集计划、连续性和可恢复批次，浏览器 IndexedDB 与进程内 Repository 不能作为商业产品的事实来源
- 纯 JSON 文档缺少关键查询、唯一性和状态约束；完全关系化又会使版本化领域对象迁移成本过高
- 关系字段与 JSONB 快照的混合方式兼顾可查询性、契约演进、审计和恢复能力

影响：

- 当前已完成 schema、migration、事务型 Repository，以及 Project / Story Bible / Stage / Episode Plan 资源 API；Frontend 和后台 Job 尚未接入，不得宣称现有浏览器项目已经自动服务端持久化
- Application Use Cases 必须负责权限边界、事务范围和领域对象协调；API 不得直接操作 SQLModel Record
- 前端 IndexedDB 迁移必须在服务端 API 稳定后单独设计并验证，不允许静默丢失或覆盖本地项目
- 本决策不引入新的 Engine，也不改变现有单集生成、Story QC、Revision 或 Finalization 行为
