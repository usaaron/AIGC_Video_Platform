# 模型返回后误报保存冲突修复

线上标准流程「生成人物与世界观」在模型成功返回后提示请求未完成，生成检查点和正式草稿都未保存。在 PostgreSQL 16、SQLAlchemy 2.0.52、psycopg 3.3.5 的独立数据库中复现：INSERT 成功但驱动返回 `rowcount=-1`，原检查把它当作并发写入失败，抛出 409 并回滚事务。

故事总纲检查点和独立分镜首次保存改用 SQL `RETURNING document_id` 判断实际写入结果。真实版本冲突仍因没有返回行而拒绝；检查点历史及正式草稿继续在原事务中保存，没有放宽版本或账号隔离。

真实驱动回归位于 `tests/test_story_storage_postgres_cas.py`，使用 `TEST_DATABASE_URL` 指定的独立可丢弃 PostgreSQL 测试库及临时账号 schema。模型使用替身，不发送生成请求。支持 `python -m unittest tests.test_story_storage_postgres_cas`；未配置测试库时明确跳过，不能当作 PostgreSQL 已验证。

主站新建网剧也修正为 90 秒默认值，与快速流程范围一致。已有标准项目不强行迁移；无正文的大陆项目可显式点击「快速创作」，沿用既有梗概，界面明示 8 集、每集 90 秒、约 8000 字的初始篇幅。

本修复不改模型、数据库迁移或生产凭据。实际部署提交、镜像和验证结果以主站最新生产记录为准。

## 生产发布与验证

2026-09-21 01:01:02（Asia/Shanghai）已部署至 https://xumutv.com。剧本业务提交为 `e71ee98748238dc09674471c2cbfb3065dc4a1ae`，运行镜像为 `script-master-api:e71ee9874823` 与 `script-master-web:e71ee9874823`；配套主站 Web 业务提交为 `2cc67d2b591bed53674ecd27a42c0769aa051870`，镜像 `seqora-web:2cc67d2b591b`。后续仅发布文档的提交不改变这些业务镜像。

主站 API / Worker 保留 `seqora-api:ebb55fa3c7a9`。两个 PostgreSQL、Redis 和主站 API / Worker 容器未重建，已核对实例 ID；没有迁移或生产凭据变更。

发布目录 `/opt/seqora-releases/script-fix-20260921` 的最终 `deploy.exit=0`，readiness 为 `ready=true`，生产冒烟为 `ok=true`。备份 `/opt/seqora-backups/script-fix-20260920T170045Z` 包含已验证的两个数据库 dump、配置和源码。

最终剧本 API 镜像运行真实 PostgreSQL 回归 3 项通过，相关 SQLite 回归 126 项通过；主站入口与嵌入 8 项、剧本快速模式 30 项测试，以及前端类型检查和主站生产构建通过。生产浏览器实际点击「开始新创作」并创建默认网剧，成功进入三步快速页，显示 8 集、约 8000 字且保存成功，接口回读确认每集时长为 90 秒。

生产冒烟使用固定测试样本；存储回归使用模型替身。此次没有付费生成，浏览器验证没有生成剧本，以上结果不代表真实模型质量或完整逐集生成已验收。浏览器验收的唯一临时项目已在主站与剧本两侧软归档，临时 API 会话已退出，独立验证标签页已关闭；用户原标签页及已有项目保留。

完整主站发布记录：[新网剧入口与生成保存修复](https://github.com/usaaron/AIGC_Video_Platform/blob/codex/quick-script-preview-20260920/docs/QUICK_SCRIPT_ENTRY_FIX_2026-09-21.md#生产修复发布)。上一剧本应用镜像为 `script-master-api:5f41a27e48cf` 与 `script-master-web:5f41a27e48cf`；回退只切换应用，不覆盖数据库卷。
