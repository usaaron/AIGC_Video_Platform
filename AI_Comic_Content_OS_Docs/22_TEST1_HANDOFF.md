# AI Comic Content OS / `test1` 分支交接文档

> 文档版本：`test1-handoff.v1`
> 交接快照：2026-09-05（Asia/Shanghai）
> 工作目录：`/Users/simonriley/Downloads/docs`
> 当前分支：`test1`
> 当前提交：`c0b168d`
> 远程：`origin/test1`（与本地 `HEAD` 同步）

本文是交给下一位工程师、编导产品负责人或审查者的独立交接资料。它描述的是当前代码真实具备的能力、当前安全边界、最近变更、验证记录和下一步实施条件。它不替代以下权威文档：

- [工程协作手册](00_AI_Engineer_Guide.md)：开发规范、测试规则和架构变更权限。
- [当前状态清单](21_Current_Status_Checklist.md)：全项目能力状态、实验性能力和长期未实现项。
- [系统设计](01_System_Design.md)、[数据模型](02_Data_Model.md)、[API 设计](05_API_Design.md)：正式领域契约。
- 根目录 [README.md](../README.md)：安装、启动和产品边界。

如果本文件与代码或正式契约不一致，以代码、API/Pydantic 契约和 `21_Current_Status_Checklist.md` 的最新内容为准，并在发现差异后补正文档。

---

## 1. 一句话结论

`test1` 是从 `creative-sovereignty-v1` 基线继续加固的长篇剧本创作工作流分支。它已经把“输入识别 → 总纲草稿 → 递归剧情树 → 分集路线图 → 有界正文生成 → 保存/确认 → 全剧导出”的主要门禁和来源追踪补齐到可审阅状态，并清除了首次进入页面时的隐式生成行为。

当前最重要的边界是：

> 高完成度分集原文可以被检查、分段、标出字段和缺口，并保存为 `episodePlanImportDraft`；它还不能安全地直接变成 `StoryPlanNode`、`EpisodeRoadmapItem` 或已批准正文计划。

此前尝试的“原文直接物料化”初稿因可能伪造默认文案、来源追踪不足和覆盖旧路线图，已撤回，没有进入当前分支。下一位接手者必须把这条边界当作硬约束，而不是把 UI 上的“检查分集原文”理解成“已完成导入”。

---

## 2. 当前 Git 状态与交接基线

### 2.1 分支和提交

当前状态：

```text
branch: test1
HEAD:   c0b168d
remote: origin/test1 -> c0b168d
status: clean
```

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
- `frontend/lib/story-planning-client.ts`：Story Bible、树、路线图 API 客户端。
- `frontend/lib/story-planning-state.ts`：总纲版本变化时的下游状态清理。
- `frontend/lib/generation-recovery.ts`：正文任务恢复和自动续写守卫。
- `frontend/lib/episode-delivery-confirmation.ts`：全剧交付确认快照和内容指纹。
- `frontend/lib/project-store.ts`、`project-sync.ts`：本地持久化、同步、冲突和旧 payload 兼容。

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

即使是高完成度输入，推荐路径也不能伪造“总纲已确认”“规划已批准”或“正文已生成”。已有集标题用于辅助集数识别；当前基础检测返回“识别到的不同集号数量”，不等于最高集号，缺号由审计适配器单独报告。

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

进入页面不会自动生成、自动展开或自动生成路线图。

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

明确不会发生的事情：

- 不创建 StoryPlanNode；
- 不创建或覆盖 Episode Roadmap；
- 不改 `planningSession`；
- 不改 `inputReadiness`；
- 不批准规划；
- 不生成正文；
- 不调用旧的 Episode Plan PUT 接口。

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

后端路由集中在 `backend/app/api/routes/story_projects.py`：

- `POST /input-readiness/analyze`：只读输入识别。
- `POST /story-projects/{id}/story-bibles/draft`：普通总纲草稿。
- `POST /story-projects/{id}/story-bibles/import-draft`：原文保留导入草稿。
- Story Bible 的 modify、save version、confirm/get。
- Story Plan Node 的 draft、top-level、decompose、modify、save version、list、quality audit。
- Episode Plan/roadmap 的 chunk、draft、modify、save、list/get。
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

- 分集原文 → 已批准 `episode_ready` 叶节点 → 可审阅路线图草稿的安全 materializer。
- 后台 durable Story Planning Job、自动递归、跨叶调度和自动批准。
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
4. **识别集数和最高集号不同。** `input-import-adapter.ts` 的基础检测返回不同集号数量；`episode-plan-import-adapter.ts` 同时报告最高集号和缺号。
5. **规划状态来源较多。** `planningSession`、`storyBibleStatus`、`episodePlansReadyThrough`、`episodeRoadmaps` 和 `episodes` 共同决定页面可访问性，老项目还会走 legacy fallback。
6. **本地同步不是无冲突数据库。** IndexedDB 乐观保存后，服务端 revision 冲突只提示并保留人工处理，不做静默 last-write-wins。
7. **大服务文件仍存在。** `story_planning_service.py` 和 `generation_service.py` 很大；未完成验证前不要进行大规模拆分。
8. **真实长任务尚未完整验收。** 断网、暂停、恢复、供应商 429/5xx、长流式响应和跨批次连续性仍需真实环境测试。

### 9.3 已撤回的 materializer 方案为什么不能恢复

第一版实验存在以下问题：

- 用通用默认句填充缺失的 `stage_opposition`、`episode_payoff` 等字段，会把系统套话伪装成作者内容；
- 字段 provenance 类型与实际写入值不一致；
- 未充分校验当前 source fingerprint、Story Bible lineage、叶节点版本和旧路线图冲突；
- 直接批量替换路线图可能误删同一 Story Bible 下后续项目数据；
- 没有严格 all-or-nothing 事务/预览边界。

因此该实验文件和临时类型已经从工作树移除。除非重新设计并通过纯函数测试、契约审查和 UI 预览验收，不要从旧提交中直接恢复。

---

## 10. 推荐下一步计划

### P0：先锁定产品决策和安全契约

#### P0-1 确认规划后的首批正文策略

当前实现是“确认规划后进入正文，但必须点击生成”。如果产品负责人确认这一点保持不变，不需改代码，只需补浏览器验收；如果要自动开始，必须明确记录用户意图来源、刷新行为和失败恢复规则。

#### P0-2 设计分集原文 materializer（只做纯函数和预览）

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
- 没有现有正文或批准路线图冲突；
- 所有目标节点版本仍是当前版本；
- 任何失败都返回整批阻止，不部分写入。

输出应是独立的、可审阅的 staging draft：

- 原文字段和 span；
- 每个目标节点的 ID/version/episode range；
- field-level provenance；
- unresolved/review-required 字段；
- 冲突和缺失警告；
- 不产生通用默认叙事文本；
- 不设置 approved；
- 不直接写正文或覆盖旧路线图。

只有作者在 UI 预览中确认并保存后，才考虑调用领域 API。不要使用旧的 Episode Plan PUT 作为批量导入接口。

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
- 区分“已提供集数数量”和“最高集号”，对缺失集号给出明确补齐提示。
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

### 11.4 当前默认验证规则

在没有用户额外放宽测试范围前，执行：

```bash
cd frontend
npm run typecheck
cd ..
git diff --check
if [ -d frontend/.next ]; then find frontend/.next -depth -delete; fi
```

当前约束下不要自行运行：

- `npm test`；
- `npm run build`；
- Playwright/E2E；
- 后端全量测试；
- 对 `frontend/node_modules`、`frontend/.next`、`.cache`、`.venv`、`evaluation` 的扫描或修改。

如果用户明确放宽限制，再按工程手册运行与改动范围相称的测试，并记录模型、参数、Prompt 版本、失败率、token 和延迟。

### 11.5 本次交接前验证记录

| 检查 | 结果 | 备注 |
|---|---|---|
| `cd frontend && npm run typecheck` | 通过 | 本次收尾已执行 |
| `git diff --check` | 通过 | 本次收尾已执行 |
| `frontend/tests/generation-recovery.test.mjs` 定向测试 | 12/12 通过 | `c0b168d` 变更时已记录 |
| `.next` 清理 | 已完成 | 不把缓存当源码 |
| 前端全量 `npm test` | 未执行 | 当前测试约束未放宽 |
| `npm run build` | 未执行 | 当前测试约束未放宽 |
| Playwright/浏览器点击回归 | 未执行 | 仍是交接风险 |
| 后端全量测试 | 未执行 | 不在本轮范围 |
| 15 分钟以上真实长任务 | 未执行 | 需要真实模型和独立验收方案 |

新增的测试文件（尚不能仅凭“文件存在”宣称全量通过）：

- `frontend/tests/episode-plan-import-adapter.test.mjs`
- `frontend/tests/state-machine-gates.test.mjs`
- `frontend/tests/planning-approval-workflow.test.mjs`
- `frontend/tests/generation-recovery.test.mjs`

---

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
