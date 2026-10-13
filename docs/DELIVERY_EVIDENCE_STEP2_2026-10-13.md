# 交付证据第二步：任务事实快照

2026-10-13 本步完成服务端只读证据投影，范围停在“把已有任务事实安全地呈现出来”。它没有新增路由、交付门禁、冻结合同写入、对象存储读操作，也没有启动 Provider 或扣费。

## 本步改变

- 每条证据都绑定 `tenantId`、`projectId`、`taskId`、任务 `updatedAt` 和媒体版本。证据 ID 对同一快照稳定；组织、项目、任务、更新时间或媒体版本变化时会隔离出新的 ID。
- 合同草稿可以没有哈希；一旦填写冻结哈希，必须同时填写 `frozenAt`，冻结时间也不能没有哈希。合同要求 ID 在同一合同内唯一。
- 任务完成、Provider 回执、媒体候选、内容审核、刚性物理审计和连续性分别投影，不能用 Provider 已提交替代视频完成，也不能用技术完成替代内容审核。
- 媒体地址只表示服务端观察到候选地址，状态为 `observed`，不证明文件存在、可播放、内容正确或已通过验收。
- 视频媒体只接受视频任务的结果地址或 `mediaType: video` 输出；只有 `last-frame` 图片时不会产生视频媒体事实。
- 内容审核必须匹配当前 `videoReviewVersion`。刚性物理审计必须通过完整契约解析、任务已完成并匹配当前媒体版本；只有合同或残缺/过期审计时仍为 `pending`。
- 连续性必须同时满足当前内容审核、当前物理审计（若存在物理合同）和视频候选。合格尾帧描述符只产生 `observed` 候选，仍等待对象存储读取验证，所以本步不会报告 `continuity-ready` 通过。
- 证据详情只写入任务状态、Provider 状态、媒体版本、数量和审核状态等白名单事实，不复制任务任意 metadata。

## 实现位置

- 共享契约：`packages/contracts/src/delivery.ts`
- 契约测试：`packages/contracts/src/delivery.test.ts`
- API 只读投影：`apps/api/src/modules/generation/deliveryEvidence.ts`
- API 定向测试：`apps/api/src/modules/generation/deliveryEvidence.test.ts`

## 验证

- contracts 全量：22 个测试文件、118 个测试通过。
- API 证据投影：7 个测试通过。
- 两个改动范围的 Oxlint 通过；contracts 构建和 API 生产 TypeScript 构建通过。
- API 全量 `tsc --noEmit` 仍受仓库既有测试类型错误影响，未将该结果记为全仓通过；本步新增生产代码本身已由 API 生产构建检查。
- 未执行真实 Provider、对象存储、支付或预览重启。

## 下一步边界

后续再单独设计合同冻结服务、证据集合的同快照验证、对象存储可读性检查和交付接口。接入门禁前必须补齐合同身份/数量校验和跨证据版本选择，不能直接把本步快照当作最终交付判定。
