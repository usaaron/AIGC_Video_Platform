# 交付对象存储验证第四步：尾帧可读性事实

2026-10-13 完成当前视频尾帧的只读对象存储验证。实现使用现有 `ObjectStorage.get()`，不新增接口、不写任务状态、不调用 Provider，也不把可读性当作内容质量或最终交付。

## 验证规则

- 只验证已完成的视频任务，并要求 `generatedOutputs` 的 `last-frame` 描述符与当前 `lastFrameStorageKey` 完全一致。
- 存储键必须落在当前组织、项目和任务的 `generated/{taskId}-` 前缀下，防止 metadata 指向其他组织或任务的对象。
- 没有对象存储、没有当前尾帧、任务未完成或临时读取错误时返回 `pending`。
- 明确不存在（包括本地 `ENOENT` 和 GCS 404）、空对象、记录大小不符、PNG/JPEG/GIF/WebP 签名不符时返回 `failed`。
- 读取成功只证明当前键可读、非空、大小和基础图片类型匹配；本步没有校验对象代次或 SHA-256，也没有证明视频内容正确。
- 连续性证据只有在内容审核/物理状态已经允许、尾帧候选存在且存储读取通过时才升级为 `passed`；审核拒绝仍为 `failed`。

## 实现和测试

- 尾帧投影：`apps/api/src/modules/generation/deliveryEvidence.ts`
- 存储验证：`apps/api/src/modules/generation/deliveryStorageVerification.ts`
- 测试：`apps/api/src/modules/generation/deliveryStorageVerification.test.ts`

本步新增存储边界覆盖，并与合同冻结、证据投影合计 17 个定向测试通过。验证仍未接入路由或发布门禁；后续如需持久化合同或防止同一 key 被覆盖，需要在 Repository 层加入组织/项目/任务绑定、乐观并发和对象代次或内容哈希。
