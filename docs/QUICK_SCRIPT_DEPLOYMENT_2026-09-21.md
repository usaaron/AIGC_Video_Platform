# 5182 快速剧本融合版生产发布

2026-09-21 00:29（Asia/Shanghai）已将用户确认的本地 5182 融合版发布到 https://xumutv.com。主站与剧本服务配套发布；新建大陆网剧项目默认使用「故事梗概 → 创作安排 → 剧本正文」，已有标准项目和海外项目保留原流程。

| 服务              | 已部署业务提交                             | 运行镜像                         |
| ----------------- | ------------------------------------------ | -------------------------------- |
| 主站 Web          | `ebb55fa3c7a9b8f81b784649cc5ee95a24af0e4f` | `seqora-web:ebb55fa3c7a9`        |
| 主站 API / Worker | 同上                                       | `seqora-api:ebb55fa3c7a9`        |
| 剧本 Web          | `5f41a27e48cfcf71fce6160f2af046a389f330d1` | `script-master-web:5f41a27e48cf` |
| 剧本 API          | 同上                                       | `script-master-api:5f41a27e48cf` |

源码位于 [完整主站分支](https://github.com/usaaron/AIGC_Video_Platform/tree/codex/quick-script-preview-20260920) 和 [配套剧本分支](https://github.com/usaaron/AIGC_Video_Platform/tree/codex/script-master-quick-preview-20260920)。随后仅补充发布文档的提交不改变上表业务镜像。没有合并主分支；采用已有 SSH 源码包发布方式。

## 配置与数据

- 剧本模型配置按 5182 实际配置迁入：50 个模型角色使用 `deepseek-v4-1-flash-260910`，保留原有 Astra 备用角色。服务器只读模型目录返回 200，包含目标型号。
- 主站生产环境文件保持完全一致。剧本数据库、宿主共享鉴权、账号隔离和域名配置保留；模型配置只通过私密文件转移，不进入源码、镜像或 Git。
- 没有新增 migration。主站迁移检查通过，剧本静态目录及 12 个既有账号 schema 准备通过。
- 两个 PostgreSQL 和 Redis 容器 ID 保持不变，数据卷保留。本地 5181/3190/8190/8193 与 5182/3192/8194 的进程 ID 保持不变。
- 本地预览专用代理、演示身份及本地 JSON/SQLite 数据没有上传生产。

## 验证

四个 Docker 生产镜像构建成功。服务器没有 BuildKit，主站构建沿用既有方式生成临时 Dockerfile，仅省略可选的 pnpm 缓存挂载；依赖锁和应用源码未变。

生产使用既有普通测试账号和唯一临时项目，验证以下链路通过：

- 公网首页、readiness、数据库、Redis、队列和 Worker 心跳正常。
- 未登录账号/管理端/剧本入口返回 401，普通账号管理端返回 403；绑定票据只访问目标项目，无效票据拒绝。
- 主站及快速页生产资源、同源嵌入策略、快速设定保存/恢复/幂等正常。
- 手工短样本正文交付、回执幂等、结构化依据存储、5 项资产提取与保存、2 个规则分镜及对白保留正常。
- 默认覆盖已有分镜返回 409；明确保存制作修订后保留 1 个未变镜头、重建 1 个变更镜头，并保存旧正文及 2 个旧镜头的历史。
- 积分和用量不变，两侧临时项目已归档，测试会话已退出。

首次生产检查把 PostgreSQL JSONB 字段排序变化误判为回执差异，触发自动回滚；旧版健康恢复已验证。验收脚本改为语义等值比较后重新发布，完整生产冒烟通过。业务代码与镜像未因该验收脚本修正而改变。

本次未发起模型生成或图片/视频任务；模型目录可用不等于真实生成质量验收。十集真实模型全流程验收仍未完成。既有单元测试和构建范围见 [整合版本说明](INTEGRATION_SNAPSHOT_2026-09-20.md)。

## 备份与回退

- 备份：`/opt/seqora-backups/quick-5182-20260920T161735Z`。包含已验证的初始双库 dump、最后一次切换前双库 dump、约 1.7 GB 本地数据归档、原配置及源码。配置与数据留在服务器私密目录。
- 发布包与日志：`/opt/seqora-releases/quick-5182-20260921`。最终 `deploy.exit=0`、`smoke.json` 中 `ok=true`；首次检查与回滚记录保留在 `attempt-1/`。
- 当前主站源码：`/opt/seqora`；剧本源码：`/opt/script-master/releases/5f41a27e48cf`，`current` 指向该目录。
- 原镜像保留：主站 API/Worker `seqora-api:b4f780e1800f`、主站 Web `seqora-web:daa00829448f`、剧本 API `script-master-api:aebcb759dba3`、剧本 Web `script-master-web:3bace156a3b5`。

后续回退应先检查运行任务，恢复原应用镜像和剧本模型配置，并按原模型准备静态目录；不删除或覆盖数据库卷。主站 Compose 必须同时加载 `demo.env` 和 `release.env`，服务切换使用 `--no-deps`，随后验证 readiness、登录保护和交接。
