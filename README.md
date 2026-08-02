# AI Comic Content OS

AI Comic Content OS 当前面向中国大陆漫剧市场，重点建设中文长篇故事母本与后续结构化剧本能力。系统不绑定单一发行平台，红果仅作为市场参考。

当前目标是稳定生成高质量、可控、可追踪的 `MasterScript`，而不是直接生成视频。

## Current Stage

项目处于 `Capability Optimization / System Validation`。

当前市场开关：

- 默认：`SCRIPT_MARKET_PROFILE=cn_mainland`
- 保留但关闭：`overseas_tiktok`
- 暂停：Creative Deepening 前后端运行开关默认关闭
- 已完成基础：Story Project、Story Bible、故事阶段、Episode Plan、Continuity Ledger、批次检查点契约，以及 PostgreSQL / JSONB schema、Alembic migration 和事务型 Repository
- 已接入后端资源 API：Story Project、Frontend Workspace Snapshot、Story Bible、故事阶段和 Episode Plan 的版本化保存与读取
- Frontend 已采用 IndexedDB 本地优先 + PostgreSQL Workspace Snapshot 服务端同步；冲突不静默覆盖，删除使用版本保护的服务端软归档
- Frontend 已按市场来源隔离项目；中国大陆模式只展示 `cn_mainland` 项目，海外/TikTok 与来源不明的历史项目在前端完全隐藏但不删除，切换市场后才重新加载对应项目
- 中国大陆模式固定使用中文界面和中文剧本输出，隐藏语言切换与海外入口；英文资源和源稿仅保留在停用资产及持久化层，不进入当前创作界面
- 已接入 Episode Artifact 里程碑：确认稿、规则修订稿和终稿按不可变服务端版本保存并保留来源 lineage
- 尚未接入 runtime：自动规划、编辑过程的细粒度版本、连续性自动更新和后台可恢复执行
- 尚未实现：完整 60 万字母本自动生成

当前已经跑通：

```text
Creative Intent / Character Context
→ ContentSpec
→ Prompt / Static Knowledge
→ DraftMasterScript
→ Story QC
→ Revision / Re-QC
→ Acceptance Shadow
→ Finalization
→ FinalMasterScript
```

Frontend MVP 支持本地项目、标签、角色、逐集生成和分阶段全部生成、分集编辑、AI 修改、修订、终稿与导出。阶段之间可以更新标签、角色与创作指令，再将新元素用于后续剧集。Creative Deepening 代码保留，但当前前端隐藏、后端拒绝执行。

当前重要边界：

- Story QC 仍是实验性 Rubric，不代表专业剧本评审结论。
- Revision 仍以规则式受控修改为主。
- Acceptance 当前是 shadow 信号，不阻断 Finalization；Creative Deepening 当前默认关闭。
- 全部生成由前端按批次有界调用单集 Draft API，并保存本地批次 lineage；不等同于 Story Planning runtime、后台 Job 或完整 60 万字自动生成。
- 项目工作区先保存到浏览器 IndexedDB，并在配置 PostgreSQL 时同步完整版本化 Workspace Snapshot；确认稿、修订稿和终稿另存不可变 Episode Artifact。没有数据库或服务暂时不可用时可继续本地编辑，但同步冲突必须人工处理。
- 中文界面的英文剧本对照翻译是 presentation artifact，不修改正式英文剧本。
- Agent、动态 RAG、视频生产和统一 Script Generation Facade 尚未实现。

完整实现状态见 [21_Current_Status_Checklist.md](AI_Comic_Content_OS_Docs/21_Current_Status_Checklist.md)。

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

```bash
cp .env.example .env.local
```

编辑 `.env.local`：

```dotenv
LLM_PROVIDER=openai_compatible
LLM_MODEL=your-model-name
LLM_API_KEY=your-api-key
LLM_BASE_URL=https://your-provider.example/v1
LLM_TIMEOUT_SECONDS=300
LLM_MAX_RETRIES=2
SCRIPT_MARKET_PROFILE=cn_mainland
SCRIPT_CREATIVE_DEEPENING_ENABLED=false
DATABASE_URL=postgresql+psycopg://user:password@127.0.0.1:5432/ai_comic_content_os
```

只有需要恢复旧海外验证配置时才改为：

```dotenv
SCRIPT_MARKET_PROFILE=overseas_tiktok
```

不要提交 `.env.local` 或真实 API Key。未配置真实模型时，系统进入明确标记的 Mock 演示模式。

### 3. Start Frontend And Backend

```bash
./start-local.sh
```

访问：

- Frontend: `http://127.0.0.1:3000`
- API Docs: `http://127.0.0.1:8000/docs`

脚本会启动后端、初始化 Frontend MVP 所需的内存资源并启动前端。使用 `Ctrl+C` 同时停止两个服务。

配置 `DATABASE_URL` 时，`start-local.sh` 会先执行 `alembic upgrade head`，Frontend 随后同步项目元数据与完整工作区快照。未配置数据库时明确进入 IndexedDB 本地模式，不会伪装为云端持久化。生产发布仍应在独立 release step 中显式执行 migration。

如果提示端口占用，先停止旧的 `uvicorn` / `next dev` 进程，再重新运行启动脚本。

## Development Commands

后端测试：

```bash
.venv/bin/pytest -q
```

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

ContentSpec、Prompt 和部分历史能力仍使用进程内 Repository。单独启动或重启 API 后，如需运行 Frontend MVP，请初始化开发资源：

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
| `Frontend_MVP_Architecture.md` | 前端产品与技术边界 |
| `Research/` | 尚未自动进入 Runtime 的研究证据 |

文档职责以 [AI Engineer Handbook](AI_Comic_Content_OS_Docs/00_AI_Engineer_Guide.md) 为准。合作方新要求确认后，再更新 Roadmap 并重新建立验收方案。
