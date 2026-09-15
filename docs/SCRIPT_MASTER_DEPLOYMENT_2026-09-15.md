# 剧本大师独立服务部署验收 · 2026-09-15

## 问题与结果

前一次只发布宿主 `2f80581`，独立 `project111-final2` 前后端和连接配置没有部署，
导致入口显示尚未配置。现已补齐独立服务，实际主站 iframe 正常加载工作台。

本次修复了启动凭证 300 秒到期后无法继续调用、跨账号共享项目/缓存的问题。
组织与用户组合决定独立数据库 schema 及浏览器缓存。主站会话续领短期票据，
临时网络失败有限重试，身份变更停止旧页面同步。迁移和静态资料初始化不调用模型。

## 实际运行版本

| 组件              | 运行版本                                                   |
| ----------------- | ---------------------------------------------------------- |
| 宿主 API / Worker | `seqora-api:2f8058164f8a`，保持前次已发布业务代码          |
| 主站资源          | 保持上述发布版本的 Web/Admin 页面                          |
| Web/Caddy 网关    | `seqora-web:2a13788-gateway`，增加独立服务路由和专用响应头 |
| 剧本大师 API      | `script-master-api:f3d62e11f9a8`                           |
| 剧本大师 Next.js  | `script-master-web:f3d62e11f9a8`                           |
| 剧本大师数据库    | 单独 PostgreSQL 16，单独应用角色和持久卷                   |

独立源码 commit：`f3d62e11f9a88bc1c7fab16f81bc533b469da555`，
本地分支 `codex/script-master-production-20260915`，源自 `final2` 的 `d659fb0`。
原独立仓库权限已撤回；本地 Git 历史、服务器 source bundle 和源码包均已保留，
此处不代表独立仓库已推送成功。宿主变更在 `codex/script-master-merged-20260914`。

独立服务目录 `/opt/script-master/current` 指向
`/opt/script-master/releases/f3d62e11f9a8`。Compose 项目 `script-master` 与主站独立。
只有 Next 前端接入主站私有网络，新 API、数据库均无公网映射。

## 验证证据

- 独立前端 599 项单测通过，TypeScript 检查通过；Linux Next.js 生产构建通过。
- 后端本次相关回归 156 项通过，其中 8 项使用临时真实 PostgreSQL 16：
  同组织不同账号、跨组织、相同资源 ID、连接池/事务、外键、迁移并发、权限、SSE、请求上下文失效。
- 新独立生产数据库用非超级用户完成迁移；两市场静态资料为 2 个平台、74 个标签、
  101 个静态参考资产、5 个提示词、4 个生成策略。
- 线上浏览器从主站侧栏打开剧本大师，显示“服务已连接”和真实 iframe 项目库；
  新建剧本表单、发行地区选项与大陆标签正常。没有点击付费的输入检查/生成按钮。
- 通过正式 HTTPS 链路及主站测试账号验证 config/launch、页面响应、4 个静态资源、
  标签/策略 API、项目创建/版本更新/重新读取。临时项目已通过业务删除 API 清理并核对 404。
- 主站 health 200、readiness `ready=true`；独立 API/Next/DB healthy，服务 restart count 均为 0。
- 未登录的主站身份、剧本大师配置/入口/API、Admin 均返回 401。
- 内部独立 API 无票据返回 401，生产 docs/openapi 返回 404。
- 实际响应核对：主站继续 `X-Frame-Options: DENY`；剧本大师路径为 `SAMEORIGIN` 和
  `frame-ancestors 'self'`。首次切换发现全局响应头覆盖专用规则，已在 `2a13788` 修复。
- 对比切换前后 env，所有非 `SCRIPT_MASTER_*` 配置值完整保留，包括 DoraRouter。
- 宿主格式检查、部署安全门禁、Caddy validate、Git diff 检查通过。

## 仍未验收或未完成

- 宿主 `pnpm check` 停在既有行数门禁：`App.jsx` 1020 > 1000、`app.test.ts` 5270 > 5267；
  本次没有放宽门禁。因此上述为专项回归，不是整个产品全部检查通过。
- 没有触发真实付费模型调用，没有证明实际 100 集能在一天内完成。
- 独立生成项目尚无宿主目标项目选择/创建映射；绑定宿主项目后交接仍缺完整事务与稳定分集映射。
- 原有实验采集/评估仓库仍为进程内存持久期，当前独立 API 单进程运行。
- 长剧本仍沿用原前端调度/后端检查点链路，未额外实现浏览器关闭后的全剧后台任务。
- 支付为模拟、完整成片移除音轨、DoraRouter 素材库接口 404 等既有问题不属于本次部署修复。

## 备份与回退

- 发布前宿主备份：`/opt/seqora-backups/script-master-20260915T060748Z`，含 5,075,198 字节数据库 dump 和配置。
- 切换前配置：`/opt/seqora-backups/script-master-cutover-20260915T063245Z`。
- 独立发布包 SHA256：`f2045a5bb78b83d1990f4ee55bd1ff2b9fab4789731c2dd6a317b0e3995e94cc`。
- 独立发布目录保留 `source.tgz` 和完整 `source.bundle`；密钥仅位于独立 shared 目录。
- 首次接入回退：恢复切换前宿主 env/release/Caddyfile，并同时读取两个 env 文件重建 API/Web；
  独立数据库应保留。后续独立版本更新前需单独备份其 PostgreSQL 和评估报告卷。

完整部署命令与架构见 [独立接入说明](SCRIPT_MASTER_INTEGRATION.md) 及独立源码 `deploy/README.md`。
