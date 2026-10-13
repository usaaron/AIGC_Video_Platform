# 交付合同第三步：冻结纯函数

2026-10-13 先完成合同冻结边界。合同冻结目前是 API 内部纯函数，没有路由、数据库字段、任务写回或交付门禁；对象存储验证作为下一次独立提交。

## 冻结规则

- 只接受未冻结草稿。输入已有 `contractHash` 或 `frozenAt` 时拒绝，避免静默重冻结已有合同。
- 先按共享 `deliveryContractSchema` 解析和规范化草稿，保留要求数组顺序，把对象键按字典序规范化。
- 用 `version`、`intent`、`expectedArtifact`、`must` 和传入的 `frozenAt` 组成规范 JSON，再计算 SHA-256 小写十六进制哈希。
- 返回同时具备 `contractHash` 和 `frozenAt` 的共享合同；调用者传入的对象不会被修改。
- 合同要求 ID 唯一、冻结哈希/时间成对存在的规则继续由共享契约负责。

## 实现和测试

- 实现：`apps/api/src/modules/generation/deliveryContractFreeze.ts`
- 测试：`apps/api/src/modules/generation/deliveryContractFreeze.test.ts`
- 覆盖同语义对象键顺序、含义变化、冻结时间变化、重复要求、重复冻结、非法时间和输入不可变。

本步没有读取对象存储、没有真实 Provider 调用、没有扣费，也没有改变现有任务。下一步会用现有 `ObjectStorage.get()` 验证当前尾帧描述符的可读性、大小和基础图片类型，并将存储结果保持在 `pending/failed/passed` 的事实层。
