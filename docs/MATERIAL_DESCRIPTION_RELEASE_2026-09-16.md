# 素材库描述长度修复发布（2026-09-16）

2026-09-16 09:44（北京时间）已发布至 `https://xumutv.com`。

人物加白创建素材组时，上游只允许 `Description` 最多 300 字符，旧适配器按 500 字符提交，长人物描写因此被拒绝。两个素材库适配器现在只截取上传简介的前 300 个 Unicode 字符；项目中的人物描述和生图提示词完整保留。错误提示保留实际供应商信息，移除误导、重复的 Dora 前缀。

## 版本与备份

- 修复提交：`b11284e98194abe722cfd32e0295b2dfc4e7a30e`。
- GitHub 分支：`codex/script-master-refresh-20260916`，已推送。
- API、Worker 镜像：`seqora-api:b11284e98194`。
- 主站 Web 保持 `seqora-web:f0604cdac1eb`；独立剧本大师 Web 保持 `script-master-web:e1d32f470720`，API 保持 `script-master-api:f3d62e11f9a8`。
- 备份：`/opt/seqora-backups/material-limit-20260916T014439Z`，包含主站数据库、JSON 索引、原源码、原镜像记录与私密运行配置。
- 发布包来自 Git 提交归档，SHA-256：`759c4e751b8482ead27854c9ea8ac8ff68506dd7c36f29e5570ad25c42c20808`。

## 验证

- 独立检出目录运行 `pnpm check` 通过：格式、架构、部署安全、lint、592 项稳定测试（含 PostgreSQL/Redis 集成）及全部构建。
- 63 项素材库专项回归通过，覆盖中文边界、长描述、Unicode 字符及人物确认后的自动加白流程；供应商使用测试替身。
- 切换前两次检查无排队或执行中的主站生成任务；迁移检查通过后更新 API、Worker。
- 线上 readiness、PostgreSQL、Redis、队列和 Worker 心跳正常。
- 在部署容器中验证实际编译后的两个适配器将 640 字符描述限制到 300 字符；此检查使用注入的测试接口。
- 既有测试账号登录、项目列表、素材库配置、AI/真人素材列表、剧本大师签名票据及独立项目读取通过；余额未变，测试会话已退出。
- 未登录访问 `/api/v1/auth/me`、`/api/v1/projects`、`/api/v1/library/items`、`/admin/`、`/script-master` 均返回 401。
- 主站 Web、两套数据库、Redis 及剧本大师服务容器 ID 未变化，主站私密运行配置逐字节一致。

本次没有提交真实加白或付费生成请求，没有自动重跑用户任务。此前因描述超长失败的任务需手动重试；已有图片无需重新生成。
