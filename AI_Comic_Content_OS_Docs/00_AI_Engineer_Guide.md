# 00 AI Engineer Handbook

## Project Philosophy

AI Comic Content OS 不是单一的 AI 视频生成工具，而是一个数据驱动、可持续学习、可扩展的 `Content Operating System`。

本项目真正的长期核心不是某个模型，而是：

- `ContentSpec`
- Ontology
- Knowledge Base
- Data Intelligence
- Content Intelligence
- Asset Matching
- Story Engine
- `MasterScript`

当前项目唯一目标是：

构建一个能够持续学习、持续分析、持续生成符合 TikTok 平台、目标用户和商业目标的高质量 `MasterScript` 的 `Content Planning Engine`。

## Project Architecture

当前 MVP 的唯一有效主链路是：

Raw Data
→ `RawContentRecord`
→ Cleaning
→ Basic Feature Extraction
→ Rule-based Tag Mapping
→ Preference Score
→ `AnalysisResult`
→ `ContentSpecDraft`
→ `ContentSpec`
→ Knowledge Base
→ Asset Retrieval
→ Orchestrator
→ Prompt Retrieval
→ Prompt Builder
→ `LLMAdapter`
→ Draft `MasterScript`
→ Story QC
→ `RevisionDecision`
→ `RevisionStrategy`
→ `RevisionPlan`
→ `RevisionExecutor`
→ Re-QC
→ `AcceptanceDecision`
→ `ScriptRevisionRun`
→ Final `MasterScript`

当前 Script Engine 的长期对外目标形态应逐步收口为：

`ScriptGenerationRequest`
→ Script Generation Box
→ `ScriptGenerationResult`

当前说明：

- 盒子内部仍可保留 Draft、QC、Revision、Finalize 等步骤
- 但这些内部步骤不应长期作为上游调用方必须自行编排的正式公共契约
- 上游应优先依赖统一入口对象
- 下游应优先依赖统一出口对象

当前最小实现说明：

- `Scheduled Ingestion` 当前通过 `DataIngestionJob` 预留定时采集架构
- `Scheduled Ingestion` 当前会为每次运行保存 `DataIngestionRunHistory`
- `Trend Intelligence` 当前最小实现为 `TrendSnapshot`
- `Scheduled Ingestion` 必须先经过 `DataSourceAdapter`
- `Knowledge Base` 先沉淀统一 `Asset`
- `Knowledge Base` 同时预留 `Prompt Library`
- `Orchestrator` 当前最小实现先输出 `asset_requests`
- `Asset Retrieval` 当前读取 `OrchestrationPlan.asset_requests` 做受控检索
- Script Engine 后续消费编排结果、检索候选、Prompt 资产与生成策略

当前阶段最终输出是：

- `MasterScript`

当前阶段以下能力仅允许保留接口、数据结构和扩展位置：

- Storyboard Generation
- Video Generation
- Animation Pipeline
- Seedance Integration
- Voice Generation
- Subtitle Generation
- Video Composition

当前架构额外要求：

- `Script Engine` 最终应演进为单入口、单出口、版本化契约的能力盒子
- 上游变化优先通过 `ScriptGenerationRequestMapper` 适配
- 下游变化优先通过 Handoff Mapper 适配
- 不允许为了某个上游或下游对象的短期变化污染 `Script Engine` 核心逻辑

## Development Principles

- 文档驱动开发优先于代码直觉。
- 一次只实现一个小模块，保持输入、输出、数据结构、API、错误处理和测试清晰。
- `ContentSpec` 是当前系统唯一标准对象（Single Source of Truth）。
- 不允许绕过 `AnalysisResult` / `ContentSpecDraft` 直接从原始数据生成 `MasterScript`。
- TikTok 规则必须进入 `PlatformProfile` / Platform Intelligence，不得硬编码进核心内容模块。
- 当前所有设计优先保证：
  - 剧本质量
  - 剧本一致性
  - 剧本可控性
  - 剧本商业价值
- 明确优先级：
  - 剧本质量 > 视频生成能力
- 稳定公共契约优先于暴露内部实现细节。
- 上游和下游模块不应长期直接依赖 Script Engine 的内部步骤对象。

## Coding Standards

- 优先使用：
  - FastAPI
  - PostgreSQL
  - SQLAlchemy 或 SQLModel
  - Pydantic
  - pytest
- 所有核心函数必须有类型标注。
- 所有 API 必须有输入输出模型。
- 代码中保留必要注释，但不要过度注释。
- 暂缓开发模块不允许偷偷落真实功能。
- 任何最小模块都应尽量包含：
  - Code
  - API
  - Type Hints
  - Tests
  - Example Data
  - Error Handling

## Documentation Standards

- 文档是架构的一部分，不是附属物。
- 每次新增或修改核心结构时，必须同步更新对应文档。
- 如果变更影响以下文档，必须同步更新：
  - System Design
  - Data Model
  - API Design
  - Project Structure
  - Roadmap
- Research 不直接驱动代码。
- 正确关系是：
  - Research
  - → Architecture
  - → Code
- 涉及版本化契约的变更，必须同步更新：
  - Data Model
  - API Design
  - Compatibility / Migration 说明

## Version Baseline Management

AI Comic Content OS 采用阶段性版本基线管理。

当一个重要能力阶段完成后，应形成稳定版本基线：

Capability Development
→ Validation
→ Documentation Sync
→ Git Commit
→ Version Tag
→ Next Optimization Cycle

阶段性版本基线用于：

- 保留可复现系统状态
- 支持问题定位
- 支持能力提升前后对比
- 支持回滚稳定版本
- 记录架构与能力演进历史

进入阶段性版本基线前，至少应满足：

- 主链路验证通过
- Benchmark 状态明确
- 测试结果记录
- 文档状态同步
- Commit 信息清晰

版本命名建议：

- `generation-pipeline-v1.0.0`
  - 表示第一版完整生成链路基线
- 后续能力优化版本可按能力主题递增，例如：
  - `v1.1 Story QC Improvement`
  - `v1.2 Revision Quality Upgrade`
  - `v1.3 Data Intelligence Improvement`

当前阶段额外原则：

- 不要在没有稳定基线的情况下进行大范围能力重构
- 每次重大能力变化前，应确保当前稳定版本已经保存
- Capability Optimization 应尽量基于可回溯、可比较的稳定版本推进
- Benchmark、测试记录与文档状态应能对应到清晰的基线版本

## Current Development Focus

当前 MVP 阶段唯一目标：

构建一个能够持续生成高质量 AI 漫剧剧本的 `Content Planning Engine`。

当前阶段已经从：

- Build Foundation

切换为：

- Capability Optimization / System Validation

当前开发链路：

Data Intelligence
→ `ContentSpec`
→ Knowledge Base
→ Asset Retrieval
→ Orchestrator
→ Prompt Retrieval
→ Prompt Builder
→ `LLMAdapter`
→ Draft `MasterScript`
→ Story QC
→ `RevisionDecision`
→ `RevisionStrategy`
→ `RevisionPlan`
→ `RevisionExecutor`
→ Re-QC
→ `AcceptanceDecision`（shadow）
→ `ScriptRevisionRun`
→ Final `MasterScript`

当前默认开发策略：

- 优先优化已有模块能力
- 默认不继续扩大型骨架
- 默认不新增大型基础模块
- 只有在现有模块明确无法满足需求时，才建议新增基础设施

当前对外能力边界应逐步从“步骤 API 集合”过渡为：

- `ScriptGenerationRequest`
- `ScriptGenerationResult`

当前 `generate-draft`、`build-revision-plan`、`revise-draft`、`finalize` 仍然保留，用于：

- 稳定现有联调链路
- 支持 Benchmark / Prompt Evaluation / 手动调试
- 作为未来统一 `Facade` 背后的内部步骤实现

当前阶段最终输出：

- `MasterScript`

当前阶段的主要验收标准不再是新增模块数量，而是：

- 是否能够通过固定 Benchmark 稳定输出可解释 `AnalysisResult`
- 是否能够稳定输出合理 `ContentSpec`
- 是否能够稳定输出正确 Prompt
- 是否能够稳定输出合理 `DraftMasterScript`
- 是否能够稳定输出 `Story QC Report`
- 是否能够稳定输出结构化 `RevisionPlan`
- 是否能够稳定输出 `Revised DraftMasterScript`
- 是否能够验证目标修订维度改善、非目标维度回退和修改场景对齐
- 是否能够将 shadow `AcceptanceDecision` 保存到 `ScriptRevisionRun` lineage
- 是否能够稳定输出 Final `MasterScript`
- Final `MasterScript` 的 Story QC 分数是否高于 `DraftMasterScript`

当前优化优先级：

1. Revision Acceptance / Policy Calibration
2. Initial Generation Quality Improvement v1

当前已完成的能力优化基线：

- Story QC Explainability Upgrade v1
- Prompt Evaluation Explainability Integration v1
- Revision Quality Improvement v1：Decision、Strategy、Planner、Executor 与 Acceptance shadow integration

当前 Revision 成熟度边界：

- 已实现：结构化决策、策略、受控规则执行、Re-QC、确定性 Acceptance 计算与 lineage 保存
- Shadow：`AcceptanceDecision` 只用于观测，不阻断 Finalization
- 待校准：Revision Policy 阈值、跨 Benchmark 的 effectiveness 指标和人工 Ground Truth
- 生产强制：仍只有现有 Finalization Gate 的 lineage、Re-QC 存在性和最低分数校验

当前 Script Generation Quality Loop checkpoint 只进行 Script Engine 能力优化。以下模块仍属于既有 MVP 范围，但本阶段不扩展其能力：

- Data Collection
- Data Intelligence
- Trend Intelligence
- Audience Intelligence
- Commercial Intelligence
- Platform Intelligence（TikTok）
- `ContentSpec`
- Ontology
- Tag System
- Knowledge Base
- Asset Retrieval
- Orchestrator
- `CreativeBrief`
- `MasterScript`
- Script Engine

当前明确冻结：

- Data Intelligence Quality Improvement
- Knowledge Base 实现扩展
- Creative Skill Registry
- Asset / Media / Video Production

当前 `Trend Intelligence` 的最小实现要求：

- 先复用 `DataIngestionRunHistory`
- 先沉淀 `TrendSnapshot`
- 先做规则聚合而不是黑盒趋势模型

## Data Intelligence Development Rules

Data Intelligence 必须明确回答：

- 数据来自哪里？
- 如何采集？
- 如何清洗？
- 如何分析？
- 如何生成标签？
- 如何生成 `AnalysisResult`？
- 如何生成 `ContentSpecDraft`？
- 如何生成最终 `ContentSpec`？
- 如何支持未来扩展？

Data Intelligence 不允许只是抽象模块，必须形成完整的数据分析链路。

当前 Data Intelligence 统一规则：

- 当前采用：
  - `Manual Import First`
- 当前允许：
  - `Scheduled Data Ingestion` 架构占位与基础 Job 管理
- 当前必须实现：
  - `ManualCSVImportAdapter`
  - `ManualJSONImportAdapter`
- 当前自动采集最小流程：
  - `Scheduled Ingestion`
  - → `DataSourceAdapter`
  - → `RawContentRecord`
  - → Cleaning
  - → Basic Feature Extraction
  - → Rule-based Tag Mapping
  - → Preference Score
  - → `AnalysisResult`
  - → `ContentSpecDraft`
  - → `ContentSpec`
- 不允许绕过 `DataSourceAdapter` 直接写入分析流程
- 当前统一流程：
  - `RawContentRecord`
  - → Cleaning
  - → Basic Feature Extraction
  - → Rule-based Tag Mapping
  - → Preference Score
  - → `AnalysisResult`
  - → `ContentSpecDraft`
  - → `ContentSpec`
- 当前不实现：
- 自动大规模爬虫
- 登录态抓取
- 黑盒推荐模型
- 复杂调度系统
- BERTopic
- Embedding Clustering
- LLM Topic Labeling
- Emotion Analysis
- Semantic Retrieval

以上高级能力当前只允许保留接口与扩展点。

当前阶段 Data Intelligence 额外要求：

- 每个 `AnalysisResult` 必须是可解释的
- 必须保留：
  - 关键词证据
  - 标签映射原因
  - 分数拆解
  - 推荐 Hook 类型
  - 推荐 Cliffhanger 类型
- 不允许只给黑盒分数，不说明来源

## Script Generation Development Rules

当前阶段 Script Generation 的目标不是绑定某一个“最强模型”，而是建立一个可复用、可替换、可评估的剧本生成工作流。

当前强制规则：

- 不依赖某一个特定大模型。
- 所有 LLM 能力必须通过 `LLMAdapter` 或等价抽象接入。
- 当前保留 `MockLLMAdapter` 用于单元测试、API 测试、Smoke Test 与无外部模型环境开发。
- 当前允许接入一个真实 `RealLLMAdapter` 做首次能力验证，但业务层仍然只能依赖 `LLMAdapter` 抽象。
- 不允许把剧本生成逻辑写死到 OpenAI、Claude、Gemini、DeepSeek、Qwen 或任意单一模型提供商。
- Prompt 不应作为散落在业务代码中的一次性手写文本。
- Prompt 必须来自 `Prompt Library`、`Prompt Builder` 或二者组合。
- 当前真实模型接入配置必须来自集中环境变量：
  - `LLM_PROVIDER`
  - `LLM_MODEL`
  - `LLM_API_KEY`
  - `LLM_BASE_URL`
  - `LLM_TIMEOUT_SECONDS`
  - `LLM_MAX_RETRIES`
- API Key 禁止写入代码、示例数据、测试样例或 Git。
- Prompt 必须支持：
  - 可追踪
  - 可版本化
  - 可评估
  - 可替换
- 当前剧本生成关注点是：
  - 提高剧本质量
  - 提高剧本一致性
  - 提高剧本可控性
  - 提高剧本商业价值
- 当前不以“方便调用视频模型”作为剧本生成设计优先级。

当前 Script Engine 推荐流程：

`ContentSpec`
→ `CreativeBrief`
→ Asset Retrieval
→ Prompt Retrieval
→ Prompt Builder
→ `LLMAdapter`
→ `DraftMasterScript`
→ `StoryQCReport`
→ `RevisionDecision`
→ `RevisionStrategy`
→ `RevisionPlan`
→ `RevisionExecutor`
→ Re-QC
→ `AcceptanceDecision`（shadow）
→ `ScriptRevisionRun`
→ Final `MasterScript`

当前最小实现要求：

- `DraftMasterScript` 必须作为结构化中间产物存在
- LLM 原始输出不允许直接越过结构化映射进入 Final `MasterScript`
- 真实模型返回内容当前必须先校验为结构化 `DraftMasterScript` schema，校验失败时必须重试或返回明确错误
- `Story QC` 当前至少应评估 `DraftMasterScript`，而不是松散字典对象
- `RevisionPlan` 必须消费 `Story QC` 的结构化结果，而不是自由文本意见
- `Script Revision` 当前必须保持可解释、可追踪、可测试
- Final `MasterScript` 当前必须只通过受控 Finalization Gate 生成
- Finalization Gate 当前唯一允许链路：
  - `DraftMasterScript`
  - → `StoryQCReport`
  - → `RevisionPlan`
  - → `RevisedDraftMasterScript`
  - → `ReQCReport`
  - → `ScriptRevisionRun`
  - → Final `MasterScript`
- shadow `AcceptanceDecision` 可以存在于 `ScriptRevisionRun`，但当前不是 Finalization 必填条件
- 缺少 `StoryQCReport`、`RevisionPlan`、`RevisedDraftMasterScript` 或 `ReQCReport` 时禁止 Finalize
- Re-QC 分数低于 Finalization Policy 阈值时禁止 Finalize
- Final `MasterScript` 必须保存完整 lineage，包括：
  - `ContentSpec`
  - `PlatformProfile`
  - `GenerationStrategy`
  - Prompt 版本信息
  - LLM 元信息
  - 原始 Draft
  - 原始 QC
  - `RevisionPlan`
  - Re-QC
  - Finalization Policy 与版本
- `POST /master-scripts` 与直接 `from-draft` Finalize 入口应视为弃用或禁止入口
- `MasterScript` 内的语言、角色名、对白文本、场景来源不得依赖散落硬编码或静默默认值
- 如需默认值，必须来自集中配置并且可在 lineage 或 policy 中追踪

当前相关对象说明：

- `Prompt Library` 属于 `Knowledge Base` 的一部分
- `GenerationStrategy` 用于声明一次剧本生成任务采用的完整生成方案
- `Prompt Builder` 负责把结构化输入拼装为最终传给 LLM 的 `Master Prompt`
- `Prompt Builder` 当前必须至少纳入：
  - `ContentSpec`
  - `CreativeBrief`
  - `PlatformProfile`
  - Retrieved Assets
  - `GenerationStrategy`
  - `Prompt Library` 资产内容
  - `output_language`
  - `desired_scene_count`
  - `target_duration_seconds`
  - Hook / Cliffhanger / Character Agency / Cultural Fit 要求
  - 平台约束
  - 输出 JSON Schema
- `Story QC` 负责评估草稿剧本质量
- `RevisionPlan` 负责把 Rubric 扣分原因整理成可执行修订动作
- `Script Revision` 负责按受控规则将 `RevisionPlan` 应用到 `DraftMasterScript`

当前明确禁止：

- 直接写死某个模型 API
- 直接写死一个超长大 Prompt
- 把 Prompt 散落在业务代码中
- 实现复杂多 Agent 框架
- 训练专用剧本模型
- 提前接入视频生成链路

## Capability Validation Rules

当前阶段重点不是继续扩展系统规模，而是验证系统能力。

当前强制要求：

- 所有能力优化都必须能够通过固定 Benchmark 验证
- 禁止为了提升结果直接修改 Benchmark Ground Truth
- `datasets/benchmark/` 中的数据应视为固定能力基准
- `datasets/mock/` 只用于日常开发，不用于正式能力对比
- `evaluation/` 下的每个评估步骤必须可以独立运行和独立测试
- `Story QC` 后续必须基于显式 Rubric，而不是自由发挥
- `RevisionPlan` 必须来自固定规则或可解释推理，不能是不可追踪的随意建议

当前 Benchmark 至少覆盖：

- US Female Dark Romance
- US Werewolf Romance
- CEO Romance
- Supernatural Romance
- Revenge Drama

## Research Rules

Research 用于沉淀：

- 行业研究
- 平台研究
- 用户研究
- 算法研究
- 商业模式研究
- 内容研究

Research 规则：

- Research 不允许直接修改代码。
- Research 先影响 Architecture。
- Architecture 再影响代码。
- 国内工业化流程只作为行业研究参考，不自动变成本项目标准流程。
- 本项目最终目标仍然优先围绕：
  - TikTok 平台
  - 海外用户
  - 商业化目标

## Definition of Done

任何模块完成必须至少包括：

- Code
- API
- Type Hints
- Tests
- Example Data
- Documentation
- README 更新（如需要）
- Error Handling

缺少上述关键项，不视为完成。

## Reuse Before Reinvent

在设计任何模块之前，必须优先判断：

- 是否已有成熟开源方案？
- 是否已有成熟论文？
- 是否已有成熟工业标准？
- 是否已有稳定算法？

如果存在：

- 优先借鉴
- 优先封装
- 优先适配

不要重复造轮子。

本项目真正需要自主设计的核心包括：

- `ContentSpec`
- Ontology
- Knowledge Base
- Data Intelligence
- Content Intelligence
- Asset Matching
- Story Engine
- `MasterScript`

当前针对剧本生成与打磨链路，优先借鉴以下开源方向，而不是从零重造基础设施：

- Prompt / Benchmark 回归测试：
  - 优先借鉴 `promptfoo` 的评测、回归、对比思路
- 结构化输出、重试、校验：
  - 优先借鉴 `Instructor` / `Guardrails` 一类方案的输出约束模式
- 工作流状态编排：
  - 仅当 Revision Loop 明显变复杂时，再评估 `LangGraph` 一类状态图工作流
- 剧本导出标准：
  - 可参考 `Fountain` 作为附加导出格式，但不能替代结构化 `MasterScript`

当前借鉴边界：

- 可以借鉴评测方法、结构化输出约束、状态机模式、导出标准
- 不可以让外部框架取代：
  - `ContentSpec`
  - Prompt Library
  - Generation Strategy
  - Final `MasterScript` lineage
- 不可以因为引入开源框架而绕过当前受控主链路

## AI Engineer 权限边界

AI Developer 可以：

- 编写代码
- 重构代码
- 新增模块
- 增加测试
- 完善文档
- 修复 Bug

AI Developer 必须提出建议后才能修改：

- Data Model
- Ontology
- `ContentSpec`
- Knowledge Base
- System Architecture

AI Developer 不允许自行：

- 推翻架构
- 删除核心模块
- 改变项目方向
- 修改长期原则

## Current Prohibitions

当前不要实现：

- 自动大规模爬虫
- 登录态抓取
- 黑盒推荐模型
- 视频生成
- StoryBoard
- Seedance API
- 配音
- 剪辑
- 发布系统

这些均属于 Phase 2。
