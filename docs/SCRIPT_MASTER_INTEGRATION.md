# 剧本大师独立模块接入

当前项目把 `project111-final2` 作为独立 Script Master 服务接入功能栈中的“剧本大师”。`final2` 的 Next.js 前端、FastAPI 后端、数据库、长剧本生成、分集规划、修订、质量检查和导出功能保持独立运行。

## 生产接入方式

宿主和独立服务必须分别发布。只发布本仓库会有入口和交接 API，但没有剧本大师工作台。
独立源码保留在 `project111-final2`，当前生产适配源码将发布到主仓库的 `codex/script-master-service-20260916` 分支，
已包含 `final2` 的 `dd66d6d` 及独立服务适配提交。部署文件位于独立仓库的 `compose.production.yml` 和 `deploy/`。
源仓库当前可读但拒绝写入；发布使用经过验证的独立源码包和镜像。

主项目 API 配置：

```env
SCRIPT_MASTER_URL=https://xumutv.com/script-master
SCRIPT_MASTER_SHARED_SECRET=同一条随机长密钥
SCRIPT_MASTER_LAUNCH_TTL_SECONDS=300
```

`final2` 配置同一条密钥：

```env
HOST_INTEGRATION_REQUIRED=true
HOST_INTEGRATION_SECRET=同一条随机长密钥
FRONTEND_ORIGINS=http://127.0.0.1:3000,http://localhost:3000
```

生产还必须配置 `SCRIPT_MASTER_ACCOUNT_ISOLATION=true`、独立 PostgreSQL 的 `DATABASE_URL`，并将
`FRONTEND_ORIGINS` 设为 `https://xumutv.com`。模型配置只进入独立后端；Next.js 镜像只接收路径等
公开配置。数据库使用单独的应用角色、持久卷和内网，不能复用开发 SQLite 或导入本地用户数据。

主项目页面调用 `/api/v1/script-master/launch` 获取启动地址，在同一标签页进入整页工作台，
不再使用 iframe。`config` 保留给诊断使用，不是远端健康检查。启动票据位于 URL fragment，前端去掉 fragment 后
通过 `Authorization: Bearer` 调用后端。生产工作台首次加载先核对主站会话；临近过期时重新
领取短期票据。会话失效或账号变化时停止旧页面请求和缓存同步，要求重新进入。

宿主 Caddy 对 `/script-master` 执行主站登录校验，再代理独立 Next.js。独立 API 继续验证签名、
有效期、`project.read/project.write` 和项目范围，数据访问通过组织与用户组合的 PostgreSQL schema
隔离。公共 schema 仅含预置资料，浏览器 IndexedDB/创作缓存也按账号划分。

独立服务启动前执行 `python scripts/prepare_production.py` 迁移并写入静态资料，readiness 通过后
再连接主站。宿主发布命令必须同时读取 `deploy/demo.env` 与 `deploy/release.env`，防止选错旧镜像。
仅更新网关时可使用 `deploy/script-master-gateway.Dockerfile` 复用已经验证的主站页面资源。

## 责任边界

`final2` 负责长剧本创作工作台和长剧本领域数据。当前项目负责账号、组织权限、积分账本、资产库、人物加白、分镜、媒体生成队列、音视频合成和下载交付。`final2` 不应直接调用当前项目 Provider、积分账本或媒体队列。

当前工作台使用 `script_master_delivery.v2` 批量导入已保存正文、有效分镜和分类资产，详见 [批量交接](SCRIPT_MASTER_BULK_IMPORT_2026-09-16.md)。旧版 `script_master_delivery.v1` 保持兼容：`final2` 的导出面板在配置 `NEXT_PUBLIC_HOST_DELIVERY_URL` 后，可将已确认分集提交到主项目的 `POST /api/v1/script-master/deliveries`。主项目根据分集编号匹配已有分集并创建或更新正文，后续资产、分镜和媒体任务沿用主项目流程，不由交接接口自动触发。当前完整预览合成会移除音轨，有声成片尚未完成验收。

旧版 v1 交接必须带 `sourceProjectId`、`sourceRevision`、`idempotencyKey` 和分集稳定标识。Postgres 模式保存交接记录，重复交接复用原回执；本地 JSON 模式使用进程内记录，重启后不保留。当前逐集写入和回执更新尚未组成同一事务，来源分集稳定标识也尚未持久化映射，不能把正常重放测试通过等同于全部失败恢复场景可靠。

旧版 v1 只导入已保存的分集正文。人物、场景和镜头仍由主项目现有资产建议、资产生成和分镜链路处理，避免两个服务各自创建一套媒体任务。后续扩展交接字段时，保持 `script_master_delivery.v1` 兼容并继续由主项目负责媒体任务和积分账本。

## 本地检查

1. 启动主项目：`pnpm dev`。
2. 启动 `final2`：按其开发文档启动 API `8000` 和前端 `3000`；启用宿主鉴权时必须使用 PostgreSQL。
   本地 Next 配置 `HOST_API_URL=http://localhost:8787`，宿主服务地址统一用 `http://localhost:3000`，
   确保不同端口复用同一主机的登录 Cookie。生产使用上述同源路径部署。
3. 登录主项目，打开功能栈中的“剧本大师”。
4. 配置未完成时页面应显示可重试的连接状态；配置完成时应同页进入独立工作台；“返回主站”在新标签页打开目标项目，保留创作进度。

2026-09-14 本地验证已覆盖启动、指定项目鉴权、两集交接、重复交接、前端单测和桌面/移动 E2E，详细结果见 [本地全量测试记录](TEST_REPORT_2026-09-14.md)。主项目 Postgres/Redis 测试受本机 Docker 不可用阻断，剧本大师 Python 全量回归仍有 12 个失败、2 个错误。

## 当前接入限制

- 2026-09-15 生产适配增加按账号的数据库/缓存隔离和票据续期；旧版本 `d659fb0` 不具备这些保护，不能直接作为多账号生产镜像。历史测试报告描述的是旧版本。
- 账号隔离没有同时提供组织内项目共享。实验采集/评估结果仍为进程内存持久期，不应当成已实现持久任务。
- 独立模块新建项目可在 v2 导入面板选择有权限的主项目；旧版 v1 的失败恢复和来源分集映射限制仍适用。
- 100 集全链路在真实模型、队列和媒体 Provider 上的耗时仍需单独压测，不能从界面状态推断已达到一天以内。

## 2026-09-16 剧本大师批量交接更新

新增 v2 批量导入接口及独立工作台入口，支持已保存分集正文、有效分镜和分类资产；导入事务、重复提交和定稿媒体保护已实现。灵感对话补齐空项目第一条想法的传递。原 v1 限制和派生版本授权问题不因此自动消失，详见 [本次更新](SCRIPT_MASTER_BULK_IMPORT_2026-09-16.md)。

## 2026-09-16 整页工作台

创作设定已改为页面内流程，取消主站多层 iframe 外框和创作弹窗，保留三步问答、保存/恢复、导入和导出。返回链接定位当前账号可见的目标项目；构建配置、验证和发布记录见 [整页工作台更新](SCRIPT_MASTER_WORKSPACE_REFRESH_2026-09-16.md)。
