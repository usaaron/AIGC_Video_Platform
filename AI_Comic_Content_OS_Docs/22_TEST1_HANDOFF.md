# AI Comic Content OS / `test1` 分支交接文档

> 文档版本：`test1-handoff.v1`
> 交接快照：2026-09-08（Asia/Shanghai）
> 工作目录：`/Users/simonriley/Downloads/docs`
> 当前分支：`test1`
> 功能代码基线：`c0b168d`
> 交接文档提交起点：`b058cdd`
> 远程：`origin/test1`（接手时请用 Git 命令复核最新 `HEAD`）

本文是交给下一位工程师、编导产品负责人或审查者的独立交接资料。它描述的是当前代码真实具备的能力、当前安全边界、最近变更、验证记录和下一步实施条件。它不替代以下权威文档：

- [工程协作手册](00_AI_Engineer_Guide.md)：开发规范、测试规则和架构变更权限。
- [当前状态清单](21_Current_Status_Checklist.md)：全项目能力状态、实验性能力和长期未实现项。
- [系统设计](01_System_Design.md)、[数据模型](02_Data_Model.md)、[API 设计](05_API_Design.md)：正式领域契约。
- 根目录 [README.md](../README.md)：安装、启动和产品边界。

如果本文件与代码或正式契约不一致，以代码、API/Pydantic 契约和 `21_Current_Status_Checklist.md` 的最新内容为准，并在发现差异后补正文档。

---

## 1. 一句话结论

`test1` 是从 `creative-sovereignty-v1` 基线继续加固的长篇剧本创作工作流分支。它已经把“输入识别 → 总纲草稿 → 递归剧情树 → 分集路线图 → 有界正文生成 → 保存/确认 → 全剧导出”的主要门禁和来源追踪补齐到可审阅状态，并清除了首次进入页面时的隐式生成行为。

当前执行优先级按用户 2026-09-08 的明确要求：**创意质量、一致性和连续性第一，速度也很重要，不考虑 token 消耗。** 速度优化必须保持创意质量和连续性，重点衡量实际完成用时、无效重写及其原因。Token 和费用只保留在原始日志与历史实测记录中，不用于优化决策、验收门槛或阻断后续推进；旧小节中的成本或账单验收要求不再适用。最新三集结果、记忆优化及剩余问题见 11.26 节。

用户补充的流程原则：用生成前的详细执行提示和准确上下文预防问题，争取一次成稿；只有发现具体失败才定向修复。每集保留快速结构、引用和保存检查，不默认串行增加模型审稿或整集重写。完整作品审阅放在阶段验收与有依据的抽样中，减少重复开发检查和无效返工。

用户追加记忆要求：先整体审查再优化，支撑最多 20 万字；长期事实不能因最近条数截断而丢失，当前集召回应保留稳定键、来源及跨集实际约定。实现与容量验证见 [41_LONG_STORY_MEMORY_AND_PROMPT_INPUT.md](41_LONG_STORY_MEMORY_AND_PROMPT_INPUT.md)，不将合成容量验证写成完整作品质量通过。

当前最重要的边界是：

> 高完成度分集原文可以被检查、分段并生成只读预览；作者明确确认后，系统会保存独立的 `EpisodePlanMaterialization.status=draft` 审计记录，并只在必需来源字段完整、目标范围未占用时创建 `EpisodeRoadmapItem.status=draft`。它不会创建 `StoryPlanNode`、自动批准路线图或生成正文。

此前不安全的“原文直接物料化”初稿因可能伪造默认文案、来源追踪不足和覆盖旧路线图而撤回。当前实现已经按来源指纹、字段 provenance、Story Bible/节点 lineage、整批事务和作者确认边界重写；不得从旧提交恢复被撤回的默认填充或覆盖行为。

---

## 2. 当前 Git 状态与交接基线

### 2.1 分支和提交

功能代码基线和文档提交链：

```text
branch: test1
feature baseline: c0b168d
handoff docs: 194efed -> b058cdd
```

接手时以 `git status --short --branch`、`git rev-parse HEAD origin/test1` 为准；文档后续修订会自然产生新的文档提交，不应把本节的快照 hash 当成永久分支头。

`test1` 从 `creative-sovereignty-v1`（`f6696c1`）继续演进，最近提交按功能顺序如下：

| 提交 | 作用 | 交接意义 |
|---|---|---|
| `9fcb51f` | 整理规划工作流、输入完成度、手动生成入口和若干辅助模块 | 形成当前输入识别与规划交互基线 |
| `66d3e1e` | 对齐结尾合同、路线图审批、连续性和正文约束 | 形成当前规划/正文门禁基础 |
| `c80f204` | 全剧导出增加交付确认快照和内容指纹 | 导出不再只看“有正文” |
| `2df3a69` | 增加来源保留的 Story Bible 导入草稿适配边界 | 高完成度总纲可以按原文整理为可编辑草稿 |
| `be587b3` | 增加分集原文确定性来源审计适配器和 UI | 可检查原文，但不生成剧情树或路线图 |
| `fb35f4d` | 增加规划审批状态机保护测试 | 新总纲版本会清理下游导入/规划状态 |
| `f44cd14` | 自动续写/恢复要求已批准规划 | 防止半完成规划刷新后偷偷生成 |
| `4ab3223` | 保留旧项目省略 `planningStatus` 的调用兼容 | 老项目不因新增字段直接失效 |
| `c0b168d` | 规划状态变化加入正文自动续写/恢复 effect 依赖 | 审批状态切换后前端守卫会立即生效 |

### 2.2 不要混淆的分支

- `main` 是较早的稳定研究基线，不含当前 `test1` 的全部输入识别和作者主权收口。
- `feature/cn-mainland-staged-generation` 是长篇大陆能力的另一条功能线，当前与 `test1` 不是同一条提交历史。
- `final1` 是历史快照，不是本次交接基线。
- `test1` 已推送到远程，但“已 push”不等于已经合并到 `main`，也不等于完成正式产品验收。

### 2.3 接手前第一组命令

```bash
cd /Users/simonriley/Downloads/docs
git switch test1
git status --short --branch
git log -3 --oneline --decorate
git rev-parse HEAD origin/test1
```

如果工作树不是干净状态，先确认改动归属；不要使用 `git reset --hard`、`git checkout --` 或其他会抹掉用户改动的命令。

---

## 3. 产品目标和不可改变的创作原则

### 3.1 产品目标

产品是“序幕 TV / 剧本大师（AI Comic Content OS）”，目标是帮助作者把长篇创作意图逐层展开为可编辑、可确认、可恢复的母本：

```text
创作输入
  ↓
输入完成度识别（建议，不改阶段）
  ↓
Story Bible / 故事总纲
  ↓
递归 Story Plan Node / 剧情树
  ↓
Episode Roadmap / 分集路线图
  ↓
有界正文批次
  ↓
连续性与故事线证据
  ↓
单集保存/确认
  ↓
全剧交付确认
  ↓
导出
```

当前“连续性与故事线证据”主要由前端的有界、本地/临时摘要和生成上下文承担；权威 Continuity Ledger 自动更新、跨批次 Context Mapper 和后台任务尚未完成。因此不能把当前摘要描述成已经具备无人值守的全剧连续性保证。

它不是“输入一段话后自动替作者写完整部剧”的黑盒。结构、节奏、篇幅、场景和对白数量是平台可以提供的骨架约束；故事方向、人物选择、价值判断、关键秘密、关系结果和结局必须由作者确认。

### 3.2 权威层级

项目数据中的创作事实要区分三种层级：

| 层级 | 含义 | 能否直接作为后续硬约束 |
|---|---|---|
| `canonical` | 用户明确写出、选择、保存或确认的内容 | 可以 |
| `derived` | 系统根据已确认内容计算出的结构、索引或连续性摘要 | 只能在来源仍有效时使用 |
| `provisional` | 模型建议、导入候选、未确认修订或审计结果 | 不可以，必须先审阅 |

必须遵守：

- 用户明确内容优先于模型建议、模板和默认值。
- 用户没有决定的高影响内容要保持“待定”，不能因为模型认为“合理”就变成事实。
- 导入结构是索引，不得覆盖作者原文。
- 生成失败、网络中断或解析不完整不能把项目标记为已确认。
- 旧项目没有新字段时保留兼容 fallback；不能为了新状态机删除旧数据。

### 3.3 对短剧参数限制的理解

场景数、对白数、镜头数和单集正文预算是防止模型后段偷懒的工程护栏，不是创作公式。后续调参时应优先保证：

- 每个场景有可见动作、冲突变化和退出状态；
- 每条被调度的支线有场景、动作和可验证状态变化；
- 对白数量是下限/目标的辅助指标，不替代戏剧价值；
- 不要通过统一套话填满数量；
- 需要增加数量时，应先增加因果和人物选择，再增加格式行数。

当前生产合同的主要范围来自 `backend/app/script_delivery_contract.py`：单集成片时长硬范围为 75–115 秒，偏好安全区为 90–105 秒；单集场景数为 1–5，镜头数为 15–20，对白行数为 25–35；系列运行时最低目标为 100 分钟。正文生成服务另有 45–135 秒的 hard fallback，用于异常/兼容输入的边界归一化，不能把它当作常规创作目标。

---

## 4. 技术架构总览

### 4.1 技术栈

- 前端：Next.js App Router、React、TypeScript、CSS、`lucide-react`。
- 后端：FastAPI、Pydantic v2、SQLModel、Psycopg 3、Alembic。
- 正式数据库：PostgreSQL；本地无 `DATABASE_URL` 时由启动脚本使用 SQLite。
- 本地项目状态：浏览器 IndexedDB，数据库名 `ai-comic-content-os`。
- 服务端同步：Project 元数据 + 50 MB 上限的 Workspace Snapshot，使用 revision/CAS 处理冲突。
- 长篇领域资源：Story Bible、Story Plan Node、Story Stage、Episode Plan、Continuity Ledger、Generation Task、Episode Artifact。
- 模型适配：OpenAI-compatible provider，支持 Chat Completions 和 Responses wire API；未配置真实模型时使用明确标记的 Mock 模式。

### 4.2 页面和模块入口

| 用户页面 | 主要组件 | 责任 |
|---|---|---|
| `/projects/new` | `frontend/app/projects/new/page.tsx`、`script-project-editor.tsx` | 新项目、原始输入、输入识别、集数设置 |
| `/projects/{id}/planning` | `StoryPlanningWorkspace`、`story-bible-panel.tsx` | Story Bible 生成/导入、编辑、保存、确认 |
| `/projects/{id}/planning/structure` | `StoryStructureWorkspace`、`story-plan-node-panel.tsx` | 剧情树、递归展开、路线图、保存、确认 |
| `/projects/{id}/workspace` | `script-workspace.tsx` | 正文批次、暂停/恢复、编辑、确认、导出 |

核心前端模块：

- `frontend/lib/types.ts`：`ScriptProject` 聚合和前端数据类型。
- `frontend/lib/workspace-stage.ts`：阶段访问和路由门禁。
- `frontend/lib/input-readiness.ts`：输入完成度响应解析。
- `frontend/lib/input-import-adapter.ts`：原始输入快照和基础集号检测。
- `frontend/lib/episode-plan-import-adapter.ts`：分集原文的确定性来源审计。
- `frontend/lib/episode-plan-materializer.ts`：分集原文到已批准叶节点的纯函数 staging 预览，以及作者确认后从完整来源字段构建待审阅路线图草稿；不写正文、不批准内容。
- `frontend/lib/story-planning-client.ts`：Story Bible、树、路线图 API 客户端。
- `frontend/lib/story-planning-state.ts`：总纲版本变化时的下游状态清理。
- `frontend/lib/generation-recovery.ts`：正文任务恢复和自动续写守卫。
- `frontend/lib/episode-delivery-confirmation.ts`：全剧交付确认快照和内容指纹。
- `frontend/lib/project-store.ts`、`project-sync.ts`：本地持久化、同步、冲突和旧 payload 兼容。

IndexedDB 数据按浏览器 profile 和 origin 隔离。清除站点数据、使用隐私窗口或更换 host/port 都可能得到一个新的本地工作区。服务端重启后，已保存的本地草稿仍可读取和导出；但如果临时 ContentSpec lineage 不再存在，新的 AI 修改、Deepening 或 Finalization 可能无法继续，需先恢复相应服务端资源。

核心后端模块：

- `backend/app/api/routes/story_projects.py`：长篇规划、工作区、任务和 Artifact API。
- `backend/app/modules/script_engine/long_story_models.py`：Pydantic 长篇合同。
- `backend/app/modules/script_engine/long_story_service.py`：领域服务。
- `backend/app/modules/script_engine/long_story_repository.py`：事务持久化、revision 和不可变版本。
- `backend/app/modules/script_engine/story_planning_service.py`：总纲、剧情树和路线图生成服务。
- `backend/app/modules/script_engine/generation_service.py`：正文生成和上下文编译。
- `backend/app/modules/script_engine/prompt_builder.py`：提示词和创作约束。
- `backend/app/modules/script_engine/continuity_qc.py`：连续性和故事线推进证据检查。
- `backend/app/modules/input_readiness/service.py`：启发式 + 模型辅助的输入识别。

### 4.3 持久化分层

```text
浏览器 IndexedDB
  └─ ScriptProject / episodes / local checkpoints
       ↓ optimistic local update
Project + Workspace Snapshot API
  └─ server revision / checksum / conflict

独立领域 API
  ├─ PlanningSession
  ├─ Story Bible / Story Plan Node / Episode Plan versions
  ├─ Generation Task checkpoints
  └─ Episode Artifact immutable milestones
```

不要把大型工作区快照、规划会话、生成任务和 Episode Artifact 当成同一个持久化对象。它们有不同的 revision、生命周期和恢复语义。

---

## 5. 当前完整工作流和门禁

### 5.1 输入完成度识别：建议式，不是跳级器

后端 `POST /input-readiness/analyze` 返回 `input_readiness.v1`，可识别：

- `premise`：梗概/创作意图；
- `story_bible`：总纲级材料；
- `episode_plan`：分集规划级材料；
- `script`：正文或接近正文的材料。

响应还包含 coverage、证据、缺失项、来源类型、检测集数、容量建议和 `recommendedStage`。识别失败时后端回退本地启发式；识别本身只读，不修改项目阶段。

用户必须明确选择：

- `selectedPath = recommended`：采用系统建议的整理路径；
- `selectedPath = full_workflow`：走完整人工流程。

即使是高完成度输入，推荐路径也不能伪造“总纲已确认”“规划已批准”或“正文已生成”。创建页和 readiness API 会从上传资料及创作提示中提取最高明确集号或显式区间终点，自动填入 `generationSettings.episodeCount`；支持 `第N集`、`Episode N`、`E/EP N`、中文数字和 `第01—33集` / `E01–E52` 等区间。不同标题数量仍用于缺号审计，不能代替最高集号。

### 5.2 Story Bible / 总纲

普通路径：

```text
生成草稿 → 作者编辑 → 保存 → 作者确认
```

高完成度总纲路径使用显式 `POST /story-projects/{id}/story-bibles/import-draft`：

- 后端强制 `preserve_source_document = true`；
- 注入“原文第一事实来源”的服务端提示词合同；
- 返回的 Story Bible 仍然是 `status=draft`；
- 原文保存到 `imported_source_document`；
- 不批准、不跳过规划、不直接进入正文。

Story Bible 确认后：

- `storyBibleStatus` 和 `storyBibleVersion` 更新；
- 人物、故事线和关系投影更新；
- `planningSession` 进入 `phase=story_tree, status=active`；
- 清空旧 `episodeRoadmaps` 和 `episodePlanImportDraft`；
- 跳转到剧情结构页。

总纲重新生成只允许在没有开始正文时进行。若已经有 episode，必须创建 rewrite version，而不是原地覆盖下游事实。

### 5.3 递归剧情树和分集路线图

剧情树不是固定深度或均匀分段的树。每个 `StoryPlanNode` 根据自身叙事复杂度决定：

- 继续拆分；或
- 进入 `episode_ready`，成为可直接指导正文的叶节点。

当前执行约束：

- 可执行叶节点通常覆盖 8–12 集；
- 少于 8 集或处于 13–15 集碎片范围的节点要回父层协调；
- 至少 16 集且叙事仍不完整的节点继续递归；
- 叶节点必须有事件链、选择后果、局部结算、退出状态和后续压力；
- 每个叶节点生成对应的单集路线图，路线图必须保留 Story Bible 和源节点版本 lineage。

规划页的所有重动作必须由按钮触发：

- 生成第一层剧情；
- 展开剧情树；
- 生成分集路线图；
- 保存规划检查点；
- 确认规划。

进入页面不会自动生成、自动展开或自动生成路线图。客户端的“一键继续展开”是有界、按钮触发的递归队列，不是后台无人值守 Job。

注意：前端 `EpisodeRoadmapItem`、后端 durable `EpisodePlan` 和后端 `EpisodePlanGenerationItem` 是三个不同层次的合同；不能把它们混用，也不能把来源审计行直接发给旧的 `/episode-plans` 写入接口。

### 5.4 规划保存和确认

`PlanningSession` 的主要阶段/状态：

| 阶段 | 典型状态 | 含义 |
|---|---|---|
| `creative_intent` | `idle/active` | 尚未形成总纲 |
| `story_bible` | `awaiting_review/active` | 总纲草稿审阅 |
| `story_tree` | `awaiting_review/active` | 剧情树审阅/展开 |
| `episode_roadmap` | `awaiting_review/active` | 路线图审阅 |
| `script` | `approved` | 规划锁定，正文可访问 |

保存按钮：

- 先同步 Workspace Snapshot；
- 同步成功后把 session 保存为 `active`；
- 允许继续修改。

确认按钮必须满足：

- 剧情树展开完成；
- 计划集数与 `generationSettings.episodeCount` 完整覆盖；
- 所有分集路线图已生成；
- 用户已经先保存过规划检查点；
- 同步没有冲突。

确认后设置：

```text
planningSession.phase  = "script"
planningSession.status = "approved"
```

确认会锁定规划，但不会自动发起第一批正文请求，也不会在 URL 上偷偷追加 `?generate=1`。

### 5.5 正文生成、续写和恢复

正文生成前会重新加载并检查：

- Story Bible 存在且为 `approved`；
- 当前 Story Plan Node 是批准的 `episode_ready` 叶节点；
- 当前 Episode Roadmap 与源节点、Story Bible 版本完全匹配；
- Episode Plan 和路线图覆盖当前批次；
- 当前集尚未被已有正文覆盖。

首次生成只能来自：

- 正文空状态的“生成下一部分”按钮；或
- 明确的 `?generate=1` 用户意图；或
- 用户明确重试当前批次。

进入正文页、刷新页面或正文为空本身不会触发首次生成。

已有正文后的自动续写只在以下条件同时成立时允许：

- `planningSession.phase === "script"`；
- 如果项目有持久化规划状态，则 `planningSession.status === "approved"`；
- 已有至少一集正文；
- 存在下一集可执行叶节点；
- 当前没有显式生成意图、忙碌任务、运行中的浏览器任务或未完成恢复任务。

旧项目若完全没有 `planningStatus` 字段，保留旧调用行为；一旦字段存在且不是 `approved`，自动续写/恢复会被阻止。

`GenerationRecoveryTask` 保存批次/任务 ID、revision、范围、尝试次数、完成集和失败集。每集边界保存检查点，恢复从当前 workspace 中第一个缺失集继续；暂停、完成、非瞬态错误不会被刷新自动重新启动。

### 5.6 单集编辑、确认和全剧导出

正文工作区区分：

- 当前工作稿；
- 用户本地编辑；
- AI 修改候选稿；
- 确认稿；
- 修订稿；
- 终稿。

AI 候选不能覆盖未保存的用户直接编辑。Episode Artifact 以 immutable 版本保存；服务端失败时保留本地稿，不把项目标记为已确认。

全剧导出前必须：

- 计划集数全部存在且集号连续；
- 每集都有可解析的已保存稿；
- 没有运行中的生成任务；
- `SeriesDeliveryConfirmation` 与当前内容指纹、Story Bible 版本、每集 draft 快照一致。

导出确认是整部统一确认，不强制用户逐集点一次确认。任何影响导出内容的更新都会清除旧交付确认并递增 `deliveryContentRevision`。

---

## 6. 本分支最近实现的功能详解

### 6.1 Story Bible 来源保留导入

相关文件：

- `backend/app/api/routes/story_projects.py`
- `backend/app/modules/script_engine/story_planning_service.py`
- `frontend/lib/story-planning-client.ts`
- `frontend/components/story-bible-panel.tsx`
- `frontend/lib/input-import-adapter.ts`

导入接口和普通草稿接口共享 Story Bible 合同，但服务端额外注入不可省略的导入约束。导入不是复制粘贴，也不是直接把原文当作已确认结构；它是一次模型辅助的“整理草稿”操作，必须回到普通编辑/保存/确认生命周期。

### 6.2 分集原文来源审计适配器

文件：`frontend/lib/episode-plan-import-adapter.ts`

该模块是确定性的、源保留的、只读的解析器，当前版本：

```text
schemaVersion:  episode_plan_import.v1
adapterVersion: heading-segment-v1
```

支持的集标题形式：

- `第1集`、`第 01 集`；
- `Episode 1`；
- `Ep 1`、`Ep.1`；
- 可带 Markdown 标题前缀和标题文本。

每个来源行保存：

- 原始集号和原文顺序；
- `heading`、`headingTitle`；
- `rawText`、`bodyText`；
- `sourceStart/sourceEnd`、`bodyStart/bodyEnd`；
- 识别到的字段和字段来源 span；
- 核心字段缺失列表；
- `complete/partial/unstructured` 完整度；
- 行级警告。

保守字段别名会映射到与路线图相近的字段，例如：目标、入口状态、中心冲突、主角决定、本集结果、结尾钩子、故事线、人物和场景。它不会把未标注的自然语言段落猜成结构化字段。

全局审计还会报告：

- 输入是否被 130,000 字符上限截断；
- 没有集标题；
- 集号重复；
- 集号乱序；
- 1 到最高集号之间的缺号；
- 超出最大集数限制；
- 空集段落；
- 无结构字段；
- 核心字段不完整；
- 字段标签重复。

`buildEpisodePlanImportDraft()` 还会对有界 `sourceDocument` 生成 SHA-256（不可用时 FNV-1a32）指纹。指纹是来源一致性守卫，不是安全认证。

### 6.3 分集原文审计 UI

文件：`frontend/components/story-plan-node-panel.tsx`

只有以下条件同时满足才显示“检查分集原文”：

- 输入识别已经完成；
- 用户选择了 `recommended` 路径；
- 检测级别为 `episode_plan` 或 `script`；
- 来源中检测到规范集标题；
- 规划尚未锁定。

点击后唯一的项目持久化写入是：

```ts
{ episodePlanImportDraft: draft }
```

UI 显示识别集数、缺号/重复、警告、前 12 个来源行、字段完整度和来源指纹。原文或 Story Bible ID/版本改变后，旧 draft 只显示为 stale，必须重新检查。

`buildEpisodePlanMaterializationDraft()` 随后把来源行映射到当前已批准的 `episode_ready` 叶节点。规划页先显示只读预览；作者点击“确认并保存草稿”后，才调用独立的 `POST /story-projects/{id}/episode-plan-materializations`。服务端在一个事务内重新校验原文 SHA-256/FNV-1a32 指纹、UTF-16 span、字段 provenance、当前 Story Bible lineage、叶节点状态/版本/range，以及现有路线图、Episode Plan 和正文占用。记录使用稳定 identity 幂等保存到 `episode_plan_materializations`，状态固定为 `draft`。

来源具备所有路线图必需叙事字段和人物引用时，前端同时创建可逐集编辑/批准的 `EpisodeRoadmapItem.status=draft`。时长、场景数来自项目生成设置，镜头和对白使用现有制作参数默认值；叙事字段只取作者原文。字段不完整时，独立审计记录仍可保存，但整批不创建路线图，不使用套话补缺口。

原文检查和只读预览明确不会发生的事情：

- 不创建 StoryPlanNode；
- 不创建或覆盖 Episode Roadmap；
- 不改 `planningSession`；
- 不改 `inputReadiness`；
- 不批准规划；
- 不生成正文；
- 不调用旧的 Episode Plan PUT 接口。

作者确认也不会创建或修改 StoryPlanNode、生成正文或设置 `approved`；Story Bible 新版本会清空当前工作区的旧 materialization receipt，服务端不可变记录仍保留供审计。

### 6.4 规划状态机和恢复门禁加固

最近三次修复的关键点：

1. 自动恢复和自动续写在有规划 session 时要求 `status=approved`。
2. `ScriptWorkspace` 的两个 effect 依赖规划 status，审批状态切换后不会继续使用旧闭包判断。
3. 对没有持久化规划 status 的旧项目保留兼容行为。
4. Story Bible 新版本、保存、确认和撤回会清除旧的分集原文审计 draft，避免跨版本复用。

### 6.5 全剧交付确认

`frontend/lib/episode-delivery-confirmation.ts` 建立可重复验证的系列交付快照：

- 计划集数和连续集号；
- 每集 draft ID、更新时间和内容指纹；
- Story Bible 版本；
- 项目内容签名；
- 交付 revision。

导出时重新计算并比对快照，任何内容变更都要求重新确认。

### 6.6 编剧质量第一步：解除固定节拍模板

最近一轮已在 `backend/app/modules/script_engine/prompt_builder.py`、`story_planning_service.py` 和静态知识目录中完成低风险修正：正文和路线图不再要求每集重复“压力-行动-回报-升级”循环，改为要求本集产生有事件证据的不可逆变化，并允许关系转折、失败后果、信息交换、追逐/救援、延迟回报和安静余波等不同戏剧机制。`body_order` 保留真实顺序，但不再要求机械交替。阶段归一化的缺失字段改成带阶段名称的 `待补充` 占位，应急分解的标签也已调整；其他 fallback 路径仍需继续审查，不能据此宣称通用默认叙事已全部消除。

本轮验证：`tests/test_prompt_builder.py` 10 passed；静态知识目录与提示词相关测试 22 passed；规划 fallback 定向测试 3 passed；Python `compileall` 通过。硬制作范围暂时保持不变，尚未完成按节奏形态调整场景/对白软目标的真实样本验收。

### 6.7 编剧质量第二步：可选编导设计

`dramatic_units` 和 `protagonist_cost` 已接入路线图生成、UI 编辑、保存、局部修改、Markdown 导出与批准后的正文请求。戏剧单位记录触发、人物做法、可见后果、变化类型和可选预期表演证据；个人代价仅从既有事件提炼。两项可留空，旧 `v1` payload 保持兼容，局部修改不能丢掉未涉及的设计，也不新增批准或 QC 门槛。完整字段契约见 [02_Data_Model.md](02_Data_Model.md)。

本步取消了审查初稿中“每集 3–7 个单位”的数量下限，七项仅为存储上限。它解决设计内容的保存与传递，尚未证明生成成品更有创意。确定性诊断与 Workspace 审阅面板见 6.8；五种节奏形态的固定计数基线已加入，下一步仍需真人盲评和软目标误报校准，再决定对白和动作数量门槛是否调整。

### 6.8 编剧质量第三步：非阻断成片诊断

`backend/app/modules/script_engine/episode_quality_review.py` 新增 `episode_quality_review.v1`。正文首次生成、编辑器处理完成和作者手工复审后，`generation_service.py` 都会重新计算报告并写入 Draft `llm_metadata`；它不改变 Story QC、Continuity QC、批准或 Finalization 门禁。

当前报告包括：

- `75–115` 秒、`1–5` 场、`25–35` 句对白、`15–20` 个动作单元的既有硬边界异常报警；
- 请求、拒绝、试探、撒谎、纠正、威胁、讨价、转移、承认、误解和沉默等有限关键词候选，并对连续四句已识别为同一功能的对白报警；
- 依据实际 `body_order` 四等分的 opening / complication / decision / exit 位置型信号；
- 可选 `dramatic_units` 和 `protagonist_cost` 的正文候选。规划摘要、场景目的、beat 和场景结果不能单独充当设计证据，选择与可见后果必须命中不同正文条目。

报告输出稳定的 `review_reasons`，候选与对白明细有固定上限并保留完整计数。所有文本和分段匹配都显式标记为非语义证明；缺少可选编导设计时只跳过设计证据检查，通用诊断仍执行。

Workspace 已在正文候选/状态信息下方接入可折叠审阅面板：摘要显示状态和提醒数，详情显示四项制作范围、对白功能覆盖与连续重复、opening / complication / decision / exit 四段候选，以及存在时的戏剧单位和人物代价证据。直接编辑正文后，面板会标记结果待刷新；手动保存会先调用现有 `reviewEpisodeDraft` 复审接口，再保存刷新后的 Draft 与 generation run。该界面仍是非阻断诊断，不是质量分数。尚未实现自动修改建议、软目标类型映射、真实模型 A/B 或真人编导校准。

---

## 7. 关键数据契约速查

### 7.1 `InputReadinessAnalysis`

```ts
{
  schemaVersion: "input_readiness.v1",
  detectedLevel: "premise" | "story_bible" | "episode_plan" | "script",
  recommendedStage: "story_bible" | "planning" | "script",
  confidence: number,
  coverage: {
    premise: number,
    storyBible: number,
    episodePlan: number,
    script: number,
  },
  missingItems: string[],
  evidence: string[],
  requiresUserConfirmation: boolean,
  analysisMethod: "heuristic" | "model_assisted",
  selectedPath?: "recommended" | "full_workflow",
  detectedEpisodeCount?: number | null,
}
```

它是建议数据，不是阶段状态机。

### 7.2 `EpisodePlanImportDraft`

```ts
{
  schemaVersion: "episode_plan_import.v1",
  adapterVersion: "heading-segment-v1",
  sourceDocument: string,
  sourceFingerprint: string,
  fingerprintAlgorithm: "sha256" | "fnv1a32",
  episodeHeadingSequence: number[],
  episodeNumbers: number[],
  missingEpisodeNumbers: number[],
  missingEpisodeCount: number,
  duplicateEpisodeNumbers: number[],
  outOfOrder: boolean,
  rows: ImportedEpisodePlanRow[],
  warnings: EpisodePlanImportWarning[],
  storyBibleId?: string,
  storyBibleVersion?: number,
  createdAt: string,
}
```

它是 `ScriptProject.episodePlanImportDraft` 的可选字段，属于 staging/audit 数据，不具有批准语义。

### 7.3 `PlanningSession`

```ts
{
  schemaVersion: "v1",
  phase: "creative_intent" | "story_bible" | "story_tree"
       | "episode_roadmap" | "script",
  status: "idle" | "active" | "awaiting_review" | "approved" | "paused",
  revision?: number,
  reviewedNodeIds: string[],
  turns: PlanningTurn[],
}
```

后端使用 extra-forbid、revision/CAS 和独立 API。不要只修改浏览器对象而不保存 session。

### 7.4 `GenerationRecoveryTask`

必须保留 batch/job identity、revision、范围和完成集列表。恢复逻辑以 workspace 已存在集为事实来源，重试同一集使用稳定的 agent request ID，避免重复创造新的请求身份。

### 7.5 `SeriesDeliveryConfirmation`

这是导出的交付快照，不是单集审批状态。任何导出相关字段变化都必须使其失效。

---

## 8. API 和数据流边界

### 8.1 主要 API 家族

长篇项目相关路由主要集中在 `backend/app/api/routes/story_projects.py`；输入识别单独位于 `backend/app/api/routes/input_readiness.py`：

- `POST /input-readiness/analyze`：只读输入识别（`input_readiness.py`）。
- `POST /story-projects/{id}/story-bibles/draft`：普通总纲草稿。
- `POST /story-projects/{id}/story-bibles/import-draft`：原文保留导入草稿。
- Story Bible 的 modify、save version、confirm/get。
- Story Plan Node 的 draft、top-level、decompose、modify、save version、list、quality audit。
- Episode Plan/roadmap 的 chunk、draft、modify、save、list/get。
- `POST/GET /story-projects/{id}/episode-plan-materializations`：作者确认后的独立来源审计批次与 lineage 查询。
- `PUT/GET /story-projects/{id}/planning-session`：规划会话。
- `PUT/GET /story-projects/{id}/generation-tasks/{job_id}` 和 `recoverable`：生成检查点。
- `PUT/GET /story-projects/{id}/workspace`：工作区快照。
- Episode Artifact 的创建、读取和列表。
- Continuity Ledger 的读取、审计、重建和回滚接口。

### 8.2 重要的 wire 合同警告

后端 Pydantic 模型大量使用 `extra="forbid"`。前端 `EpisodeRoadmapItem` 的审计/来源扩展字段不能未经转换就发给 `EpisodePlanGenerationItem`。新来源追踪应放在独立的 staging/provenance 结构中，不要向不认识它的旧领域模型塞未知键。

同理，不要把 `episode-plan-import-adapter` 的行对象直接当作后端 `EpisodePlan`；二者的版本、stage、node lineage 和批准语义不同。

---

## 9. 已知问题、风险和未实现能力

### 9.1 当前明确未实现

以下项目不要在交接时写成“已完成”：

- 已保存但字段不完整的分集 materialization 尚无独立表单补齐后再投影路线图；当前需修改来源资料并重新检查。
- 后台/无人值守 durable Story Planning Job、跨叶调度和自动批准（客户端按钮触发的有界递归展开已经实现）。
- 权威 Continuity Ledger 的自动提取、更新、冲突检查和 Context Mapper。
- Episode Artifact 的细粒度审计/恢复 UI。
- 故事线/人物关系的完整后端 authoring contract、future-only 影响分析和分支再生成。
- 动态知识检索、RAG、向量库和 Skill Registry。
- 统一 Script Generation Facade。
- 认证、多用户协作、账户级云空间。
- Storyboard、Voice、Animation、Video 和发布系统。

### 9.2 当前行为边界

1. **推荐路径不是跳级。** 高完成度输入仍然要经过草稿、保存、确认和规划门禁。
2. **确认规划不启动首批正文。** 这是当前代码行为；如果产品以后要求确认后自动生成，必须单独设计明确意图和回归测试，不能简单重新加 URL 参数。
3. **自动续写有两种语义。** 已有正文后的受控续写可以自动继续；首次生成不能因为页面加载自动开始。
4. **自动集数与来源覆盖是两个口径。** `input-import-adapter.ts` 和 readiness API 用最高明确集号/区间终点填充项目集数；`episode-plan-import-adapter.ts` 仍按实际来源行报告已提供数量、最高集号和缺号。自动填值不会伪造缺失的来源分集。
5. **规划状态来源较多。** `planningSession`、`storyBibleStatus`、`episodePlansReadyThrough`、`episodeRoadmaps` 和 `episodes` 共同决定页面可访问性，老项目还会走 legacy fallback。
6. **本地同步不是无冲突数据库。** IndexedDB 乐观保存后，服务端 revision 冲突只提示并保留人工处理，不做静默 last-write-wins。
7. **大服务文件仍存在。** `story_planning_service.py` 和 `generation_service.py` 很大；未完成验证前不要进行大规模拆分。
8. **真实长任务尚未完整验收。** 断网、暂停、恢复、供应商 429/5xx、长流式响应和跨批次连续性仍需真实环境测试。

容量口径也已明确：当前创建页的生产档位为 80,000–200,000 字，默认 140,000；后端 `StoryProject` 的 450,000 默认值保留兼容，600,000 只用于隔离容量验收。后两者不能作为当前 UI 的生产承诺。

### 9.3 已撤回的第一版 materializer 为什么不能恢复

第一版实验存在以下问题：

- 用通用默认句填充缺失的 `stage_opposition`、`episode_payoff` 等字段，会把系统套话伪装成作者内容；
- 字段 provenance 类型与实际写入值不一致；
- 未充分校验当前 source fingerprint、Story Bible lineage、叶节点版本和旧路线图冲突；
- 直接批量替换路线图可能误删同一 Story Bible 下后续项目数据；
- 没有严格 all-or-nothing 事务/预览边界。

第一版实验文件和临时类型已经撤回。当前同名模块是按独立领域记录、精确来源追踪和作者确认边界重新实现的版本；不要从旧提交恢复第一版逻辑，也不要绕过当前 API 直接覆盖路线图。

---

## 10. 推荐下一步计划

### P0：先锁定产品决策和安全契约

#### P0-1 确认规划后的首批正文策略

当前实现是“确认规划后进入正文，但必须点击生成”。如果产品负责人确认这一点保持不变，不需改代码，只需补浏览器验收；如果要自动开始，必须明确记录用户意图来源、刷新行为和失败恢复规则。

#### P0-2 分集原文 materializer（已完成首条安全闭环）

当前已完成 `buildEpisodePlanMaterializationDraft` 纯函数、规划页只读预览、作者确认 UI、独立领域 API、不可变持久化表、幂等重放和整批失败保护。预览保持 `status=staging`，确认后的领域记录和可用路线图保持 `status=draft`；任何路径都不自动批准或生成正文。

建议输入：

- 当前、未变更的 `EpisodePlanImportDraft`；
- 当前 source text 和 fingerprint；
- 当前已批准 Story Bible ID/version；
- 当前已批准 `episode_ready` 叶节点及其 exact episode range/version；
- 当前路线图和正文占用情况。

必须先做的硬校验：

- draft schema/adapter 版本受支持；
- source fingerprint 与当前文本一致；
- Story Bible lineage 一致；
- 行号无重复、无缺号、无越界、无乱序歧义；
- 每行恰好匹配一个已批准叶节点范围；
- 没有任何现有路线图或正文占用；
- 所有目标节点版本仍是当前版本；
- 任何失败都返回整批阻止，不部分写入。

预览输出必须是独立、可审阅的 staging draft：

- 原文字段和 span；
- 每个目标节点的 ID/version/episode range；
- field-level provenance；
- unresolved/review-required 字段；
- 冲突和缺失警告；
- 不产生通用默认叙事文本；
- 不设置 approved；
- 预览不写任何领域数据；作者确认后只在整批字段完整且目标未占用时新建待审阅路线图，不覆盖旧路线图，也不写正文。

只有作者在 UI 预览中确认并保存后才调用领域 API。当前实现没有使用旧的 Episode Plan PUT；后续重点是字段不完整批次的专用补齐界面和真实多叶节点浏览器验收。

#### P0-3 补状态机验收

至少覆盖：

- premise → Story Bible；
- 完整 Story Bible → 保存/确认；
- episode plan → 来源审计；
- 输入修改后旧审计 draft 失效；
- Story Bible 版本变化后下游失效；
- 规划未批准时刷新正文页；
- 规划批准后刷新正文页；
- 已有正文后的自动续写；
- 中断任务暂停、恢复和重复刷新；
- 全剧内容变化后旧交付确认失效。

### P1：把已实现结构变成可验证的编导质量

- 故事线职责完整持久化和审核：本集必须推进、可延期、延期原因、下一次义务、沉默集数。
- 结构化支线证据 QC：场景编号、可见动作、状态变化、前后状态和延期结论。
- 总纲、规划、正文编辑器抽象统一，但保持现有 UI 语义和旧 payload 兼容。
- 已区分“已提供集数数量”和“最高集号”：创建页自动填入最高明确集号，来源审计继续对缺失集号给出明确补齐提示。
- 用受控长任务样本验证暂停时钟、流中止、检查点恢复和已完成集不重复生成。

### P2：架构和维护性

- 在测试保护下拆分超大服务文件；
- 统一硬编码中文文案和国际化键；
- 建立混合输入、不连续集号、中英文材料的 fixture 库；
- 建立项目状态迁移图和旧 payload 样本；
- 在正式验收通过后再考虑合并 `main`、打 tag 或开启更大能力。

---

## 11. 开发、启动和验证手册

### 11.1 安装

```bash
cd /Users/simonriley/Downloads/docs
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"

cd frontend
npm install
cd ..
```

### 11.2 环境变量

真实值放在根目录 `.env.local`，不要提交：

- `LLM_PROVIDER`、`LLM_MODEL`、`LLM_API_KEY`、`LLM_BASE_URL`；
- 规划角色和正文角色的 `LLM_*` 配置；
- `SCRIPT_MARKET_PROFILE=cn_mainland`（当前默认）；
- `SCRIPT_CREATIVE_DEEPENING_ENABLED=false`；
- 生产使用 PostgreSQL `DATABASE_URL`。

没有真实模型配置时，启动脚本使用 Mock provider。不要把 Mock 结果描述成真实模型质量验收。

### 11.3 启动本地前后端

```bash
./start-local.sh
```

默认：

- 前端：`http://127.0.0.1:3000`；
- API 文档：`http://127.0.0.1:8000/docs`；
- 未设置 `DATABASE_URL` 时：`.cache/local-runtime/my-comic.db`。

启动脚本会执行 Alembic migration、初始化前端开发资源并启动 uvicorn 与 Next。生产环境必须显式使用 PostgreSQL；SQLite 只适用于本地/测试。

### 11.4 原交接轮验证范围

以下保留初始交接的验证范围记录，不是永久禁止项目维护者运行测试。2026-09-06 继续实施可选编导设计的定向测试与隔离浏览器检查另记于 11.6；没有执行后端全量或真实模型长任务。原交接建议执行：

```bash
cd frontend
npm run typecheck
cd ..
git diff --check
if [ -d frontend/.next ]; then find frontend/.next -depth -delete; fi
```

原交接未纳入范围的检查：

- `npm test`；
- `npm run build`；
- Playwright/E2E；
- 后端全量测试；
- 对 `frontend/node_modules`、`frontend/.next`、`.cache`、`.venv`、`evaluation` 的扫描或修改。

后续测试应按工程手册与实际改动范围执行；真实模型验收需记录模型、参数、Prompt 版本、失败率、token 和延迟。

### 11.5 本次交接前验证记录

| 检查 | 结果 | 备注 |
|---|---|---|
| `cd frontend && npm run typecheck` | 通过 | 本次收尾已执行 |
| `git diff --check` | 通过 | 本次收尾已执行 |
| `frontend/tests/generation-recovery.test.mjs` 定向测试 | 12/12 通过 | `c0b168d` 变更时已记录 |
| `frontend/tests/episode-plan-materializer.test.mjs` 定向测试 | 3/3 通过 | 本轮新增纯函数与 staging 预览保护测试 |
| `tests/test_prompt_builder.py`、`tests/test_knowledge_bundle.py` | 22/22 通过 | 本轮节奏契约与静态知识回归 |
| `tests/test_story_planning_service.py` | 178/178 通过 | 本轮缺失阶段占位与应急分解回归 |
| `tests/test_long_story_models.py`、`tests/test_episode_layer_contracts.py` | 38/38 通过 | 本轮结构合同回归 |
| `.next` 清理 | 已完成 | 不把缓存当源码 |
| 前端全量 `npm test` | 未执行 | 当前测试约束未放宽 |
| `npm run build` | 未执行 | 当前测试约束未放宽 |
| Playwright/浏览器点击回归 | 未执行 | 仍是交接风险 |
| 后端全量测试 | 未执行 | 不在本轮范围 |
| 15 分钟以上真实长任务 | 未执行 | 需要真实模型和独立验收方案 |

相关测试文件（尚不能仅凭“文件存在”宣称全量通过）：

- `frontend/tests/episode-plan-import-adapter.test.mjs`
- `frontend/tests/episode-plan-materializer.test.mjs`
- `frontend/tests/state-machine-gates.test.mjs`
- `frontend/tests/planning-approval-workflow.test.mjs`
- `frontend/tests/generation-recovery.test.mjs`

### 11.6 可选编导设计收尾验证（2026-09-06）

- `npm run api:check`、`npm run typecheck`、`git diff --check` 通过，OpenAPI 已与前后端类型同步。
- 后端 `test_long_story_models.py`、`test_script_engine_models.py`、`test_long_story_api.py`、`test_story_planning_service.py`、`test_prompt_builder.py`、`test_episode_layer_contracts.py` 共 `313 passed`；正文请求保留设计的单项测试也通过。修复新增 16 个真实 service 测试，覆盖单集/批量修复省略字段时保留有效设计、显式清空，以及拒绝继承结构错误或非中文设计。
- 前端新字段执行映射、旧制作预算、Markdown 导出定向检查 `9 passed`。
- 隔离组件与完整规划页浏览器检查通过：桌面/手机显示、新增、编辑、删除、可选值清空、长度校验、锁定、撤销和本地刷新恢复。实际页面检查同时修复了外层 `details` 阻止内部“戏剧单位”展开的问题。页面测试采用临时浏览器存储、合成项目和被拦截的 API，不等于真实服务器同步或真实模型端到端验收。
- 本轮前端 dev server 使用 `http://127.0.0.1:3000`，保留运行所需 `.next` 缓存；没有运行生产 build 或全量 `npm test`。

扩大到相邻的三个前端测试文件时存在 5 项旧失败，已在 `git archive HEAD` 的隔离副本复现（`27 passed, 5 failed`），未修改无关业务：路线图就绪范围、同步连续检查点、两项过时的交互源码断言、规划导出旧 fixture 缺少 `character_refs`。不得把本轮定向通过描述为全仓回归通过。

本轮只验证设计信息能够被作者审阅并传到正文，未运行真实模型 A/B 或真人盲评，不能据此宣称已经降低成品的 AI 味。

### 11.7 非阻断成片诊断验证（2026-09-07）

- `tests/test_episode_quality_review.py`：`10 passed`，覆盖旧计划兼容、正文与规划摘要隔离、选择/后果不同条目、人物代价、制作数量区间、连续四句同功能对白、英文词边界和持久化明细上限。
- 连同 `tests/test_continuity_qc.py`、`tests/test_episode_layer_contracts.py`、`tests/test_script_generation_service.py` 回归：`136 passed`。
- 后端全量：`927 passed, 1 skipped`。
- `frontend/tests/episode-quality-review.test.mjs`：`4 passed`，覆盖严格解析、异常 payload 拒绝、Workspace 面板接线和手动保存前复审刷新。
- `npm run api:check`、`npm run typecheck`、production build、Python `py_compile` 与 `git diff --check` 通过。production build 保留一项既有 `::highlight(...)` CSS 解析警告，不影响构建完成。
- 隔离浏览器检查通过：桌面折叠/展开状态和 `390x844` 手机视口均无横向溢出或内容重叠，手机端制作指标和分段信号按两列显示。
- 前端全量 `npm test` 为 `305 passed, 15 failed`。新增诊断测试全部通过；其余失败集中于既有 Node 路径别名/模块解析和旧路线图、就绪状态、导出及 Workspace 源码断言，尚未把 15 项逐一在纯 HEAD 基线复现，因此不能记录为全量通过。
- 没有运行真实模型 A/B 或真人质量评审；当前结果只证明报告生成、保存刷新和展示链路成立，不能证明成品已经减少 AI 味。

### 11.8 上传资料集数自动提取验证（2026-09-07）

- 创建页本地检测与 readiness API 均以最高明确集号、区间终点或显式总集数作为项目集数边界，支持阿拉伯数字、中文数字、`第N集`、`Episode/E/EP N` 和常见区间连接符。
- 项目总集数与来源覆盖已分离：`第1集`、`第3集` 自动填入 `3`，但证据仍报告只找到 2 个逐集编号；单独的 `第01—33集` / `EP34–EP52` 区间声明返回边界 `52`，不会伪造52条逐集内容。
- `frontend/tests/input-readiness.test.mjs`：`5 passed`；`tests/test_input_readiness.py`：`17 passed`；TypeScript 与 `git diff --check` 通过。
- 真实创建页验证通过：上传包含 `第01—33集` 的文件后“剧集数量”自动填入 `33`；使用者手动改为 `12` 后不会被自动检测覆盖。重启后的 `http://127.0.0.1:8000/input-readiness/analyze` 已按真实请求契约返回相同边界结果。

### 11.9 分集原文物料化安全闭环验证（2026-09-07）

- 后端全量回归：`940 passed, 1 skipped`；其中长篇模型、Repository、API 和 migration 定向组合为 `83 passed`。覆盖独立不可变记录、幂等重放、过期节点整批拒绝、永久删除和数据库表升级。
- 前端相邻规划回归：`49 passed`，其中 materializer `5 passed`；覆盖来源 span/provenance、过期来源与 lineage 阻止、缺失字段不补写、完整来源投影为 `draft` 路线图，以及不完整批次零路线图。
- `npm run api:check`、`npm run typecheck`、production build 和 `git diff --check` 通过。production build 仍报告既有 `::highlight(...)` CSS 解析警告，但构建完成。
- 本地 SQLite 已升级到 `20260907_0011`。隔离浏览器端到端检查完成作者预览与确认、IndexedDB 草稿保存、后端 materialization 读取、远端 workspace 同步和刷新恢复；记录与路线图均为 `draft`，没有批准或正文生成。临时项目验收后已永久删除。
- `390x844` 手机视口已验证规划文档可完整滚动，`scrollWidth=viewportWidth=390`，没有横向溢出或 Copilot 遮挡。此次未重跑前端全量测试，也未运行真实模型长任务。

---

### 11.10 全栈修复与检查（2026-09-07）

- 后端全量 `963 passed, 1 skipped`；前端全量 `371 passed, 0 failed`；桌面/手机 Playwright `14 passed`。API 合同、TypeScript、production build 和差异检查通过。
- 修复导入等待期间覆盖并发编辑、过期祖先节点接受导入、异常占用快照返回 500、项目恢复只读前 100 项、SSE 跨分块解析/资源清理、首集刷新恢复与预检查错误提示，以及手机正文工具栏横向溢出。
- 首次正文仍需作者明确操作；暂停、完成和待审阅状态不会因刷新自动启动。质量诊断仍为非阻断审阅信号。
- 本地后端已重启并恢复两条市场路径的开发资源，重启前后均可读取 5 个已有项目。没有执行真实模型长任务或修改用户剧本内容。
- 问题证据、测试边界、构建警告和后续验收见 [24_FULL_STACK_ENGINEERING_REVIEW.md](24_FULL_STACK_ENGINEERING_REVIEW.md)。11.6–11.9 保留为先前验证快照，不再代表最新全量测试结果。

### 11.11 海外路径真实抽样（2026-09-07）

- 按用户指定海外路径运行隔离探针，修复真实供应商拒绝 `$ref` 旁 `default` 的严格 Schema 错误。后端全量 `979 passed, 1 skipped`；之后探针定向检查 `15 passed`。
- 修复后完成 1/3 集：首集 1,189 有效正文字符、462.211 秒，30 句双语对白结构与前端转换通过；第 2 集触发全轮 900 秒时限，第 3 集未启动。
- 原样阅读发现钥匙归属冲突、未发生转运被标成已完成、证据推断过强。机器检查通过不能视为长篇质量验收。三轮海外请求共 9 次，只有首集返回 28,172 tokens 用量，其余未知。
- 完成集跨进程幂等读取无需模型调用，稳定业务结果一致；检查点省略调试提示词和原始输出，不应要求完整响应逐字相同。未验证未完成集的断点续传。
- 新脚本、复现命令、证据和后续重点见 [25_OVERSEAS_REAL_GENERATION_PROBE.md](25_OVERSEAS_REAL_GENERATION_PROBE.md)。用户作品保持原状，原始样本未被修改为合格结果。

### 11.12 连续性修复与海外速度复测（2026-09-07）

- 增加同集明确持有人冲突和未来转移被标为已完成的警告，修复转交物品被整体判为不可用；诊断截断前保留阻断项，避免大量警告使硬冲突漏出。更新集末状态、证据确定程度和海外翻译提示要求。
- 后端全量 `1010 passed, 1 skipped`，探针专项 `15 passed`。原始海外失败样本在本地复检中准确产生 2 条警告；不升级 Gate、不改正文样本或公共 API。
- 用户批准 medium、最多 6 次请求及 15 分钟隔离复测；最终完成 2/3 集、2,907 正文字符。首集最终耗时减少约 25.5%，但调用 tokens 增加约 29.9%，不能宣称成本降低。另遇空流和连接中断，第三集重试触及时限。
- 两集在新进程中零模型调用读回一致，前端双语转换通过。日常 high 配置保留，本地后端继续承载修复后的诊断。
- 探针只提供前集摘要，没有完整结构化临时账本；已纠正初次报告的传播证据表述。正文阅读仍发现因果与译文问题，详细证据、用量和下一轮边界见 [26_OVERSEAS_CONTINUITY_AND_LATENCY_RETEST.md](26_OVERSEAS_CONTINUITY_AND_LATENCY_RETEST.md)。

### 11.13 海外产品账本接线与离线验证（2026-09-07）

- 海外探针直接复用产品 TypeScript 状态投影、压缩账本及本集记忆召回，保存后重新读回 Workspace；后续请求严格要求此前连续草稿。正文仍为 provisional。
- 修复同一物品的一层类型前缀漂移、账本类别被挤空、同键不同状态域被误去重，以及时间约束的召回优先级。没有新增模型调用或修改原始海外样本。
- 两集历史正文在隔离数据库原样保存/读回，第 3 集请求构造及记忆进入结构化提示词通过；不能计为第三集真实生成。压缩 QC 账本仍有省略项，模型召回与 QC 的覆盖范围必须分开报告。
- 前端全量 `383 passed`，Python 相关专项 `58 passed`，TypeScript 通过。下一步为有界重试与失败集恢复验收。命令、证据及范围见 [27_OVERSEAS_PRODUCT_CONTINUITY_WIRING.md](27_OVERSEAS_PRODUCT_CONTINUITY_WIRING.md)。

### 11.14 海外重试与恢复故障验收（2026-09-07）

- 适配器保留结构化输出错误的同步回退历史，后处理不重复已耗尽的空响应恢复；推理预算耗尽不再原样重复 SSE；浏览器尾部 JSON 截断进入有界断流重试，完整坏 JSON 和回调错误保留原分类。
- 通过实际适配器、传输计量、Agent 和 SQLite 的故障注入验证：部分流失败后同步恢复、共享请求上限、失败第二集复用初稿检查点、完成第一集在独立进程中不重新生成。全部供应商响应为测试数据，无新增真实模型调用。
- 后端全量 `1019 passed, 1 skipped`、前端全量 `387 passed`，TypeScript 通过。第 2 步工程验收完成，六步方案还剩 4 步；下一步为正文语义审阅。边界和复现命令见 [28_OVERSEAS_RETRY_AND_RECOVERY_ACCEPTANCE.md](28_OVERSEAS_RETRY_AND_RECOVERY_ACCEPTANCE.md)。

### 11.15 海外正文语义审阅与验收标准（2026-09-07）

- 审阅已有两集全部 60 对中英对白、34 项动作，按正文顺序核对批准计划、知识状态和结尾义务，保留原文及来源指纹。样本为需修订，发现 5 组 P2、2 组 P3；不是编导盲评，也没有生成第三集。
- 追溯确认第一集后处理添加了缺少动机依据的指责，第二集证据含义和账本超前问题原已存在。编辑器增加只读场景因果上下文；提示要求保留译文程度、区分时间字段、交代信息来源及会面达成证据。原输出字段保护和 provisional 边界保持。
- 后端全量 `1020 passed, 1 skipped`，编辑器/提示词专项 `41 passed`，`git diff --check` 通过。零真实模型调用，没有前端改动；上一轮前端 `387 passed` 与 TypeScript 记录未重复执行。
- 第 3 步完成，剩三集真实复测、八集单元验收和生产化共 3 步。提示改动是否改善实际正文尚待真实复测，完整证据与验收表见 [29_OVERSEAS_SEMANTIC_ACCEPTANCE_REVIEW.md](29_OVERSEAS_SEMANTIC_ACCEPTANCE_REVIEW.md)。

### 11.16 海外三集真实复测（2026-09-07）

- 加载账本、恢复与语义提示修正后，在新 SQLite 运行海外路径，预算最多 6 次请求、900 秒。实际仅发起首集的 1 次 `gpt-5.6-sol` medium 请求，未形成初稿检查点或正文制品，900 秒总时限保护终止进程组，0/3 完成。
- 该请求用量和 HTTP/首字节时点未知。保留原始日志与中断数据库，以独立 `watchdog_result.json` 记录退出后重建的结论，不将原日志或数据库改成虚构的供应商失败响应。
- 新增 POSIX 独立进程组总时限保护；发现并补齐响应头/首字节即时落盘和生成前 manifest。相关专项 `19 passed`，没有追加真实请求或改动日常配置。生产服务代码未变，未重复全量后端/前端测试。
- 第 4 步执行但未通过，仍剩 3 步。下一步先定位海外请求长期不结束的阶段，三集通过后再进入八集。范围、原始证据和复现命令见 [30_OVERSEAS_THREE_EPISODE_RETEST.md](30_OVERSEAS_THREE_EPISODE_RETEST.md)。

### 11.17 海外流式终止修复与短输出诊断（2026-09-07）

- 复现并修复 `[DONE]`、Responses 终止事件后继续等待连接的问题；先采集 usage/id，Chat 继续保留 stop 后的独立 usage。明确 failed/incomplete/cancelled 不再因 JSON 可解析而被当成成功结果。
- 一次真实海外短诊断：`gpt-5.6-sol` medium，HTTP 200，8.374 秒返回精确预期 JSON，已知 4,461 tokens。限定 1 次请求、90 秒，不写项目数据库、不运行正文或编辑阶段，日常 high 配置不变。
- 原始探针记录把正常迭代器关闭的 `GeneratorExit` 误标为传输错误；保留原始证据，随后修正 meter 并以两条协议的实际适配器加假传输回归验证，没有再调用模型。全量后端 `1029 passed, 1 skipped`，相关专项 `133 passed`。
- 短输出成功不能证明三集质量，历史 900 秒阻塞原因仍不能唯一确定；无 terminal 的持续心跳仍需要生产累计时限。六步方案仍剩 3 步，下一步按原有界预算复测三集。证据、限制及命令见 [31_OVERSEAS_STREAM_TERMINATION_DIAGNOSIS.md](31_OVERSEAS_STREAM_TERMINATION_DIAGNOSIS.md)。

### 11.18 流式修复后的三集真实复测（2026-09-07）

- 使用新隔离 SQLite、相同三集规划、修复后的适配器和 meter，限定 6 次请求、900 秒。实际发起 3 次，0/3 集完成，无初稿检查点或正文制品。
- 首个 medium SSE 请求 9.305 秒收到 HTTP 200，在解析 12,535 个结构化文本字符后于 671.610 秒读取超时；后续 SCRIPT_REPAIR 非流式 high 请求在 131.680 秒返回 524，其重试被 watchdog 终止。medium override 仅覆盖正文主角色，不能把整轮称为统一 medium 对照。
- 三次用量均未知，没有可审阅新正文。原日志和数据库保持中断快照，独立 `watchdog_result.json` 保存退出后重建结论与证据指纹。零请求预检、运行源码指纹和配置不变检查通过；未修改运行代码或重复全量回归。
- 额外核对发现固定规划的时间比较字段、诺拉信息来源、场景内外标记和作者事实/角色知识边界存在歧义，下一轮修订需版本化，不能把输入缺口全部归因于正文。第 4 步仍未通过，优先补累计请求截止与流进度诊断，再做单集验证，仍剩 3 步。详见 [32_OVERSEAS_POST_FIX_THREE_EPISODE_RETEST.md](32_OVERSEAS_POST_FIX_THREE_EPISODE_RETEST.md)。

### 11.19 累计时限、响应进度与进度口径（2026-09-08）

- 实现同步 HTTP/1.1 的累计 I/O 时限，覆盖持续 SSE 注释、慢滴响应头和无换行正文；适配器操作及 Key 池排队受限，初稿主请求、格式修复和非流式恢复共享父预算。请求上限默认沿用角色 `TIMEOUT_SECONDS`，初稿链路默认 900 秒，均可显式配置。
- 到限产生不可自动恢复的 `deadline` 错误；拒绝迟到结果，不继续换 Key 或请求恢复。Agent 保存失败，普通 API/SSE 使用 `local_deadline_exceeded` 并明确不可重试，避免被覆盖成输入或结构化输出问题。
- 新增不含正文的首响应/首文字/可见推理/最后活动时点和计数，探针 manifest 记录时限覆盖与新增源码指纹。此处字符和字节不是 token 用量，也不是有效剧本正文；活动日志无停流期间的后台定时输出。
- 零真实模型调用。后端全量 `1061 passed, 1 skipped`，前端相邻 `27 passed`；本地后端已重启并恢复大陆/海外资源，API/前端 200，5 个现有项目及 `.env.local` 指纹不变。原始失败样本未修改。
- 将“剩 3 步”明确为三个大阶段，新增逐项进度表：本轮完成的是累计时限与诊断修复；测试规划歧义修订、海外单集验证及三集验收仍待推进。下一项先版本化澄清规划，再按用户已授权的最多 6 次请求、15 分钟验证单集，不新增审批环节。
- 当前保护不等于完整单集/后台作业的统一硬时限；DNS、多地址连接、自定义同步传输与回调只能在返回后检查，远端停止计费无保证。HTTPX 私有接点及依赖升级限制、测试命令见 [33_OVERSEAS_DEADLINE_AND_PROGRESS_GUARDS.md](33_OVERSEAS_DEADLINE_AND_PROGRESS_GUARDS.md)。

### 11.20 新版规划与海外单集验证（2026-09-08）

- 保留默认 v1，新增 `--fixture-version v2` 显式澄清比较时间、人物获知证据渠道、仓库场景位置、作者/角色知识和姐姐生前签字。旧版规划指纹测试通过，新版契约及集间入口/出口一致；manifest 记录版本和父版本，历史输入未覆盖。
- 预检请求为 0，定向测试 `23 passed`。真实单集在 224.063 秒完成，整轮 225.961 秒，只调用 1 次 `gpt-5.6-sol` medium；有效正文 1,241 字符，已知用量 25,380 tokens，无未知用量，金额未核账。配置为请求累计 600 秒、初稿链路 840 秒、整轮 watchdog 900 秒、最多 6 次请求，本轮未触及限制或调用恢复/编辑角色。
- 独立 SQLite 有 1 个 completed Agent、2 个检查点、1 个 provisional 草稿制品。新进程重放稳定结果一致，模型调用为 0；前端双语转换 62 个唯一路径、无警告。没有产品运行代码或用户作品改动。
- 本集文本审阅仍为 `revise`：付款截图在开场大屏显示，账本却记为未公开，且原样进入 provisional Workspace；另有开场屏幕指代和一处译文行为主体的 P3 问题。时间比较、钥匙交接和转运未发生的状态一致，不能用这些通过项覆盖前述缺陷。
- 当前完成的是“规划澄清”和“单集生成/保存/重放”，三集仍未验收。下一项处理公开状态一致性及两项局部修订，保留原稿和修订 lineage，再进入三集。完整证据、指纹和范围见 [34_OVERSEAS_VERSIONED_SINGLE_EPISODE_ACCEPTANCE.md](34_OVERSEAS_VERSIONED_SINGLE_EPISODE_ACCEPTANCE.md)。

### 11.21 公开状态一致性与已知问题修订（2026-09-08）

- 生成提示的两条 EpisodeContext 路径共用公开状态契约；编辑及语言窄修复保留具体行为主体与公开范围。新增同集非阻断 warning，定位有限明确公开展示与笼统未公开状态冲突；私人预览、计划/否定/转述、无人/遮挡、同名材料等反例覆盖。
- 第 34 号样本的 S01–S03 在副本显式修订，8 处内容字段 before/after 与来源指纹保存。经过既有 review-draft 重新计算诊断，独立 revised/provisional 制品指向源草稿，原稿、原始数据库和日常配置保持不变。
- 正式结果在 `.cache/real-generation-probe/overseas-single-editorial-final-20260908/`；原稿新诊断 1 条 warning，修订稿 0 条。修订状态经过产品 Workspace 投影、保存/读回，并进入第二集检查点及结构化提示词；第二集只构造请求，没有生成。
- 本轮 0 次模型请求，全量后端 `1084 passed, 1 skipped`，专项 `103 passed`，前端双语数据转换 62 个唯一路径、0 警告。后端已重启加载修复并恢复两市场开发资源。
- 下一项恢复 v2 三集真实验收，预算沿用最多 6 次物理请求、15 分钟。不得将显式编辑修订冒充新提示生成结果；诊断和提示本身不证明模型未来输出无语义错误。完整记录见 [35_OVERSEAS_DISCLOSURE_REVISION_AND_GUARDS.md](35_OVERSEAS_DISCLOSURE_REVISION_AND_GUARDS.md)。

### 11.22 新提示下海外 v2 三集真实验收（2026-09-08）

- 使用新目录和独立 SQLite，从首集重新生成，未注入人工修订稿。预算沿用最多 6 次请求、900 秒；实际 4 次 `gpt-5.6-sol` medium 请求，900 秒 watchdog 退出 124，完成 1/3 集。第二集无完整稿或初稿检查点，第三集未启动。
- 首集 514.050 秒、1,401 正文字符、3 场/16 动作/30 对对白。初稿估算 61 秒，第一次编辑补至 139 秒，第二次压缩至 93 秒；两次编辑约 215 秒、24,401 tokens。前三次合计已知 52,766 tokens，第二集 usage 缺失，整轮总用量和金额未知。
- 新首集公开范围与账本一致，上轮问题未重现。语义审阅仍为 revise：已核实两小时时差却在两个人物知识中标为 disproved，原样进入第二集实际请求；另有滑动页面前先质问、中文“通报时间”含义模糊两处 P3。自动连续性 QC 为 passed/0 warning，不能代替本次审阅。
- 第一集有 1 个 draft/provisional 制品及 2 个完整检查点；跨进程稳定结果重放通过，0 次模型调用，前端双语转换 62 个唯一非空字段通过。隔离数据库残留第二集 running 状态，但进程已停止，不是活跃后台任务。
- 原始 summary 是首集保存后的快照，不能代表最终整轮请求数；最终退出证据另存 `watchdog_result.json`，不改原始日志与正文。20 个运行源码指纹、日常配置和 5 个用户项目完整响应指纹均未变。本轮无产品代码改动，未重复全量测试。
- 本项实测已经执行完毕但未通过。下一项先零调用修复知识 statement/status 一致性和时长编辑反馈，处理明确局部修订点；修复后再做新有界实测。本轮不得继续追加请求或把人工修订算成自动质量通过。详见 [36_OVERSEAS_V2_THREE_EPISODE_ACCEPTANCE.md](36_OVERSEAS_V2_THREE_EPISODE_ACCEPTANCE.md)。

### 11.23 知识状态、编辑时长反馈与修订验证（2026-09-08）

- 新增两条 EpisodeContext 路径共用的 KnowledgeStatusContract，明确 status 针对 statement 自身和人物集末认知；另一个假说未证实不能把观察到的时间差记成 disproved。两个机械归一化入口对五种合法知识状态原样保留的回归通过，没有采用自动将疑似冲突改成 known 的规则。
- 新增保守同集 warning，定位明确确认陈述与 disproved 标签冲突；覆盖转述、计划、条件、后续更正、不同数字及多角色同知识键等边界。原稿新诊断 2 条 warning，修订稿 0 条；不是完整语义门禁，不改变保存/审批权限。
- 编辑提示增加整集/固定场景/可编辑场景的秒数预算和增减上限；61 秒真实初稿的新反馈为目标增加约 29 秒、最多增加 54 秒。保留 75–115 秒接受范围，内部目标使用 90–105 秒推荐区间；固定场景使局部目标不可达时扩大编辑范围。请求次数、token 上限和推理配置不变。
- 修复编辑成功或直接检查通过后仍保留旧 deferred 状态的问题，清理过期原因并显式记为 false；源稿的编辑 gate 历史仍保留，失败路径继续 deferred。
- 修订脚本新增 --correction-set report36，保留 report34 默认兼容。正式目录 `.cache/real-generation-probe/overseas-knowledge-editorial-final-20260908/` 完成 6 处显式修订及来源关联；两人物 known 状态经产品保存、读回、检查点、记忆召回和第二集结构化提示验证，原稿及源数据库不变。没有生成第二集。
- 本轮零模型调用。后端全量 `1134 passed, 1 skipped`，知识/提示/生成相关 `215 passed`、编辑器 `35 passed`、脚本 `7 passed`；独立双语转换 62 个非空唯一字段、0 网络调用。后端已重启、两市场资源恢复，5 个用户项目与日常配置指纹不变。
- 本项离线修复完成；下一项验证新提示是否真正减少编辑过冲并完成三集。仍不能把修订稿或单元测试当成自动生成质量通过。详见 [37_OVERSEAS_KNOWLEDGE_AND_DURATION_GUARDS.md](37_OVERSEAS_KNOWLEDGE_AND_DURATION_GUARDS.md)。

### 11.24 知识与时长修复后的海外三集实测（2026-09-08）

- 固定 v2 规划、新隔离 SQLite，从第一集开始，未注入人工修订稿。900 秒 watchdog 退出 124，实际 4 次请求，完整保存 2/3 集；第三集有请求和流式输出，但没有完整稿或初稿检查点。没有超出已授权预算或追加请求。
- 第一集 332.052 秒、1,613 正文字符，时长 73 → 103 秒，一次编辑约 84 秒；第 36 号对应 514.050 秒、两次编辑。两人物已核时时差正确为 known，并进入第二集请求。第二集 499.251 秒、1,281 正文字符、77 秒，无编辑，正文实际推进到工单冲突和诺拉会面。
- 三次已完成请求已知 69,430 tokens（输入 51,961、输出 17,469），第四次用量未知。没有可核对的整轮金额，不按字符外推完整作品费用；单次初稿差异也不足以证明稳定的优化收益。
- 首集仍有 3 项 P3：手机页面切换、双手机取景保存方式、编辑新增 Both times matter 的量词译文。第二集有 1 项 P2：亚当退远后才到达的家族禁令未显示传达，却写入其确定知识；另有已发送身份和工单说明却声称只发身份的 P3。第二集自动两条 capability_conflict 来自把证人保护和公开决定权误当身体能力限制，不算真实人物冲突；原始 QC 保留。S01–S05 仅审阅定位，尚未修订，详见 38 号报告。
- 原始库有 2 个 completed Agent、4 个完整检查点、2 个 draft/provisional 制品和第三集 stale running 行，本地进程已停止。原始 summary 是第二集保存快照，最终中断事实另存 watchdog_result.json。
- 在独立证据副本重放前两集，稳定业务结果相同、0 次模型请求；仅排除 3 个被检查点省略的调试字段。前端双语转换为 62/63 个唯一非空字段、0 网络调用；不是新 DOM 测试。原始数据库、20 个运行源码、日常配置及 5 个用户项目指纹不变。
- 本轮无产品代码修改，未重复全量回归，沿用第 37 号 `1134 passed, 1 skipped`。API 和前端 200，日常 running Agent 为 0。正式证据目录 `.cache/real-generation-probe/overseas-three-v2-knowledge-duration-20260908/`，重放副本为 `overseas-three-v2-knowledge-duration-replay-20260908/`。
- 三个大阶段仍是三集、八集、生产化；本次可量化进展是完整保存从前次 1/3 到 2/3，以及首集少一次编辑。下一项先修订问题并补带来源校验的探针续跑，再补第三集，不持续从首集重跑。当前 `--verify-replay` 只重放已完成结果，不能续生成。续跑不等于单轮 15 分钟性能通过，生产化仍须完整作品和账单证据。详见 [38_OVERSEAS_KNOWLEDGE_DURATION_REAL_ACCEPTANCE.md](38_OVERSEAS_KNOWLEDGE_DURATION_REAL_ACCEPTANCE.md)。

### 11.25 前两集修订、来源校验续跑与第三集补测（2026-09-08）

- 用户已明确优先级：创意质量、一致性和连续性第一，速度也很重要，不考虑 token 消耗。后续速度优化以实际用时和无效重写为依据，必须保持创意和连续性；token、用量完整性及金额仅作原始日志和历史事实保留，不参与优化、验收或推进判断。
- 第 38 号 S01–S05 已修订，E1/E2 各 4 处显式变更，另存 revised/provisional 制品并验证读回。原始 27 个文件和原始制品保留；身体能力诊断不再把证人保护、调查授权和公开决定权当作身体行动限制。生成及编辑提示补充知情来源、设备操作、实际发送内容和量词约束。
- 隔离探针新增 `--resume-from`、`--revised-dir` 与逐文件 SHA-256 来源变更白名单，复制原始数据库、校验规划/请求/检查点/制品/Workspace，并仅在副本退役无完整检查点的旧第三集 Agent。`--episodes` 为总目标，不是新增集数；本次来源固定为第 38 号原始目录加正式 v3 修订包，不支持任意层级续跑链。
- 仅补第三集，332.767 秒、3 次物理请求、43,977 tokens，未触及 6 次/900 秒预算。E3 为 3 场、16 动作、30 对对白、1,632 有效正文字符，估时 79 → 113 秒。两次 gpt-5.6-sol 请求加一次 deepseek-v4-flash 标题窄修复；历史加本轮已知 113,407 tokens，原中断请求用量和累计金额仍未知。
- 三集内容齐备，来源为前两集人工修订加第三集新生成。副本共 6 个完整检查点、3 个 draft/provisional 和 2 个 revised/provisional 制品；三集零调用恢复通过，继承修订稿按制品与 Workspace 读回，E3 按检查点重放。正式补测目录为 `.cache/real-generation-probe/overseas-third-resumed-20260908/`。
- 第三集仍为 `revise`：N01 未执行证人要求的距离条件；N02 亚当无传递来源却被记为知晓，还混淆姐姐归属。另有表演顺序、编辑扩大保证、未登记伏笔引用和持久印记误用四项 P3。自动 QC 为 0 blocking、1 warning，编辑 passed 不代表语义验收通过；错误知识已进入第三集保存后的 Workspace。
- 最终后端全量 `1226 passed, 1 skipped`，前端 typecheck 与相邻 10 项通过；三集双语转换 62/63/63 个唯一非空字段、0 warnings、0 网络调用。本轮没有新浏览器验收。补测期间 20 个记录源码稳定，探针 runner 落盘更新过一次，启动与结束指纹分别保留；最终源码已完成离线回归与零调用重放，不能声称全部 21 个文件整轮被冻结。
- 本轮已按用户指定停在补测、审阅和报告，没有修订新发现的 E3 问题、追加模型请求或启动八集。下一轮先处理 N01/N02 及其余局部问题；三集质量验收仍未通过，依据是正文与状态中的创意、人物一致性和连续性问题，费用不构成验收条件。详细证据、限制和路径见 [39_OVERSEAS_RESUME_AND_THIRD_EPISODE_ACCEPTANCE.md](39_OVERSEAS_RESUME_AND_THIRD_EPISODE_ACCEPTANCE.md)。

### 11.26 生成前约束、第三集修订与 20 万字记忆优化（2026-09-08）

- 用户追加：优先用准确提示和上下文一次写对，减少重复检查与重写；整体审查记忆系统并支撑最多 20 万字，继续保持质量、一致性、连续性优先，重视速度，不考虑 token 消耗。
- 第三集 N01–N06 已另存正式 `overseas-three-report39-revised-v3-20260908/`，51 个显式字段变更，原稿及前两集不变。包含诺拉旧知识键的额外修复；只有这份 v3 用于修订结果。第四集仅输出交接上下文，因未批准 E4 规划而 `generation_ready=false`。
- 生成提示补充知情来源、距离边界、状态字段和动作顺序；标题问题单独进行精确字段修复。离线回归只变 3 个标题，正文与账本不变，没有新增模型审稿。
- 先后 high 514.160 秒、medium 293.667 秒，均 1 次请求、零重写，但距离和旧键问题仍在。根因是最终提示丢失具体知识键和第二集实际距离对白，不能靠继续增加通用提醒解决。
- 记忆优化完整保留键值与来源，取消前后端 30/50 条历史截断；产品和探针共用最后一场真实正文交接；世界状态修订撤回旧派生事实，同时保留作者附加信息。恢复工具保留历史请求并单列新版投影，批准规划仍不可变化。20 万字/120 集合成样本的早期知识、原始约束、来源和序列化均通过验证，不代表完整长篇创意验收。
- 最新 E3 正式目录 `overseas-report40-memory-medium-20260908/`：345.009 秒、1 次 gpt-5.6-sol medium、零编辑/重写，1237 正文字符、76 秒估时。最终实际模型提示包含 22 条带来源知识及“马路对面”；距离承接、进一步退远和原知识键更新改善。仍有隔街隔窗通信未交代、对白连接因果不顺、反复协商与人物表达偏弱，三集质量仍未通过。
- 27 个源码在该次实测中未变；运行后两项兼容修正的零调用重投影与实际输入一致。原始来源、修订包、保存制品和 Workspace 核对通过。此前 high 样本已完成零调用重放；最新样本核对保存与输入，没有再次重复全部重放。
- 后端全量 `1253 passed, 1 skipped`，随后相邻 135 项通过；前端 `391 passed`，typecheck、API 契约和 diff 检查通过。未新增 DOM 或 production build 验证。日常服务已重启，前端/API 200，5 个用户项目记录与配置指纹不变，日常 running Agent 为 0；未提交或推送。
- 本轮完成修复、验证与报告，未启动八集或完整 20 万字真实生成。详细作品证据见 [40 号报告](40_OVERSEAS_QUALITY_AND_HEADING_REPAIR.md)，记忆整体审查与能力边界见 [41 号报告](41_LONG_STORY_MEMORY_AND_PROMPT_INPUT.md)。

### 11.27 提示前表演约束与第三集性能补测（2026-09-08）

- 海外正文提示新增通信渠道、已接受条件直接兑现、结尾事实必须先在 `body_order` 演出后才能写入账本/钩子，以及揭示后的即时后果约束；探针新增有效海外 SCRIPT 路由的 mock 防误判门禁。
- 第三集最终真实补测目录为 `.cache/real-generation-probe/overseas-report42-performance-medium-v6-20260908/`：`gpt-5.6-sol` medium，1 次请求，294.143 秒，1,505 有效正文字符，0 blocking/0 warning，语言契约通过。首项动作先建立通信；伊芙放弃抢先发布机会，结尾在姐姐线索后写下即时调查选择。前两集仍为继承修订稿，不把本轮称作一次三集全新生成。
- 具体表演问题已改善；独立作品层复核尚未完成。`episode_quality_review` 仍是位置型审阅信号，不能替代人工判断；暂不因一次样本启动八集。
- 新增报告为 [42_OVERSEAS_PROMPT_FIRST_PERFORMANCE_ACCEPTANCE.md](42_OVERSEAS_PROMPT_FIRST_PERFORMANCE_ACCEPTANCE.md)。下一步先独立复核三集人物声音、情绪和因果推进，再决定八集单元验收。

## 12. 接手者安全操作清单

### 开始工作前

- [ ] 确认分支为 `test1`，且 `HEAD` 与 `origin/test1` 的关系明确。
- [ ] 阅读本文件、`00_AI_Engineer_Guide.md`、`21_Current_Status_Checklist.md`。
- [ ] 检查工作树，不覆盖用户已有改动。
- [ ] 阅读目标文件和对应测试，再决定实现边界。
- [ ] 确认本次工作是“修复/文档/新增能力”中的哪一种，不把诊断自动扩展成重构。

### 修改代码时

- [ ] 优先使用 `apply_patch`。
- [ ] 新字段优先 optional，保持旧 payload 可读取。
- [ ] 任何生成/导入候选都标记为 draft/provisional，不能直接 approved。
- [ ] 任何跨版本来源都保留 ID、version、fingerprint 和 created-at。
- [ ] 不把未知 provenance 字段塞进 `extra=forbid` 的后端模型。
- [ ] 不用默认套话填补作者未决定的高影响内容。
- [ ] 不直接调用旧的 episode-plan 写入接口做批量 materialization。

### 提交前

- [ ] `git diff --check`。
- [ ] `cd frontend && npm run typecheck`。
- [ ] 清理 `frontend/.next`。
- [ ] 更新本文件或 21 状态清单中的实现/未实现边界。
- [ ] 提交信息说明真实行为，不把 staging 写成 production。
- [ ] 推送前确认没有 `.env.local`、API Key 或用户资料。

### 交接完成时

- [ ] 写明 commit hash、分支和远程同步状态。
- [ ] 写明实际运行过的测试，未运行的不要省略。
- [ ] 写明遗留风险和下一步的第一条安全动作。

---

## 13. 给下一位实现者的第一条建议

不要从“如何把原文一次性塞进剧情树”开始。第一步应是先写一个纯函数契约和固定 fixture：输入当前 `EpisodePlanImportDraft`、批准叶节点和路线图占用情况，输出“可审阅 mapping draft 或明确阻止原因”，且在任何失败时不触碰项目状态。等这个函数能证明来源、版本、范围、冲突和 unresolved 字段都正确，再接 UI 预览，最后才考虑 API 写入。

这样可以继续保持本分支最重要的设计目标：模型帮助作者加速工作，但不会在作者看不见的地方替作者决定故事。
