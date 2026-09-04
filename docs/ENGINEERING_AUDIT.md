# 全量工程化审查记录

> 审查日期：2026-08-27
> 审查范围：创作端、管理员端、API、Worker、共享包、部署、测试、文档和依赖
> 目标规模：约 3000 个注册用户，峰值 300 人同时在线，生成任务允许排队

本文记录工程化升级前的清理边界。它不是生产部署说明；生产环境、数据和密钥仍以运维手册及实际云端配置为准。

## 审查结论

当前仓库可以继续作为模块化单体升级，暂时不需要拆成微服务或引入 Kubernetes。已具备的基础包括：

- `apps/web`、`apps/admin`、`apps/api`、`packages/contracts`、`packages/prompting` 的边界清楚。
- Postgres 是生产业务数据源，Redis/BullMQ 负责任务触发，Worker 独立消费任务。
- 数据库 migration 已采用追加式约束。
- 管理端、组织隔离、积分账本、任务状态、备份恢复和健康检查已有对应代码或门禁。
- CI 已覆盖格式、Lint、依赖审计、迁移规则、后端测试、构建和部署后的探针。

当前主要问题不是文件数量，而是单机部署、对象存储迁移、Provider 限流和部分历史兼容层仍未完成工程化收口。

## 本次已清理

- 删除已退出运行时装配的 Aideos Seedance Provider 及其测试，共删除约 400 行死代码。
- `VideoProviderName` 只保留当前真实运行的 `dora-router-seedance`、`stringx-seedance` 和 `volc-ark-seedance`。
- 删除 Compose 中无人读取的 `DEMO_UNLIMITED_GENERATION_CONCURRENCY` 和 `TASK_WORKER_MODE` 注入项，避免让运维误以为这两个开关仍然有效。
- 同步修正架构和资产生成文档中对 Aideos 的过期描述。

## 暂不删除

以下内容看起来像旧代码，但目前仍有明确职责：

| 内容                                                              | 保留原因                                             | 后续处理                                             |
| ----------------------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------- |
| `apps/api/src/infra/migrations/*`                                 | 已部署数据库的追加式历史，删除会破坏新环境和回滚审计 | 永久保留；只新增 migration                           |
| Postgres Repository 与 JSON Store 兼容层                          | 支持现有数据迁移、本地无数据库开发和历史媒体索引     | 完成媒体及任务仓储收口后再按模块删除                 |
| `TOKENADVENT_*`、`TEXT_API_KEY` 兼容变量                          | 当前部分环境仍可能依赖旧变量命名                     | 迁移到新变量并完成环境验收后删除兼容读取             |
| `deploy/bootstrap-gce.sh`、源码包发布和恢复脚本                   | 当前 GCE 生产回滚及历史初始化仍依赖                  | 阿里云预发/生产切换成功并完成回滚演练后归档          |
| `compose.local.yml`                                               | 本地 Postgres/Redis 开发和测试隔离                   | 保留；与生产 Compose 分开                            |
| `sceneMasterPilot.ts`、`twoMinuteWebDramaDemo.ts` 等演示/回归脚本 | 真实 Provider 回归和演示复现入口                     | 迁移为独立 demo 工具目录并标注付费调用，暂不删除     |
| `apps/api/src/modules/novels/*`                                   | 长剧本和摘要队列仍有实验/兼容数据职责                | 产品入口关闭不等于数据层可删除，待迁移策略确定后处理 |

## 发现的风险

### 必须先处理

1. 本地忽略的部署环境文件曾包含 Provider 密钥，不能提交、打包或打印。已经暴露过的密钥必须在对应上游轮换；新环境使用阿里云 Secrets Manager/KMS 或同等托管密钥服务。
2. 当前生产仍是单台 GCE Compose，API、Worker、Postgres、Redis 和 Web 存在共同故障域。
3. 当前线上失败任务数量较高，迁移前必须按 Provider、超时、取消、合成和输入错误分类，不能直接清理历史任务。
4. 当前媒体存储和旧环境变量仍需要一次真实配置核对；在迁移前不能假设所有媒体都已进入私有对象存储。
5. 通用生成任务的积分估算仍有客户端输入参与，扩大内测前必须收口为服务端定价和幂等扣费。

### 工程化阶段处理

- API 至少双实例，Worker 按文本、图片、视频和 FFmpeg 合成分开限流。
- Postgres 迁移到阿里云 RDS，Redis 迁移到 Tair，媒体迁移到私有 OSS 并通过 CDN 读取。
- 增加用户/组织配额、Provider 并发、任务超时、积压、Worker 心跳和成本告警。
- Agent 固化为可恢复阶段状态机：`plan -> confirm -> script -> assets -> shots -> videos -> compose`。
- 预发使用独立数据库、Redis、OSS 和队列；生产数据只能脱敏后用于回归。
- 发布必须支持 migration 前备份、健康检查失败回滚和运行中任务恢复。

## 质量基线

本次清理前后均应至少执行：

```powershell
pnpm format:check
pnpm lint
pnpm check:deployment-security
pnpm check:organization-api
pnpm test:backend:unit
pnpm build
```

涉及 Postgres、队列、认证、积分或发布配置的改动，还必须执行 CI 中的数据库集成、安全测试和预发冒烟测试。真实 Provider 生成不属于本地质量门禁，必须使用测试替身或经过明确批准的预发任务。

## 删除判定规则

后续每删除一个历史模块，必须同时满足：

1. 没有生产配置、运行时代码、迁移脚本、回滚脚本或文档入口引用。
2. 现有数据不再读取该模块写入的字段或对象。
3. 有对应测试覆盖替代路径，并完成一次预发回归。
4. 能通过一次发布回滚恢复，不依赖被删除的代码。

在满足这些条件前，保留兼容层比追求代码数量更安全。
