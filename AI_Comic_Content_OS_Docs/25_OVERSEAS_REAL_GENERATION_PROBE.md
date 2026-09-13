# 海外路径真实生成抽样测试

日期：2026-09-07。用户明确要求测试海外路径。采用隔离数据库和固定规划输入，未改写用户项目或批准生成正文。

## 测试范围

- 市场为 `overseas_tiktok`，请求为 `release_region=overseas`、`output_language=en`。
- 使用当前配置的 `gpt-5.6-sol` 正文路由和 `strategy.tiktok.frontend_mvp.dark_romance.v1`。
- 固定 8 万字 / 48 集项目的总纲、首个 8 集节点及前三集路线图，只抽样生成前三集；不以此验收 AI 规划或整部长篇容量。
- 固定海外语境人物伊芙 / Eve Hart、亚当 / Adam Cole、诺拉 / Nora Reed；正文非台词使用中文，英文对白必须有中文人物名和逐句中文翻译。
- 在底层 HTTPTransport 统计所有真实请求，包含重试和修复；缺失用量保持未知，不能按零计算费用。

## 初次结果与修复

| 轮次 | 请求数 | 耗时 | 结果 |
| --- | --- | --- | --- |
| 初次海外抽样 | 4 | 44.216 秒 | 第 1 集失败，0/3 集完成；后两次请求 HTTP 400。 |
| 有界诊断复测 | 3 | 70.896 秒 | 复现严格 Schema 错误，并遇到账户并发限流 HTTP 429。 |
| Schema 修复后 | 2 | 902.110 秒 | 完成 1/3 集；第 2 集触发本轮 900 秒时限，第 3 集未启动。 |

上游明确返回：

```text
Invalid schema for response_format 'llmgenerateddraftmasterscript':
context=('properties', 'ending_mode'), $ref cannot have keywords {'default'}.
```

`RealLLMAdapter._normalize_strict_json_schema` 已修复：仅删除供应商 Schema 副本中 `$ref` 旁的 `default` 注解。严格输出、枚举、必填字段、本地模型默认值和名为 `default` 的业务属性均保留。

新增 3 项 Schema 回归，适配器测试合计 `100 passed`。生产修复后后端全量 `979 passed, 1 skipped`；随后补充重放比较检查，探针请求计量、双语导出、日志脱敏及重放定向测试 `15 passed`。跳过项不构成真实模型验收证据。本地后端已重载修复并恢复两条市场的开发资源，已有项目数仍为 5。

## 修复后真实样本

| 项目 | 实测结果 |
| --- | --- |
| 完成量 | 第 1 集完成；第 2 集中止；第 3 集未启动 |
| 第 1 集有效正文 | 1,189 字符：中文动作 372、英文对白 817；不计中文译文及规划字段，不是英文单词数 |
| 第 1 集结构 | 3 场、16 条动作、30 句对白；目标正文 1,667 字符，实际约为目标的 71.3% |
| 第 1 集耗时 | API 462.211 秒；供应商请求 461.923 秒 |
| 第 2 集停止 | 供应商已返回 HTTP 200 流，但读取 439.072 秒后触发探针 `ProbeLimitExceeded`；应用返回 500，未取得完整正文 |
| 语言契约 | 30 句英文均具备中文人物名和逐句译文；人物中英名、非对白中文检查通过 |
| 前端转换 | 实际正文经 `buildEmbeddedOverseasDialogueView` 生成 62 个唯一展示路径；缺名 0、缺译文 0、警告 0、网络请求 0 |
| 自动连续性诊断 | 阻断项 0，但阅读审查发现下述状态冲突；不能据此标为内容合格 |

第 2 集是在全轮时限内等待完整流式结果时中止，HTTP 200 不能视为正文生成成功。此次 500 来自测试探针主动抛出的限制异常，不等同于复现了生产环境的供应商超时处理。底层请求均已结束，修复轮 `in_progress_requests=0`。

## 正文阅读发现

以下为代码助手基于原文、结构化状态和固定路线图的阅读审查，不是真人编导盲评。保留原始生成结果，没有修改样本来使测试通过。

| 级别 | 证据 | 影响 |
| --- | --- | --- |
| P2 | 第 1 集 `draft.json:111` 仍将“持有旧仓库钥匙”列为亚当能力，但 `draft.json:169` 和 `SCREENPLAY.md:141` 已明确交给伊芙 | 人物状态与物品状态冲突，可能影响使用该账本的续集；本探针只传正文交接摘要，未注入完整结构化账本，不能断言错误已经传播 |
| P2 | `draft.json:182` 将尚待今晚转运的工单标为 `transition=transferred` | 将未来事件提前标为完成；同条 `current_state` 仍描述未来时限，结构化语义不一致 |
| P2 | `SCREENPLAY.md:81` 从付款时间直接断言证明事故前准备赔偿，未展示款项用途或收款人核验 | 证据推断过强；固定规划要求确认时间异常并保留进一步核验的必要性 |
| P3 | `SCREENPLAY.md:123` 的 “You can get us inside?” 译为“你能进去？”，另有译文增加“致辞” | 译文存在动作信息遗漏和轻微补义；字段齐全不等于语义准确 |
| P3 | 第 117 行已说明工单位于旧仓库，第 143 行再次问原件所在地，仅补充档案间 | 局部重复，信息推进偏少 |

已兑现的规划包括保护证人名单、核对两小时差、取得钥匙、得知当晚转运并共同前往仓库。人物中英名稳定，没有大段情节空转；上述问题仍使本样本无法作为“质量与连续性已通过”的依据。

## 用量、速度与恢复

三轮海外测试合计 9 次物理请求，低于本次累计最多 12 次的限制。其中只有成功的第 1 集返回完整用量：输入 18,156 tokens、输出 10,016 tokens、合计 28,172 tokens；输入中 17,152 为缓存 tokens，是输入的子集，不能再次相加。其余 8 次请求用量未知，包括时限中止的第 2 集，不能按零费用处理。

未配置可核对的供应商计费价目，本次不估填金额、每万字成本或整部成本。输出 tokens 包含完整结构化结果及供应商的计量口径，不能全部归为可见正文。单集约 7 分 42 秒且三集抽样未在 15 分钟内完成，当前速度尚不满足稳定连续生成的验收要求；没有足够样本估算延迟分位数或全长耗时。

重启后幂等读取通过：新进程使用相同 `agent_request_id` 返回 HTTP 200，模型请求 0；正文与全部稳定业务字段一致。完整响应摘要不同是既有检查点压缩策略导致，仅涉及 `data.llm_raw_output`、`data.prompt_build_result.prompt_text` 和 `data.prompt_build_result.rendered_variables` 三类调试字段。探针显式排除这三项并严格比较其他结果，同时保留 `identical_full_response=false`，没有将整个响应声称为逐字相同。证据见 `replay_verification.json`。

本项只验证已完成集的幂等读取，不代表第 2 集的流式中断已经支持断点续传，也不代表无人值守队列、自动退避或后台任务恢复已验收。

## 产物与复现

入口：`scripts/run_real_generation_probe.py`。脚本会创建新的输出目录和独立 SQLite 数据库，已有目录不会覆盖。

```bash
set -a
source .env.local
set +a
.venv/bin/python scripts/run_real_generation_probe.py \
  --release-region overseas --episodes 3 --max-provider-requests 12
```

`--prepare-only` 阻止所有模型请求，用于固定输入和请求结构预检。`--verify-replay --output-dir <已完成测试目录>` 在新进程中禁止模型请求并验证已保存结果的幂等读取；只有实际生成完成后才具备此项验证条件。

本次证据目录：

- `.cache/real-generation-probe/overseas-20260907/`：初次海外失败记录。
- `.cache/real-generation-probe/overseas-diagnostic-20260907/`：脱敏供应商错误详情。
- `.cache/real-generation-probe/overseas-fixed-20260907/`：修复后结果。

先前按默认大陆路径启动的测试已停止，独立归档于 `.cache/real-generation-probe/sample-20260907/INTERRUPTED.md`，不计入海外结果。

## 验收边界

本轮确认海外严格 Schema 阻塞已修复，实际双语正文能够生成、保存并进入前端转换。尚未通过的是连续三集完成率、状态语义一致性、译文语义精度、成本完整计量和长篇验收；身份认证、多租户及后台无人值守任务也不在此隔离正文探针的测试范围。

后续复核确认：本探针的 `memory_layer=provisional` 并不代表实际发送了结构化 `provisional_continuity_checkpoint`；请求通过 `previous_episode_handoff` 和 `project_continuity_summary` 承接正文摘要。因此，自动连续性报告的 `not_applicable` 及零阻断项不能作为完整跨集账本检查通过的证据。修复与复测见 [26_OVERSEAS_CONTINUITY_AND_LATENCY_RETEST.md](26_OVERSEAS_CONTINUITY_AND_LATENCY_RETEST.md)。

下一步应先修复并校准人物状态与物品状态的冲突诊断，再针对当前路由的高推理配置和输出负担做同输入的有界速度/质量对照，并补齐供应商账单对账。随后完成连续三集和跨进程中断恢复，再扩大到一个完整规划单元。当前不宜直接投入整部 8–20 万字无人值守生成。
