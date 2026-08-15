# 04 Database Design

## Production Choice

正式持久化采用 PostgreSQL。SQLite 只用于自动化测试和 migration compatibility，不作为商业产品的数据源。动态向量库尚未批准，不属于当前数据库依赖。

当前实现使用：

- SQLModel / SQLAlchemy
- Psycopg 3
- Alembic migration
- 关系字段 + JSONB version snapshot
- transaction-scoped Repository / Application Service

## Current Durable Resources

- `content_specs`
- `story_projects`
- `story_project_workspace_snapshots`
- `episode_artifact_versions`
- `story_bible_versions`
- `story_plan_node_versions`
- `story_stage_plan_versions`
- `episode_plan_versions`
- `continuity_ledger_versions`
- `generation_batches`
- `generation_job_checkpoints`

ContentSpec、Project、Workspace Snapshot 和 Episode Artifact 已接入 PostgreSQL；Story Bible、递归 Story Plan Node、兼容 Stage 和 Episode Plan 已具备版本化资源 API。ContentSpec 仍保持原有 API contract，并通过 Repository 的 optional database runtime 兼容无数据库测试。自动规划、Continuity 更新和后台 Job executor 尚未接入。

## Storage Strategy

- ID、FK、状态、版本、集数范围和时间等稳定查询字段使用关系列与索引。
- Story Bible、Story Plan Node、Stage、Episode Plan 和 Ledger 的完整版本化领域对象保存为 JSONB snapshot。
- Story Bible、Story Plan Node、Stage、Episode Plan、Ledger 和 Episode Artifact 不允许原地覆盖；新内容提升 version。
- Project、Batch、Job 和 Workspace Snapshot 使用 revision / expected revision 防止 stale write。
- 删除项目采用版本保护软归档，不静默物理删除。

## Transaction And Migration Rules

- 一个 Web request / Application Use Case 使用一个 Session 和 transaction。
- Repository 不自行 commit；异常必须 rollback。
- API 不直接操作 SQLModel Record。
- Schema 变化必须通过 Alembic migration。
- Migration 必须验证 upgrade、downgrade 和 metadata drift。
- 生产部署应在独立 release step 执行 migration，不依赖应用启动时偷偷建表。

## Long-Story Consistency

- `StoryPlanNode` 通过 parent/predecessor/version refs 表达非固定层级、非平衡递归树，不需要图数据库。
- 人物关系和故事线的权威规划版本属于 Story Bible / Continuity / Story Plan refs；Frontend 图形视图只是投影，不另建重复事实源。
- 已生成剧集不可因关系或故事线编辑而静默覆盖。修改应创建新版本、声明生效点，并在未来通过影响分析决定后续重规划或显式分支。

## Not Yet Durable Or Implemented

- 标签来源证据、Tag Knowledge Profile、CustomTagContext 和 Trend Signal persistence
- 编辑过程每次键盘输入的细粒度历史
- 自动 Continuity extraction / reconciliation
- 后台 Generation Job 执行、暂停、恢复和断点续跑
- 多用户 ownership、权限与协作
- Vector DB / dynamic RAG

详细数据契约见 `02_Data_Model.md`，API 状态见 `05_API_Design.md`，架构决策见 `19_DECISIONS.md`。
