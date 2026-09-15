# 面部确认与自动人像入库

`POST /api/v1/projects/:projectId/assets/:assetId/face-confirmation`

请求：`{ faceReference: { id, url, name } }`。
成功响应固定为 `{ asset, registrationTask: GenerationTask | null, registrationError: string | null }`。
需要登录、资产写入与生成权限，且只能确认当前账号拥有的项目资产。

前端先保存候选草稿，不更改 approval，再调用确认接口。服务端检查图片确实是当前项目的上传图片或当前人物已完成的面部生成输出。确认本身不依赖入库 Provider 配置；资产保存成功后，配置、余额或派发错误通过 `registrationError` 返回，HTTP 仍为 200。来源无效、权限不足等确认失败仍返回正常 HTTP 错误。

只有 `sourceMode=generate`、human、ai-virtual 且来源为已完成生成输出才自动入库。动物、真人授权素材和导入图片不自动入库，真人不会被确认接口改成 AI 来源。生成候选本身不会触发确认。

重复确认同一面部保留身体与造型版本；换脸清除当前身体确认、入库绑定和选中造型，保留造型历史。资源写回在资产行锁内再次核对面部、确认状态、主体类型和来源，旧任务不能覆盖不同的新面部。

同一面部的资源绑定也使用并发校验：写回时，当前资源 ID、分组 ID 和类型必须与请求开始时观察到的一致。刷新或注册结果迟到时不能覆盖新绑定；显式 bind 可以将 active 资源更换为另一个 processing 资源。后台回调继续保留既有状态与时间戳合并保护。

## 扣费和重试

- 自动任务的 clientRequestId 由组织、项目、资产和面部 id/url 确定。UI 通过 `/generation/tasks` 发起的手动入库和新自动确认接口，在扣费事务内锁定同一资产并匹配当前面部，避免并发创建两份任务。价格使用服务端固定值。
- 任务、扣费与 Outbox 在同一 PostgreSQL 事务提交。已存在任务会被复用；旧面部任务不会阻挡新面部。
- active/processing 资源不重复收费。手动请求优先复用任务；历史绑定没有对应任务时返回 409 `PORTRAIT_ALREADY_REGISTERED`，不新增收费任务。
- 自动入库失败后重复确认保留失败任务和提示，不自动重试扣费。显式手动重试可以创建一次新任务，并发的手动重试复用它。失败退款复用现有幂等账本。
- 入队派发失败但事务已提交时，返回已提交任务及错误，Outbox 保留待派发事件。

## 边界

面部保存与任务创建是两个事务；若进程恰在两者之间退出，重复确认可以恢复。上游资源创建 API 没有幂等键，崩溃于上游创建成功、本地写回之前仍可能留下上游孤立资源。任务完成后资源可能仍在 processing，继续使用现有资源刷新流程；后续审核失败不等同于任务执行失败，目前不自动补退已经完成任务的积分。

遗留 `/projects/:projectId/assets/:assetId/trusted-portrait/register` 接口直接调用 Provider，未纳入本次任务创建事务的去重范围，仍可能与后台任务并发创建上游资源。当前 UI 应继续通过生成任务接口进行手动入库。

## 验证

使用隔离测试数据库设置 `SEQORA_TEST_DATABASE_URL`，执行：

```powershell
pnpm --filter @seqora/api exec vitest run src/modules/trustedAssets/faceConfirmation.test.ts --maxWorkers=1
```

测试自动建立并清理独立 schema，使用 Provider 替身，不调用真实收费 API。其他专项：`faceConfirmationService.test.ts`、`trustedAssets/service.test.ts`、`generation/service.test.ts`、`generation/repository.test.ts`、`projects/repositoryLogic.test.ts`，以及 contracts 测试。
