# 剧本大师独立模块接入

当前项目把 `project111-final2` 作为独立 Script Master 服务接入功能栈中的“剧本大师”。`final2` 的 Next.js 前端、FastAPI 后端、数据库、长剧本生成、分集规划、修订、质量检查和导出功能保持独立运行。

## 运行方式

主项目 API 配置：

```env
SCRIPT_MASTER_URL=http://127.0.0.1:3000
SCRIPT_MASTER_SHARED_SECRET=同一条随机长密钥
SCRIPT_MASTER_LAUNCH_TTL_SECONDS=300
```

`final2` 配置同一条密钥：

```env
HOST_INTEGRATION_REQUIRED=true
HOST_INTEGRATION_SECRET=同一条随机长密钥
FRONTEND_ORIGINS=http://127.0.0.1:3000,http://localhost:3000
```

主项目页面调用 `/api/v1/script-master/config` 检查服务状态，再调用 `/api/v1/script-master/launch` 获取启动地址。启动地址包含短时签名票据，票据位于 URL fragment，不会作为普通 API URL 发送。`final2` 前端首次请求 API 时把票据转为 `Authorization: Bearer`，后端验证签名、受众、有效期和项目范围。

## 责任边界

`final2` 负责长剧本创作工作台和长剧本领域数据。当前项目负责账号、组织权限、积分账本、资产库、人物加白、分镜、媒体生成队列、音视频合成和下载交付。`final2` 不应直接调用当前项目 Provider、积分账本或媒体队列。

长剧本完成后使用版本化的 `script_master_delivery.v1` 交接：`final2` 的导出面板在配置 `NEXT_PUBLIC_HOST_DELIVERY_URL` 后，可将已确认分集提交到主项目的 `POST /api/v1/script-master/deliveries`。主项目根据分集编号匹配已有分集并创建或更新正文，后续资产、分镜和媒体任务沿用主项目流程，不由交接接口自动触发。当前完整预览合成会移除音轨，有声成片尚未完成验收。

交接必须带 `sourceProjectId`、`sourceRevision`、`idempotencyKey` 和分集稳定标识。Postgres 模式保存交接记录，重复交接复用原回执；本地 JSON 模式使用进程内记录，重启后不保留。当前逐集写入和回执更新尚未组成同一事务，来源分集稳定标识也尚未持久化映射，不能把正常重放测试通过等同于全部失败恢复场景可靠。

当前交接首版只导入已保存的分集正文。人物、场景和镜头仍由主项目现有资产建议、资产生成和分镜链路处理，避免两个服务各自创建一套媒体任务。后续扩展交接字段时，保持 `script_master_delivery.v1` 兼容并继续由主项目负责媒体任务和积分账本。

## 本地检查

1. 启动主项目：`pnpm dev`。
2. 启动 `final2`：按其 `start-local.sh` 启动 API `8000` 和前端 `3000`。
3. 登录主项目，打开功能栈中的“剧本大师”。
4. 配置未完成时页面应显示可重试的连接状态；配置完成时应显示独立工作台，并可在新标签页打开。

2026-09-14 本地验证已覆盖启动、指定项目鉴权、两集交接、重复交接、前端单测和桌面/移动 E2E，详细结果见 [本地全量测试记录](TEST_REPORT_2026-09-14.md)。主项目 Postgres/Redis 测试受本机 Docker 不可用阻断，剧本大师 Python 全量回归仍有 12 个失败、2 个错误。

## 当前接入限制

- 不指定项目的启动票据尚未配套账号/组织级数据隔离。剧本大师数据库项目列表和浏览器缓存不能据此保证多账号互不可见，修复前不应向多个组织开放。
- 启动票据默认 300 秒、最多 900 秒，当前直接用于后续 API 请求，尚无服务会话交换或续期，无法满足数小时任务的持续操作。
- 独立模块新建项目仍需明确绑定到主项目才能可靠交接；中途失败、重启和来源分集映射的限制见上文及测试报告。
- 100 集全链路在真实模型、队列和媒体 Provider 上的耗时仍需单独压测，不能从界面状态推断已达到一天以内。
