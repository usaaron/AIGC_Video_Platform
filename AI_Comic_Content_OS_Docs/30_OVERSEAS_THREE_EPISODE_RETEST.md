# 海外三集真实复测

日期：2026-09-07。范围：六步方案第 4 步，加载产品临时账本、恢复修复和第 3 步语义提示约束，实际调用海外正文路线。

## 结果

本轮已执行，但验收未通过。900 秒进程总时限到达后停止，仅发起 1 次供应商传输请求，第一集没有完成，第二、三集未启动。没有追加模型请求，也没有把已有历史正文当作本轮结果。

| 项目 | 本轮证据 |
| --- | --- |
| 目标完成量 | 0/3 集；已启动集为 0/1 完成 |
| 实际路线 | `overseas` / `gpt-5.6-sol` / Responses SSE |
| 实际请求参数 | `reasoning_effort=medium`，输出预算 32,000 tokens |
| 物理请求上限 / 已发起 | 6 / 1 |
| 整进程时限 | 900 秒；watchdog 返回 124，测试进程组已退出 |
| 请求启动时间 | `2026-09-07T14:35:58.077132+00:00` |
| 停止时点观察 | `2026-09-07 14:50:55 UTC` |
| 最后阶段 | 第 1 集 `generate_pre_edit_episode_script`，尚无完成的初稿检查点 |
| 正文制品 / 有效正文 | 0 / 0 |
| HTTP 状态、首字节、完整响应时长 | 本轮持久日志无法确定 |
| tokens / 金额 | 此 1 次请求用量未知，不能计为零费用 |
| 语义与三集连续性 | `not_assessed`，没有新正文可审阅 |

32,000 是请求的输出预算，不是实际消耗。客户端进程停止也不能证明供应商已取消计算或停止计费。此处只记录本地观察，不填写无来源的金额。

本轮与上轮 medium 的差异是：上轮 900 秒、6 次请求完成 2/3 集，本轮在相同总时限下，首个请求一直未形成可保存初稿，完成 0/3 集。这证明本次表现未达标；由于账本和提示词也有变化、样本数有限，不能据此确定是模型、网关、负载或提示改动导致，也不能判断第 3 步提示修正是否改善语义。

## 隔离与输入

正式目录：`.cache/real-generation-probe/overseas-three-ledger-20260907/`。

预检目录：`.cache/real-generation-probe/overseas-three-preflight-20260907/`。预检使用 0 请求额度，完成资源初始化和首集请求构造；前三集叙事规划与历史 medium 测试一致，只允许新隔离项目的来源 ID 不同，人物中英文映射相同。

正式测试从第一集开始，使用新 SQLite、固定已批准的测试规划和产品 TypeScript 账本投影。首集请求包含 `version=provisional`、`through_episode_number=0` 的检查点及本集记忆召回。这只能证明首集接线，不能证明第二、三集已消费本轮前文，因为它们没有启动。

实际只有首个正文请求，其参数由 `provider_requests.jsonl` 确认。没有运行后处理或备用路线；因此不泛称所有潜在阶段都使用 medium。override 仅作用于测试进程，未改日常配置。

## 已确认的诊断边界与修正

启动前发现，原探针在请求发出前和收到响应块时检查 deadline，socket 超时又是在请求开始时设置，不能单独保证总耗时不超过 900 秒。因此新增 `scripts/run_with_wall_timeout.py`：启动独立进程组，900 秒到限终止该组，避免阻塞读取拖长整轮。本轮实际触发并停止，没有触发新的生成恢复。

终止后发现，原 meter 虽在内存中记录响应头和首字节时间，但只在请求结束时写入最终记录。当前请求没有结束，日志仅有 `request_started`；不能将其中的 `status_code=null` 理解为确认没有收到 HTTP 响应，也不能断言没有任何流式字节。

测试结束后已改为收到响应头、收到首个响应体字节时立即写入不含正文、地址或凭据的事件。同时让探针在正式生成前保存 `run_manifest.json`，保留启动参数和源码指纹。这些诊断改进没有用于刚结束的请求，也无法补回已丢失的时点；下次运行才能获得更完整证据。

## 保存的证据

- `fixed_inputs.json`：本轮测试规划与初始工作区。
- `episode_001/request.json`：实际首集请求。
- `provider_requests.jsonl`：1 条 `request_started`，原日志未被改写为成功或失败响应。
- `route_diagnostics.log`：首集初稿路线及 35,597 个 prompt 字符的启动记录，不记录凭据。
- `launch_observation.json`：运行期间观察并保存的 16 份源码指纹与启动约束；它不是脚本原生启动回执。
- `watchdog_result.json`：进程退出后，根据原日志、只读数据库和 watchdog 退出码重建的诊断结论，明确标为 `post_watchdog_evidence_reconstruction`，不是模型返回结果。
- `probe.db`：`agent_runs` 和 `agent_steps` 保留被终止前的 `running` 状态；验证检查点数 0、Episode Artifact 数 0。这个状态是中断快照，不表示测试进程仍在运行。

没有 `draft.json` 或完成的 `run.json`，因此不执行正文语义审阅、完成结果重放或双语展示验收。没有修改原始数据库去伪造失败回执，也没有声称可从供应商的未完成输出继续接收。

## 工程验证

相关定向测试：19 passed，3.04 秒；全程使用假响应或本地测试子进程，真实模型集成显式关闭。覆盖请求额度、未知用量、脱敏、流式传递、即时落盘、正常退出码和超时停止后代进程。证据：`.cache/overseas-three-probe-20260907.xml`。

本轮只改探针及其测试，生产后端无新增修改；没有重复全量后端或前端测试。此前后端全量 1020 passed、1 skipped 和前端 387 passed 的记录仍是历史证据，不增加为本轮全量通过数。

真实执行命令：

```bash
set -a
source .env.local
set +a
.venv/bin/python scripts/run_with_wall_timeout.py --seconds 900 -- \
  .venv/bin/python scripts/run_real_generation_probe.py \
  --release-region overseas --script-reasoning-effort medium \
  --episodes 3 --max-provider-requests 6 --deadline-seconds 900 \
  --request-timeout-seconds 180 \
  --output-dir .cache/real-generation-probe/overseas-three-ledger-20260907
```

已有目录拒绝覆盖；上述命令记录本轮实际参数，再执行时必须使用新目录。`request-timeout-seconds` 限制 socket 操作等待，不是单集的总时长，整轮上限由外部 watchdog 保证。

## 下一步

第 4 步仍未通过，六步方案仍剩 3 步，不能推进为“只剩生产化”。下一项工作应定位海外请求长期不结束的阶段：使用新增的响应头/首字节记录，结合现有 Agent 阶段，区分连接等待、响应体开始后的拖延及正文后处理；必要时在新的明确预算内做小输出诊断与实际单集对照。单次短响应成功也不能替代三集正文验收。

之后重新验证三集完整生成，再按第 29 号报告的统一标准检查证据因果、双语语义、人物知识和跨集义务。三集通过后才进入第 5 步八集单元；认证、多租户、统一金额预算和无人值守运行仍属于第 6 步。
