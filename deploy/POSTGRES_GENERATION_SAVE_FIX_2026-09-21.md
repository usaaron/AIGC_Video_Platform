# 模型返回后误报保存冲突修复

线上标准流程「生成人物与世界观」在模型成功返回后提示请求未完成，生成检查点和正式草稿都未保存。在 PostgreSQL 16、SQLAlchemy 2.0.52、psycopg 3.3.5 的独立数据库中复现：INSERT 成功但驱动返回 `rowcount=-1`，原检查把它当作并发写入失败，抛出 409 并回滚事务。

故事总纲检查点和独立分镜首次保存改用 SQL `RETURNING document_id` 判断实际写入结果。真实版本冲突仍因没有返回行而拒绝；检查点历史及正式草稿继续在原事务中保存，没有放宽版本或账号隔离。

真实驱动回归位于 `tests/test_story_storage_postgres_cas.py`，使用 `TEST_DATABASE_URL` 指定的独立可丢弃 PostgreSQL 测试库及临时账号 schema。模型使用替身，不发送生成请求。支持 `python -m unittest tests.test_story_storage_postgres_cas`；未配置测试库时明确跳过，不能当作 PostgreSQL 已验证。

主站新建网剧也修正为 90 秒默认值，与快速流程范围一致。已有标准项目不强行迁移；无正文的大陆项目可显式点击「快速创作」，沿用既有梗概，界面明示 8 集、每集 90 秒、约 8000 字的初始篇幅。

本修复不改模型、数据库迁移或生产凭据。实际部署提交、镜像和验证结果以主站最新生产记录为准。
