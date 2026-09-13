# AI Comic Content OS

AI Comic Content OS 支持中国大陆与海外两条创作路径。创作者界面保持中文；中国大陆路径使用简体中文和中国大陆文化背景，海外路径使用海外/国际文化背景并沿用既有中英对照交付格式。

当前剧本核心目标是把用户创作意图可靠展开为完整长篇：故事总纲 → 可变深度递归剧情树 → 分集计划 → 有界正文批次 → 连续性校验 → 完整 `MasterScript`。目标规模通过可暂停、可编辑、可恢复的多批次生成完成，不通过单次超长模型调用完成。

项目已纳入下一阶段的[分镜与前期制作交付方案](AI_Comic_Content_OS_Docs/44_PREPRODUCTION_STORYBOARD_PLAN.md)：在正文之后增加“分镜”，由系统生成视觉方案、文字资产设计、图片／视频提示词和版本化交付包，用户阅读、修改和确认。实际图片、语音、视频生成与剪辑由下游团队负责。该方案尚未进入运行代码，不增加无限画布，也不代表现有界面已经具备分镜功能。

## Current Stage

项目处于 `Capability Optimization / System Validation`。

当前市场路径：

- 默认新项目路径：`SCRIPT_MARKET_PROFILE=cn_mainland`
- 输入页的“发行地区”可以为每个项目选择中国大陆或海外；启动时会初始化两条路径的运行资源
- 暂停：Creative Deepening 前后端运行开关默认关闭，界面不展示入口；代码和历史数据兼容位保留
- 已完成基础：Story Project、Story Bible、无固定层级且允许各分支不同深度的递归 Story Plan Node、兼容故事阶段、Episode Plan、Continuity Ledger、批次检查点契约，以及 PostgreSQL / JSONB schema、Alembic migration 和事务型 Repository
- 已接入后端资源 API：Story Project、Frontend Workspace Snapshot、Story Bible、递归 Story Plan Node、故事阶段和 Episode Plan 的版本化保存与读取
- Frontend 已采用 IndexedDB 本地优先 + PostgreSQL Workspace Snapshot 服务端同步；冲突不静默覆盖，删除使用版本保护的服务端软归档
- Frontend 项目按自身市场路径保存；中国大陆和海外项目可以在同一个中文创作工作区中并存
- 创作者界面固定使用中文；海外项目生成时按海外/国际文化契约规划，并保留既有中文动作说明、英文对白和中文翻译交付格式
- 已接入 Episode Artifact 里程碑：确认稿、规则修订稿和终稿按不可变服务端版本保存并保留来源 lineage
- 已接入 runtime：Story Bible、可变深度递归 Story Plan Node、episode-ready 叶子到 Episode Plan，以及三类规划对象的草稿编辑、immutable version 保存和人工批准
- 隔离容量验收脚本已支持按当前剧情分支深度优先执行递归拆分、叶子计划、叶子正文和本地连续性快照；尚未接入正式 runtime 的是后台可恢复执行、权威 ContinuityLedger 自动更新、人工审批编排和服务端跨批次自动续跑
- 尚未实现：完整 40–50 万字档母本的无人值守自动生成

当前已经跑通：

```text
Creative Intent / Character Context
→ ContentSpec
→ Mainland Long-form Static Knowledge Bundle
→ Story Bible
→ Recursive Story Plan Node
→ Episode Plan
→ Prompt / Static Knowledge
→ DraftMasterScript
→ Story QC
→ Revision / Re-QC
→ Acceptance Shadow
→ Finalization
→ FinalMasterScript
```

Frontend MVP 支持本地项目、中国大陆分类标签与用户自定义标签、角色，以及唯一的“故事总纲 → 递归剧情树 → 分集计划 → 有界基础剧本批次”流程。总纲、每个草稿剧情节点和每份分集计划均可编辑、保存和批准；正文支持分集编辑、AI 修改、修订、终稿与导出。大陆“灵感推荐”是需用户主动选择的静态策划建议，不是实时平台热榜。工作区按项目所选的 10 万字量级档统计动作与对白正文。Creative Deepening 代码保留，但当前前端隐藏、后端拒绝执行。

当前重要边界：

- Story QC 仍是实验性 Rubric，不代表专业剧本评审结论。
- Revision 仍以规则式受控修改为主。
- Acceptance 当前是 shadow 信号，不阻断 Finalization；Creative Deepening 当前默认关闭。
- 基础剧本由前端在已批准 Episode Plan 叶子的当前有界批次内调用单集 Draft API，并保存本地 batch lineage；可选编号正文 Key Pool 通过现有 `LLMAdapter` 提供服务端轮换。它不等同于后台 Job 或整部长篇自动生成。
- 真实模型适配器支持 `chat_completions` 和 `responses` 两种 wire API；Responses 模式可通过环境变量设置 low / medium / high 推理强度，实际支持程度由所选网关和模型决定。
- 字数量级仪表用于量化当前正文产量与投影，不代表系统已通过全量长篇一次性验收；目标只累计已经生成到具体集的动作与对白有效字符，不含 Story Bible、剧情树大/小分支、Episode Plan/单集线路图、人物说明、空格、标点和 JSON 格式符号。规划节点显示的正文预算不等于已生成字数。
- 当前压力样本已证明 Story Bible 和根节点能形成合法结构，但“摘要合法、覆盖目标范围”不等于故事内容足以支撑数百集。全量生成前的当前优先事项是验证可持续 Story Engine、宏观叙事运动、悬疑信息控制、反派策略、支线贡献和内容支持的容量区间。
- 中国大陆长篇生成请求会按总正文目标与计划集数计算 optional 单集正文预算；系统推荐集数根据已生成正文集均动态延长后续有界批次，累计达标后停止。手动集数保持硬停止，当前仍不是无人值守后台长任务。
- 项目工作区先保存到浏览器 IndexedDB，并在配置 PostgreSQL 时同步完整版本化 Workspace Snapshot；确认稿、修订稿和终稿另存不可变 Episode Artifact。没有数据库或服务暂时不可用时可继续本地编辑，但同步冲突必须人工处理。
- 中文界面的英文剧本对照翻译是 presentation artifact，不修改正式英文剧本。
- 分集 Agent 已接入正文和路线图的有界运行与检查点；动态 RAG、视频生产和统一 Script Generation Facade 尚未实现。
- 当前标签系统已提供大陆受控目录和项目自定义关键词，但尚未实现标签来源证据库、Tag Knowledge Profile、自定义标签项目级即时语义库或 Data Intelligence 实时热门接入。
- 当前大陆通用静态知识 bundle 已约束总纲、递归剧情树、分集计划和基础剧本，内容只来自受治理的跨平台原则；它不等于动态知识检索、完整中国市场知识库或 RAG。
- 当前大陆 bundle 主要提供场景/单集基础原则，尚未覆盖完整长篇规划专业知识。新增的 source-grounded 长篇知识条目暂存 Research，必须通过固定 A/B 和人工审阅后才能进入 runtime。
- 已支持“创作描述或受控 Ontology 标签至少填写一项，人物 optional”：Prompt-only 保留用户原文，Tag-only 由后端生成带 provenance 的故事方向，不再伪装为用户 Prompt；confirmed CustomTagContext-only 仍待实现。
- 标签上下文未来主要服务可审阅的 Story Synopsis / Story Direction；确认后再进入 Story Bible、递归规划和长篇展开，不能用标签堆叠直接替代长篇规划。
- 人物关系网和故事线树是 Story Bible / Planning / Continuity 的辅助投影视图；修改默认只影响指定未来节点或集数，历史内容不会自动同步改写。显式历史调整需要影响分析、新版本和可审计再生成。
- 长篇审核目标为“故事总方向确认 + 关键递归节点确认 + episode-ready 规划批次确认”，而不是固定卷级审核。递归拆分由模型按叙事复杂度选择不同子节点，不固定四等分或统一深度；系统只允许 8–12 集的完整单位剧情成为叶节点，至少 16 集的分支必须继续递归，1–7 集或 13–15 集碎片必须回到父层连同事件、状态交接和范围一起协调。每个叶节点先讲清因果事件链、局部结算和后续压力，再生成并确认单集线路图，最后按单集顺序生成正文；项目的执行批次偏好不改变剧情树叶节点门禁，分集线路图也不计入正文字符。

完整实现状态见 [21_Current_Status_Checklist.md](AI_Comic_Content_OS_Docs/21_Current_Status_Checklist.md)。本轮企业架构审查与实现记录见 [51_MODULE_UPGRADE_EXECUTION.md](AI_Comic_Content_OS_Docs/51_MODULE_UPGRADE_EXECUTION.md)。

## Quick Start

### 1. Install

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"

cd frontend
npm install
cd ..
```

### 2. Configure Real LLM (Optional)

直接编辑项目根目录的 `.env.local`：

```dotenv
LLM_PROVIDER=openai_compatible
LLM_MODEL=your-model-name
LLM_API_KEY=your-api-key
LLM_BASE_URL=https://your-provider.example/v1
LLM_TIMEOUT_SECONDS=300
LLM_MAX_RETRIES=2
LLM_PLANNING_TIMEOUT_SECONDS=300
LLM_PLANNING_MAX_RETRIES=1
LLM_PLANNING_REASONING_EFFORT=high
LLM_PLANNING_MODEL=your-model-name
LLM_PLANNING_WIRE_API=responses
# Optional faster profile for episode body generation:
# LLM_SCRIPT_MODEL=your-fast-model-name
# LLM_SCRIPT_REASONING_EFFORT=medium
# LLM_SCRIPT_TIMEOUT_SECONDS=600
# LLM_SCRIPT_MAX_RETRIES=1
# Episode body repair/recovery stays on the configured script model. Optional
# LLM_SCRIPT_REPAIR_* values may tune its timeout/key pool without changing output rules.
# LLM_SCRIPT_REPAIR_MODEL=your-fast-model-name
# LLM_SCRIPT_REPAIR_REASONING_EFFORT=low
# LLM_SCRIPT_REPAIR_WIRE_API=responses
# Optional fallback editor: when market-specific routes are not configured, the
# generic script profile can still use a separate post-editor model.
# LLM_SCRIPT_EDITOR_PROVIDER=openai_compatible
# LLM_SCRIPT_EDITOR_MODEL=your-gpt-model-name
# LLM_SCRIPT_EDITOR_API_KEY=your-gpt-api-key
# LLM_SCRIPT_EDITOR_BASE_URL=https://your-gpt-provider.example/v1
# LLM_SCRIPT_EDITOR_WIRE_API=responses
# SCRIPT_GPT_POST_EDIT_ENABLED=true
# Optional second inference host. All three values are required together and
# the primary and alternate model names must match.
# LLM_SCRIPT_ALTERNATE_MODEL=gpt-5.6-sol
# LLM_SCRIPT_ALTERNATE_API_KEY=your-key-for-the-alternate-host
# LLM_SCRIPT_ALTERNATE_BASE_URL=https://your-second-provider.example
# LLM_SCRIPT_ALTERNATE_WIRE_API=responses
SCRIPT_MARKET_PROFILE=cn_mainland
SCRIPT_CREATIVE_DEEPENING_ENABLED=false
DATABASE_URL=postgresql+psycopg://user:password@127.0.0.1:5432/ai_comic_content_os
```

生产配置按项目市场路径分流：总纲与规划的对话式修改统一使用 `deepseek-v4-pro`；大陆正文及正文修改使用
`deepseek-v4-pro`，海外正文及正文修改使用 `gemini-3.6-flash`。Grill Me 使用 `gpt-6-astra`，所有 Astra 角色在
请求可恢复失败或超时后自动切换 `deepseek-v4-pro`，Astra 长规划单次请求上限 120 秒、Grill Me 45 秒；
网络失败或超时后冷却 600 秒，后续调用再探测 Astra。DeepSeek Pro 有独立请求预算，外层任务总时限仍然有效。
正文默认一次生成，连续性、语言和交付合同先由本地门禁检查，只有硬问题才触发有界修复；可选 GPT 正文编辑默认关闭。
输入分类、已提供事实提取和独立对白翻译使用 `deepseek-v4-flash`，关闭思考模式；正文、规划修改和备用使用 `deepseek-v4-pro`，启用 high 思考。对应凭据集中配置，角色不会混用其他模型的密钥。
两条路径共用同一中文创作界面、结构合同和修复流程，完整变量示例见
`.env.example`，本地真实值见 `.env.local`。

如需把模型配置拆成凭据、通用策略和市场角色分片，可参考
[`config/model-config.env.example`](config/model-config.env.example) 与
[`AI_Comic_Content_OS_Docs/47_MODEL_CONFIG_SPLIT_PLAN.md`](AI_Comic_Content_OS_Docs/47_MODEL_CONFIG_SPLIT_PLAN.md)。
运行时仍统一读取根目录 `.env.local`；上述文件只用于查看和整理变量分组。

内容各阶段的字段、数量、连续性和编剧验收门槛见
[`AI_Comic_Content_OS_Docs/48_CONTENT_STAGE_ACCEPTANCE_STANDARD.md`](AI_Comic_Content_OS_Docs/48_CONTENT_STAGE_ACCEPTANCE_STANDARD.md)。

正文前置链路的整体改造顺序和快速正文模型接入方案见
[`AI_Comic_Content_OS_Docs/49_PREBODY_OPTIMIZATION_ROADMAP.md`](AI_Comic_Content_OS_Docs/49_PREBODY_OPTIMIZATION_ROADMAP.md)。

全流程的编剧与 AI 工程联合审查见
[`AI_Comic_Content_OS_Docs/50_FULL_FLOW_ARCHITECTURE_REVIEW.md`](AI_Comic_Content_OS_Docs/50_FULL_FLOW_ARCHITECTURE_REVIEW.md)。

如需把新建项目的默认路径改为海外，可设置：

```dotenv
SCRIPT_MARKET_PROFILE=overseas_tiktok
```

不要提交 `.env.local` 或真实 API Key。未配置真实模型时，系统进入明确标记的 Mock 演示模式。

### 3. Start Frontend And Backend

```bash
./start-local.sh
```

本地启动脚本会让浏览器直接访问 FastAPI，并通过 `FRONTEND_ORIGINS` 限制允许的前端地址。这样真实模型的长耗时生成不会经过 Next.js 开发代理而被提前断开；该设置不改变生产环境的 API 契约。

访问：

- Frontend: `http://127.0.0.1:3000`
- API Docs: `http://127.0.0.1:8000/docs`

脚本会启动后端、初始化 Frontend MVP 所需的 Prompt / Strategy / Platform / Ontology 开发资源并启动前端。使用 `Ctrl+C` 同时停止两个服务。

`start-local.sh` 会先执行 `alembic upgrade head`，Frontend 随后同步项目元数据与完整工作区快照。未配置 `DATABASE_URL` 时，启动器会自动使用 `.cache/local-runtime/my-comic.db`，保证总纲、剧情树、分集路线图和正文工作流具备持久化能力；生产发布仍应显式配置 PostgreSQL，并在独立 release step 中执行 migration。

如果提示端口占用，先停止旧的 `uvicorn` / `next dev` 进程，再重新运行启动脚本。

## Development Commands

后端测试：

```bash
.venv/bin/pytest -q
```

隔离的新建故事工作流验证（需要已安装前端 Node 依赖，用于复用产品连续性投影）：

```bash
.venv/bin/python scripts/run_story_workflow_probe.py --output .cache/story-workflow-check
```

默认使用明确标记的 Mock 演示数据，验证创意解析、故事圣经、剧情树、首个叶节点路线图、前两集草稿、保存读回和幂等重放，输出到新的隔离目录。加载有效模型环境后加 `--real` 可检查真实调用链；模拟作者确认、Markdown 抽样输出不代表正式锁稿或整部长篇质量验收。最新修复与实测边界见 [46_ENGINEERING_FIXES_AND_WORKFLOW_RETEST.md](AI_Comic_Content_OS_Docs/46_ENGINEERING_FIXES_AND_WORKFLOW_RETEST.md)。

数据库迁移开发验证：

```bash
export DATABASE_URL='postgresql+psycopg://user:password@127.0.0.1:5432/ai_comic_content_os'
.venv/bin/alembic upgrade head
.venv/bin/alembic check
```

生产环境必须使用 PostgreSQL，并在发布流程中显式执行 Alembic migration；SQLite 只用于自动化测试。

前端静态验证：

```bash
cd frontend
npm run typecheck
npm run build
```

仅启动 API：

```bash
PYTHONPATH=backend:. .venv/bin/uvicorn app.main:app --reload
```

配置 PostgreSQL 后，ContentSpec 与长篇项目/规划资源可跨 API 重启恢复；Prompt、Strategy、Platform、Ontology 和部分历史能力仍使用进程内开发 Repository。单独启动或重启 API 后，如需运行 Frontend MVP，请初始化这些开发资源：

```bash
.venv/bin/python scripts/bootstrap_frontend_mvp_runtime.py
```

## Repository Layout

```text
backend/                         FastAPI 与业务模块
frontend/                        Next.js Creator Workspace
tests/                           单元、API、Benchmark 与 E2E 测试
datasets/benchmark/              固定能力基准
datasets/mock/                   开发用 Mock 数据
evaluation/                      Benchmark 与评估逻辑
examples/                        示例和离线实验工件
AI_Comic_Content_OS_Docs/        正式文档
AI_Comic_Content_OS_Docs/Research/ 研究和实验记录
```

## Documentation Map

| Document | Responsibility |
|---|---|
| `00_AI_Engineer_Guide.md` | 工程协作与开发规则 |
| `01_System_Design.md` | 系统架构 |
| `02_Data_Model.md` | 数据契约 |
| `05_API_Design.md` | API 契约 |
| `06_Project_Structure.md` | 目录职责 |
| `14_Script_Engine.md` | Script Engine 设计与边界 |
| `17_MVP_Roadmap.md` | 当前阶段、优先级和 Backlog |
| `18_PROJECT_PRINCIPLES.md` | 长期原则 |
| `19_DECISIONS.md` | 已接受架构决策 |
| `20_Benchmark_Evaluation.md` | Benchmark 与评估方法 |
| `21_Current_Status_Checklist.md` | 当前实现状态与限制 |
| `22_TEST1_HANDOFF.md` | `test1` 分支交接、门禁、验证和后续实施边界 |
| [分镜与前期制作交付方案](AI_Comic_Content_OS_Docs/44_PREPRODUCTION_STORYBOARD_PLAN.md) | Liblib 对话结论、生成描述分工、分镜／资产／提示词设计和三期实施验收；待实现 |
| [《弥寿计划》Ⅲ阅读笔记](libtv-mishou-iii-notes.md) | 参考作品的已记录事实、版本差异及核验限制 |
| `Frontend_MVP_Architecture.md` | 前端产品与技术边界 |
| `Research/` | 尚未自动进入 Runtime 的研究证据 |

文档职责以 [AI Engineer Handbook](AI_Comic_Content_OS_Docs/00_AI_Engineer_Guide.md) 为准。合作方新要求确认后，再更新 Roadmap 并重新建立验收方案。
