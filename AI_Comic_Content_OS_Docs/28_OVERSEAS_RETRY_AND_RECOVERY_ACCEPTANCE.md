# 海外重试与恢复故障验收

日期：2026-09-07。范围：六步方案第 2 步，有界重试、失败集恢复与成功集保护。

## 结论

故障注入验收通过，并修复三处恢复问题。新增测试使用假供应商响应或 Mock 模型阶段，不连接真实模型，不产生生成费用。真实海外三集仍只有此前 2/3 集完成，本轮不是新增真实生成验收。

## 修复及证据

| 场景 | 修复前 | 修复后/验收结果 |
| --- | --- | --- |
| 空 SSE 后同步输出也为空，适配器重试数 0 | 后处理重复恢复，共 5 次传输调用 | 3 次：SSE、JSON、JSON，然后停止 |
| 同上，适配器重试数 1 | 共 6 次传输调用 | 4 次：SSE、SSE、JSON、JSON，然后停止 |
| 只有推理文本且返回 max_output_tokens，适配器重试数 1 | 原样再次请求，共 2 次 SSE | 1 次 SSE，不重复相同预算；重试数 0、1、3 均验证 |
| 部分正文后连接中断 | 已有同步回退行为 | 验证共 2 次传输调用恢复成功，部分流不重复 SSE |
| 传输总额限制为 1 | 必须阻止同步回退越界 | 实际调用 1 次，下一次在传输前被探针拦截 |
| 浏览器最终 JSON 事件被截断 | 普通 SyntaxError，无断流恢复 | 归类 stream_incomplete；最多 3 次浏览器尝试 |
| 第 1 集已保存、第 2 集遇到空流及截断 | 需要验证恢复身份和范围 | 只请求第 2 集，3 次尝试的请求体和 Agent ID 完全一致 |

表中的传输次数来自被替换的 HTTPTransport 入口，是真实适配器逻辑经过的调用次数，但响应由测试提供，不是供应商账单或真实付费请求。

后端适配器现在也在结构化输出异常上保留 `stream_fallback_attempted`。后处理看到已执行的同步回退或已耗尽的空响应重试时，停止新增相同请求。未尝试恢复的非空畸形 JSON 仍沿用原有修复路径。

推理预算耗尽的判断在内部 SSE 重试前生效，同时供后续同步回退判断复用。前端仅将没有完整事件边界且无法解析的尾部事件视为断流；完整坏 JSON 和应用回调异常保留原错误，不混入网络重试。

## 持久化恢复

新增集成测试运行实际 `EpisodeScriptAgent`、生成服务和 SQLite 持久化，模型阶段使用 Mock：

1. 完成第 1 集，并保存其结果摘要。
2. 第 2 集完成初稿阶段后，注入后处理断连，保留已验证的初稿检查点。
3. 释放数据库引擎，重建数据库 runtime 和 Agent，再用相同请求恢复第 2 集。初稿模型阶段调用数不增加，Agent 尝试次数为 2。
4. 重读第 1 集，稳定业务结果一致；再启动独立 Python 进程读取该完成结果，模型阶段禁止执行、网络请求上限为 0，读取仍成功。

这是已验证阶段的恢复和完成结果重放。没有实现从供应商输出的某个字节继续接收，也没有新增无人值守后台任务。

## 验证记录

- 后端全量：1,019 passed，1 skipped；显式设置 `RUN_REAL_LLM_INTEGRATION=0`，跳过真实模型测试。
- 前端全量：387 passed，0 failed。
- TypeScript 与 `git diff --check`：通过。
- 新增后端恢复用例 5 项、推理预算测试扩展为 3 个参数；前端新增尾帧/回调保护与海外恢复行为用例 4 项。
- JUnit 证据：`.cache/overseas-recovery-backend-20260907.xml`、`.cache/overseas-recovery-frontend-20260907.xml`。
- 本轮未重跑 Playwright、production build 或真实供应商长任务。
- 本地后端已重启加载修复，两条市场资源已初始化；重启前后 5 个项目的返回数据摘要一致，前后端页面与 API 均可访问。

定向复现：

```bash
RUN_REAL_LLM_INTEGRATION=0 .venv/bin/pytest \
  tests/test_overseas_recovery_acceptance.py \
  tests/test_llm_adapter.py -k 'overseas_recovery or reasoning_only_responses_budget_exhaustion' -q
```

前端在 `frontend` 目录执行：

```bash
node --no-warnings --experimental-strip-types \
  --import ./scripts/register-test-runtime.mjs --test \
  tests/overseas-recovery-acceptance.test.mjs tests/api-event-stream.test.mjs
```

## 剩余边界

浏览器尝试数、适配器重试数、服务修复阶段数和整轮物理请求数是不同层次。浏览器上限 3 不代表最多 3 次模型调用。真实探针继续通过 ProviderRequestMeter 约束整轮请求和时间；产品尚无统一的跨层金额预算，这仍属于生产化工作。

本轮证明可控故障下的停止与恢复行为，不能证明真实供应商的延迟、账单或长篇成功率。六步方案还剩 4 步，下一步为正文语义审阅及验收标准，随后是海外三集真实复测、八集单元验收和生产化。
