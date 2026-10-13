# 交付合同第五步：任务级冻结边界

2026-10-13 将前一步的合同冻结纯函数接入任务级 Repository 和受权限保护的 API 边界。合同写入任务 metadata，不新增 migration；冻结动作只改变合同和 `updatedAt`，不会派发生成、扣费、调用 Provider 或开启交付门禁。

## 请求和约束

- 接口：`POST /api/v1/generation/tasks/:taskId/delivery-contract`。
- 请求包含 `expectedUpdatedAt` 和未冻结的 `contract`；共享契约先校验时间、项目意图、产物数量和要求 ID。
- 请求必须通过 `GENERATION_TASK_CREATE` 权限，并由现有任务查询按组织和用户范围定位任务。
- 合同的 `intent.projectId` 必须等于任务项目；取消中的任务不能冻结。
- `expectedUpdatedAt` 采用乐观并发检查。成功后只允许再次读回，重复写入返回 `DELIVERY_CONTRACT_ALREADY_FROZEN`，过期时间返回 `DELIVERY_CONTRACT_STALE`。
- 合同冻结时间由服务端生成，合同哈希由服务端计算。任务创建时会剥离用户传入的 `deliveryContract`，避免伪造已冻结合同进入任务 metadata。

## 实现和测试

- 共享请求契约：`packages/contracts/src/delivery.ts`。
- 任务写入边界：`apps/api/src/modules/generation/repository.ts`。
- Service/HTTP 映射：`apps/api/src/modules/generation/service.ts`、`routes.ts`。
- 防伪入口：`apps/api/src/modules/generation/taskCreation.ts`。
- 测试：`deliveryContractRepository.test.ts`、`deliveryContractHttp.test.ts` 及共享契约测试。

本步已验证组织隔离、项目范围、权限、取消任务、乐观并发、重复冻结和用户 metadata 伪造保护。对象存储验证仍是只读事实层；合同尚未接入自动交付门禁，后续应单独设计证据写入、对象代次/内容哈希和最终发布条件。
