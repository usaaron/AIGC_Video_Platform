# 创作端 UI 与页内剧本大师发布

2026-09-18 11:47（北京时间）已部署至 `https://xumutv.com`。本次发布深色香槟主题，以及网剧的主站页内创作；保留「剧本创作 / 制作稿」切换，复用既有生成、签名鉴权和 v2 批量导入。

## 配套版本

两条源码分支位于 `https://github.com/usaaron/AIGC_Video_Platform`，分支相互独立，不把 Next/FastAPI 源码混入主站目录。

| 模块         | 分支                              | 应用提交                                   | 线上镜像                         |
| ------------ | --------------------------------- | ------------------------------------------ | -------------------------------- |
| 主站 Web     | `codex/studio-ui-20260917`        | `daa00829448f659a21ebab0f6ed0e78b552f813d` | `seqora-web:daa00829448f`        |
| 剧本大师 Web | `codex/script-master-ui-20260917` | `3bace156a3b5f17cb102efcff23eb8abfcf47b42` | `script-master-web:3bace156a3b5` |

发布后的文档提交不改变以上运行镜像。主站 API/Worker 保持 `seqora-api:b4f780e1800f`，剧本大师 API 保持 `script-master-api:aebcb759dba3`。管理端没有功能或 UI 改动；它随现有主站 Web 镜像正常打包。

## 验证

- 主站 272 项前端单测、剧本大师 604 项单测通过；Web lint、两套构建、TypeScript、格式、架构及部署安全配置检查通过。
- 主站浏览器完整轮次 41/43；两项旧导航测试误选保留工作区中的隐藏标题，修正为当前可访问标题后定向重跑 2/2 通过。剧本大师融合专项完整轮次 8/8。共 51 项用例有通过结果，具体范围见 [创作流程](SERIES_CREATION_FLOW.md)。
- 发布前执行 `pnpm check`：格式、架构、安全配置、全仓库 lint 通过；数据库测试预检因本机 Docker daemon 未运行中止。没有绕过检查或声称后端全量通过；本次应用变更和重启仅涉及前端。
- 线上普通测试账号登录、会话、项目及资产库读取通过；普通账号管理 API 403，未登录主站 API/Admin/剧本大师均 401。
- 绑定项目的启动接口返回同源地址和正确项目上下文；签名票据读取剧本大师数据成功。新 Next 包含页内通信代码，网关保持 SAMEORIGIN 与 `frame-ancestors 'self'`；主站加载新版页内布局样式。
- health/readiness、数据库、Redis、队列、Worker 心跳正常；发布前后后端及数据容器 ID 一致，应用私密配置哈希一致。线上测试前后积分一致，脚本创建的测试会话已退出。
- 浏览器使用现有测试账号实际登录，确认新版项目库、主站页内剧本创作、制作稿切换和同步弹窗正常，主站导航保留。自动化四阶段创作与同步交互使用模拟接口验收；本次未执行付费生成、真实支付、100 集产出或线上写入式批量导入。

## 备份与回退

`/opt/seqora-backups/studio-ui-20260918T034620Z` 保存两个数据库 dump、前一主站源码 `source/`、独立服务的 `master-release.env` 与 `master-source.txt`、私密配置备份、构建/重启日志和业务检查结果。两个 dump 已能列出恢复目录。

旧主站 Web 为 `seqora-web:b4f780e1800f`，旧剧本大师 Web 为 `script-master-web:aebcb759dba3`。独立服务当前源码 `/opt/script-master/releases/3bace156a3b5`，前一源码 `/opt/script-master/releases/aebcb759dba3`。如回退，仅恢复对应源码与 Web 镜像，使用原 Compose 项目名、两个环境文件和 `--no-deps`；本次无迁移，不需要还原数据库。

本次源包 SHA-256：主站 `2fdee46f6fab8909a7f31fc8695595b1c43c12ef1cd0dea2631ed9e4f5b57bfb`；剧本大师 `cdeaabbaba8310af302736a36a9722bde643b6a559ad463742f394d11b1909f5`。源包不含模拟预览适配器、开发环境密钥或运行数据。
