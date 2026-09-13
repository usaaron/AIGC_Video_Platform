# 00 AI Engineer Handbook

## Purpose

本手册只定义工程协作与开发规则，不重复维护系统实现清单、路线图或接口细节。

文档职责：

- 长期原则：`18_PROJECT_PRINCIPLES.md`
- 已接受决策：`19_DECISIONS.md`
- 当前实现状态：`21_Current_Status_Checklist.md`
- 当前优先级与 Backlog：`17_MVP_Roadmap.md`
- 系统架构：`01_System_Design.md`
- 数据契约：`02_Data_Model.md`
- API 契约：`05_API_Design.md`
- Script Engine：`14_Script_Engine.md`
- 分镜与前期制作目标方案：[44_PREPRODUCTION_STORYBOARD_PLAN.md](44_PREPRODUCTION_STORYBOARD_PLAN.md)；实现状态仍以 Current Status 为准
- Benchmark 与评估：`20_Benchmark_Evaluation.md`
- Research：`Research/`

发生冲突时，先根据以上职责确定事实来源，不在多个文档中复制同一份状态说明。

## Project Goal

当前产品唯一核心是为中国大陆漫剧市场稳定生成优质、可控、可追踪的中文长剧本母本，目标支持约 60 万字正文规模。长篇必须通过 Story Bible、可变深度递归剧情树、Episode Plan 和有界正文批次逐步完成；不得把“支持 60 万字”解释为单次模型调用或未经验证的全自动能力。当前不绑定单一发行平台，红果只作为市场和产品形态参考。

当前运行配置：

- `cn_mainland`：`active`，默认启动配置
- `overseas_tiktok`：`disabled`，原有 Profile、Prompt、Knowledge 与 Benchmark 资产保留，可显式切换恢复
- `creative_deepening`：`disabled`，能力和历史数据兼容位保留，当前基础剧本产品流程不展示入口、不执行候选生成
- `longform_source_story`：当前唯一产品核心；60 万字级契约、规划资源和有界正文路径已部分实现，完整端到端生成、恢复与质量验收尚未完成
- `recursive_story_planning`：当前唯一长篇产品流程；Story Bible 经过确认后进入可变深度、非平衡的 Story Plan Node 递归拆分，再从已批准的 episode-ready 叶子生成 Episode Plan 和有界基础剧本批次

市场切换不得通过删除海外资产或把中国大陆经验硬编码进核心领域完成。当前本地启动使用 `SCRIPT_MARKET_PROFILE=cn_mainland`；只有显式设置 `overseas_tiktok` 才恢复旧海外验证配置。Creative Deepening 由独立的 `SCRIPT_CREATIVE_DEEPENING_ENABLED` 控制，当前默认 `false`，不能仅因切换市场而自动启用。

默认优先级：

```text
长篇规划可持续性、容量诚实性与整体质量
> 60 万字端到端可完成性、可恢复性与可验证性
> 单集正文质量
> 媒体生产能力
```

当前处于 `Capability Optimization / System Validation`。除非发现明确架构缺陷或合作方需求无法由现有边界承载，否则不新增大型基础模块，不大规模改写稳定主链路。

2026-09-08 范围补充：用户已将正文之后的文字分镜、资产设计、图片／视频提示词与前期制作包纳入项目方案，见 D-027 和 44 号文档。实际媒体生成归下游团队；“当前剧本核心”不再表示永久排除前期制作。此次只整合方案，进入实现时按 Roadmap 分期交付，不把设计对象当作现有 Schema 或 API。

## Architecture Guardrails

- `ContentSpec` 是标准化内容要求的核心运行时对象。
- 用户 Creative Intent 与 Character Context 应先经过受控解析，不允许原始自由文本绕过契约直接支配业务逻辑。
- 平台规则进入 `PlatformProfile` / Platform Adapter，不硬编码进核心领域。
- Prompt 来自 Prompt Library、Generation Strategy 与 Prompt Builder，不散落在业务代码中。
- 中国大陆长篇模型调用必须通过 GenerationStrategy 精确选择有来源、版本化且有界的静态 Knowledge Bundle；总纲、递归规划、分集计划与基础正文应保持知识约束一致，不得把整个 Research 目录或所有知识无差别注入。
- 所有模型调用通过 `LLMAdapter` 或等价 Port，不绑定单一供应商。
- 长篇正文可使用服务端编号 Key Pool：`LLM_API_KEY_01` 到 `LLM_API_KEY_XX` 只用于独立正文生成请求；总纲、故事树和 Episode Plan 继续使用主 `LLM_API_KEY`。
- Key Pool 必须保持在后端环境变量或正式 Secret 管理中，不能进入前端、日志、lineage 或导出文件。
- LLM 输出必须先通过结构化 Schema 校验，不能直接成为 Final `MasterScript`。
- Story QC、Revision、Acceptance 与 Finalization 职责必须分离。
- Shadow / observational 信号不得被描述为生产强制 Gate。
- 长篇生成必须分阶段、有边界、可暂停并保存 lineage；不得用单次超长 LLM 请求生成完整母本。
- 产品目标字数/集数、Schema 合法和模型自评都不是内容容量证明；在大规模正文生成前，必须先验证 Story Engine、宏观叙事运动、人物/反派策略、信息揭示、支线贡献和重复风险。容量不足时应缩短目标或补充上层故事材料，不得机械扩写。
- 产品核心切换不等于删除既有能力。凡是能以清晰边界服务长篇规划、分集正文、连续性、质量检查、恢复、评估或导出的现有模块，应优先复用和适配；不得仅因其最初服务单集或海外验证而重复实现。
- 旧能力复用时必须服从当前长篇主链路和市场开关。可以保留底层原子能力、兼容契约和历史资产，但不得重新暴露与递归长篇流程冲突的旧产品模式，也不得把停用的海外规则或 Creative Deepening 静默带回当前生成上下文。
- 同一已确认 Episode Plan 叶子批次可以进行有界并行；不同叶子和批次之间仍保持规划顺序与人工控制，不得以并行绕过总纲、递归节点或分集计划确认。
- Story Bible、草稿状态的 Story Plan Node 和 Episode Plan 必须支持显式编辑、保存和批准；保存产生新的 immutable draft version，批准后的上层规划不得被原地覆盖。
- Production Artifact 与 Developer Artifact 分离；评估、双语审阅和调试信息不得污染正式剧本。
- Script Engine 长期仍以版本化单入口、单出口能力盒子为目标；正式 Facade 在内部契约稳定前保持 Backlog。
- 上游变化优先通过 Mapper 适配；下游变化优先通过 Handoff Adapter 适配。

完整架构和当前状态分别以 `01_System_Design.md`、`14_Script_Engine.md` 与 `21_Current_Status_Checklist.md` 为准。

## Development Strategy

每次改动先回答：

1. 解决哪个已经确认的问题？
2. 是否可由现有模块承担？
3. 如何验证比基线更好或至少不回退？
4. 哪些行为必须保持兼容？
5. 哪份文档是本次变更的事实来源？

默认工作方式：

```text
Problem / Requirement
→ Small Design Boundary
→ Implementation
→ Targeted Validation
→ Full Regression When Needed
→ Documentation Sync
→ Git Baseline
```

不得用“新增模块”代替问题分析。Research 只产生候选结论，必须经过 Architecture / Decision 和验证后才能进入 Runtime。

## Coding Standards

- 核心函数必须有类型标注。
- API 必须有明确输入输出模型和错误语义。
- 领域逻辑不得依赖 FastAPI Route、环境变量或单一供应商 SDK。
- 优先复用现有 Service、Repository、Adapter 与数据契约。
- 保持兼容时优先新增 optional 字段；不兼容变更必须提升 major schema version。
- 不允许把长期字段永久堆积在任意 `metadata` / `extensions` 中。
- 注释只解释非显然的业务约束，不描述显而易见的语句。
- 不提交 API Key、真实凭据、用户隐私数据或外部研究仓库内容。
- 不因重构删除或绕过现有质量 Gate。

当前技术基线：FastAPI、Pydantic、SQLModel、PostgreSQL、Alembic、Psycopg 3、pytest。生产 Schema 只能通过受审阅的 Alembic migration 演进，不允许由应用启动时的 `create_all` 静默修改。

## Testing And Benchmark Rules

- Bug 修复必须补充可复现测试，或明确记录无法自动化的原因。
- 能力优化必须使用固定 Benchmark、固定 fixture 或受控 A/B。
- 不允许为了让结果变好而修改 Benchmark Ground Truth。
- `datasets/benchmark/` 是固定能力基准；`datasets/mock/` 只用于开发。
- Mock 用于确定性功能测试，不代表真实内容质量。
- 真实模型测试必须记录模型、参数、Prompt / Strategy 版本、失败率、token 与延迟。
- Story QC 当前专业可信度边界必须在报告中明确，不得把 placeholder 分数解释为专业结论。
- Shadow Acceptance / Deepening 只提供观测信号，除非 Decision 明确升级，否则不得阻断或替换正式链路。
- 修改公共契约、核心用例或跨模块依赖时运行全量回归；纯文档变更只做引用和一致性检查。

评估细节统一维护在 `20_Benchmark_Evaluation.md`。

## Documentation Standards

- 文档是架构的一部分，但每个事实只维护一个权威位置。
- README 只保留产品简介、重要边界、快速启动和文档导航。
- Handbook 只保留开发规则，不记录逐版本能力流水账。
- Roadmap 只记录优先级、阶段与 Backlog，不复制实现细节。
- Current Status 只记录当前已经实现、实验性和未实现能力。
- Decisions 保留历史编号；被取代的决策必须标注 superseded / updated，不删除历史语义。
- Research 保留来源、假设、实验和限制，不自动升级为正式架构。
- API、数据模型或兼容策略变化必须同步对应正式文档。
- 临时实施计划完成后应删除或归档，不继续作为当前事实来源。
- 旧验收清单在产品要求变化后应重新设计，不在失效清单上继续追加补丁。

## Version Baseline Management

重要能力阶段完成后形成稳定版本基线：

```text
Capability Development
→ Validation
→ Documentation Sync
→ Git Commit
→ Version Tag
→ Next Optimization Cycle
```

建立基线前至少确认：

- 主链路和关键用户路径已验证；
- Benchmark 状态明确；
- 测试结果可追踪；
- 文档与实现一致；
- Commit 信息和版本标识清晰。

没有稳定基线时，不进行大范围能力重构。架构重构应采用小步迁移和兼容入口，不同时重写 API、前端和核心运行链路。

### Branch Management

- `main` 只承载已经确认可作为共同开发起点的稳定基线，不直接堆叠未经验证的大范围能力变化。
- 较大的市场切换、能力优化或兼容迁移应使用语义清晰的 feature branch，并保持对稳定基线可追踪。
- 每个活跃分支必须在 `21_Current_Status_Checklist.md` 的 Branch Registry 中记录：分支目的、包含能力、基线关系、验证状态、是否允许合并以及未完成事项。
- 分支说明记录能力边界，不复制提交日志；精确代码历史仍以 Git commit / tag 为准。
- 新建、合并、冻结或删除分支时必须同步 Branch Registry，已经失效的分支记录应标记 closed / merged，不静默删除历史语义。
- feature branch 合并回 `main` 前，必须完成验证、文档同步和明确 commit；重要能力阶段还应建立 version tag。
- 不把本地领先、远程存在或已经 push 等 Git 状态混同为“已经进入稳定主线”。只有完成审核并合并到 `main` 的能力才属于正式主线。

### Persistence Management

- PostgreSQL 是正式生产数据源；SQLite 只用于自动化测试和 migration compatibility，不作为生产替代。
- 每个 Web 请求或 Application Use Case 使用独立 Session 和事务，异常时必须 rollback。
- 稳定筛选字段、外键、状态、版本、集数和时间关系化；仍在演进的长篇结构保存 JSONB 完整快照。
- Story Bible、Story Plan Node、Story Stage、Episode Plan 和 Continuity Ledger 版本一经写入不得原地覆盖，新内容必须提升 version。
- Project、Batch 和 Job 等可变对象使用 revision 做 optimistic concurrency，禁止静默 last-write-wins。
- Migration 必须验证 upgrade、downgrade 和 metadata drift；Alembic autogenerate 结果必须人工审阅。
- Frontend Project + Workspace Snapshot 已接入 PostgreSQL，确认/修订/终稿已有 Episode Artifact；在编辑过程细粒度历史、旧 Repository 与后台 Job 全部迁移前，不得宣称整个生产链路已经完整 durable。

## Data Intelligence Rules

- 数据必须经过 `DataSourceAdapter`，不允许来源逻辑直接侵入分析流程。
- 标准链路保持 `RawContentRecord → AnalysisResult → ContentSpecDraft → ContentSpec`。
- `AnalysisResult` 必须保留关键词证据、标签映射原因和分数拆解。
- Trending / 推荐信号只是建议，未经用户选择不得自动成为创作要求。
- 高级抓取、黑盒推荐、Embedding 聚类和自动主题模型在获得新决策前保持 Backlog。

## Script Generation Rules

- `DraftMasterScript` 是结构化中间产物。
- Scene Causality、Creative Context 和 Knowledge Bundle 必须保留来源与版本信息。
- Revision 必须消费结构化 QC / Strategy，并保持有界、可追踪。
- Acceptance 当前边界以 `21_Current_Status_Checklist.md` 为准，不得越权替代 Finalization Gate。
- Final `MasterScript` 只能通过受控 Finalization Gate 生成并保存 lineage。
- 前端分集编排不得伪装为尚未实现的 Story Blueprint / Episode Planning runtime。
- 新增角色、故事线或关系约束不得静默改写历史分集。
- 长篇规划不得强制固定层级或平衡树；每个 Story Plan Node 根据自身复杂度独立决定继续拆分或进入 `episode_ready`。
- 人物关系网和故事线树是 Story Bible / Planning / Continuity 的可视化投影，不得成为相互冲突的第二事实源。
- 人物与关系允许随已确认规划和分集渐进补全；模型生成的候选变化必须保留来源和确认状态，不能直接污染后续连续性事实。
- 人物关系和故事线保持独立领域语义，可在统一 Story Map 中交叉引用；后续生成只消费与当前规划节点相关的有界连续性切片，不注入整部作品的全量图谱。
- 已有内容后的关系/故事线修改默认 future-only；历史重写必须先做影响分析、显式创建版本并保留 lineage。
- 标签必须区分稳定 Ontology、来源证据、知识画像和动态趋势；未知自定义标签只能先进入 project scope，不能自动污染公共知识。
- Agent 如进入产品，应调用受控 Application Use Cases / Tools，不得绕过现有领域规则或形成无限自主循环。

## Definition Of Done

能力实现完成至少需要：

- 明确输入、输出与兼容边界；
- Code、类型和错误处理；
- 定向测试；
- 必要的全量回归；
- Benchmark 或固定 fixture 证据；
- 对应正式文档更新；
- 未完成与 placeholder 能力明确标记。

Research、设计占位和 shadow 信号不满足生产能力的 Definition of Done。

## AI Engineer Authority

AI Developer 可以：

- 编写和重构代码；
- 修复 Bug；
- 增加测试；
- 同步文档；
- 在既有边界内做小步能力优化。

修改以下内容前必须先说明影响并获得明确确认：

- 核心 Data Model / Ontology / `ContentSpec`；
- Knowledge Base 治理方式；
- Script Engine 公共契约；
- Finalization Gate；
- 系统长期架构和项目方向。

不得自行推翻架构、删除核心模块、隐藏已知风险或把实验性能力描述为生产完成。

## Current Hold

合作方新要求正在等待确认。收到新要求前：

- 不启动新的大型架构重构；
- 不继续扩展旧手工验收清单；
- 不提前实现多 Agent、RAG、视频生产或新的 Story Planning runtime；
- 只允许做文档一致性、明确缺陷修复和保持当前系统可运行所需的工作。

新的产品验收方案应在合作方要求落地后重新建立。
