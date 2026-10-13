# 交付合同冻结 UI 与业务入口第九步

2026-10-13 已将任务级合同冻结接口接入生成队列，形成正式的业务入口。该步只负责让用户审核合同草稿并明确提交冻结意图；合同时间戳、SHA-256 哈希、范围校验和一次性冻结仍由服务端完成。

## 已完成

- 生成队列仅对同时满足以下条件的任务显示“冻结交付合同”：
  - 类型为视频；
  - 状态为已完成；
  - 存在结果媒体地址；
  - 任务尚未有交付合同。
- 入口位于任务行的业务区，与暂停、继续、删除等队列控制分开。
- 冻结弹层展示当前任务、项目范围、交付范围和“视频 × 1”交付物。
- 默认合同草稿包含服务端已有证据可以对应的稳定要求：
  - `task-completed`：任务必须已完成；
  - `media-url`：必须存在可读取的视频媒体。
- 当任务已经有物理合同或物理审计事实时，弹层额外提供“物理验收必须通过”选项；用户可以在冻结前取消这一项，避免把没有准备好的验收要求写入合同。
- 镜头任务自动填充 `intent.mode=shot` 和镜头 ID；没有镜头 ID 的视频结果使用 `response` 范围，不猜造分集 ID。
- 客户端只提交 `expectedUpdatedAt` 和带 `contractHash: null`、`frozenAt: null` 的草稿，不接受或生成最终哈希。
- 冻结成功后重新读取项目任务，队列入口按服务端状态切换为“查看交付核验”；弹层显示服务端返回的哈希前缀和冻结时间。
- 冻结失败会保留弹层并展示服务端错误，支持在刷新任务后重新审核；过期任务由服务端乐观并发检查拒绝。

## 代码与边界

- Web API 客户端：`apps/web/src/services/apiClient.js` 的 `freezeDeliveryContract`。
- 生成队列入口与弹层：`apps/web/src/pages/GenerationPage.jsx`。
- 任务行入口：`apps/web/src/components/ui.jsx`。
- 应用层回拉任务：`apps/web/src/App.jsx`。
- 服务端冻结边界：`apps/api/src/modules/generation/routes.ts`、`service.ts` 和 `repository.ts`。
- 只读核验仍通过 `GET /generation/tasks/:taskId/delivery-verification`，冻结 UI 不直接调用 Provider、对象存储、发布或支付。

## 验证

- 生成页、任务行和 API 客户端定向测试：3 个文件、43 个测试通过。
- Web 构建：`apps/web/node_modules/.bin/vite.cmd build` 通过。
- Web 相关 lint：`apps/web/node_modules/.bin/oxlint.cmd src/pages/GenerationPage.jsx src/components/ui.jsx src/App.jsx src/services/apiClient.js` 通过。
- 仓库级 Vitest 当前仍受环境限制：Docker Desktop 未运行导致 Postgres/Redis 夹具失败，E2E 缺少 `@playwright/test`；另有既有 API 提示词和脚本测试失败，均与本步 Web 代码无关。

## 当前清单

已完成：服务端合同草稿冻结与哈希、任务级权限和范围检查、对象存储只读验证、确定性证据判定、只读核验查询、核验弹层与真实浏览器走查、正式合同冻结 UI 与生成队列入口。

待完成：在本地真实浏览器完成冻结弹层的确认前走查和（使用临时夹具的）成功回拉走查；合同冻结后的正式交付门禁、自动发布、Provider 状态回写、支付/扣费联动、跨任务或整集合同，以及更通用的自定义业务要求编辑仍未接入。

## 安全边界

本步没有读取、修改或提交 API Key、`.env`、Cookie、正式媒体或本地业务夹具。真实业务只有用户在弹层中点击“确认冻结合同”才会写入；浏览器走查应使用临时夹具并在结束后恢复。
