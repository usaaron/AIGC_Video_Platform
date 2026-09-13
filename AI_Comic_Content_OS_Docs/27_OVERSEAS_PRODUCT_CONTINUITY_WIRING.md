# 海外产品连续性接线与离线验收

日期：2026-09-07。范围：六步方案的第 1 步，接入实际产品的临时账本与本集记忆召回。

## 结论

工程接线及离线验收通过。复用上轮 medium 的两集原始海外正文，在新建隔离 SQLite 中保存、读回，并构造第 1–3 集请求。物理模型请求为 0，没有新增正文生成或生成费用。第 3 集仅验证请求与提示词构造，不能计为第三集真实生成成功。

源样本位于 `.cache/real-generation-probe/overseas-medium-20260907/`，本轮最终证据位于 `.cache/real-generation-probe/overseas-ledger-final-20260907/`。原始正文和 run 元数据保持不变，其旧生成 ID 不代表新项目执行过模型生成。独立首集预检查位于 `.cache/real-generation-probe/overseas-ledger-preflight-20260907/`。

## 实际接线

`frontend/scripts/project-probe-continuity.mjs` 直接调用产品已有函数：Story Bible 人物、故事线和关系投影，`synchronizeContinuity`，`buildProvisionalContinuityCheckpoint`，`buildEpisodeMemoryRecall`。Python 通过 JSON stdin/stdout 调用 Node，子进程不继承模型凭据或 `NODE_OPTIONS`，失败时停止探针。

保存草稿后，投影结果写入 Workspace Snapshot 并从 API 重新读取核对。下一集必须恰好拥有此前连续集数，不能携带未来草稿，也不能以不匹配的正文生成交接摘要。所有正文 Artifact 和状态历史保持 provisional，不执行作者确认。

产品有两条读取路径，探针同时接入：

- `provisional_continuity_checkpoint` 供后台连续性 QC 读取。
- `memory_recall` 经实际生成服务编译后进入模型的结构化上下文。存在召回包时，产品不会再把旧账本全文重复放入提示词。

本轮验证实际结构化提示词段的编译和全部已选记忆文本，不调用模型，也不声称完成完整供应商请求验收。离线编译使用 128,000 context tokens 作为支持性上下文预算参数，记录在 summary 中。

## 修复

1. 测试人物 ID 去掉一层 `character.` 前缀，避免再次生成前缀后无法匹配批准路线图的人物引用；不修改用户人物 ID。
2. 产品世界状态仅在类型、状态域、名称及基础键均一致时，合并一层类型前缀差异，例如 `old_warehouse_key` 与 `item.old_warehouse_key`。保留最早键和按集数排列的历史。同名不同键、不同类型或不同状态域不合并。
3. 压缩账本为人物、世界状态和未完成义务分别预留预算，别名与事实一起入选，过大记录不阻止后续小记录入选。去重包含状态域，并优先保留最近时间约束。4,200 字符上限不变。
4. 记忆召回将 `schedule` 纳入硬事实优先级，避免旧物品记录挤掉最近的会面时间。

## 样本结果

| 后续请求 | 账本覆盖到 | QC 账本字符 | 世界状态保留/投影 | 未完成义务 | 最新时间约束进入召回 |
| --- | --- | --- | --- | --- | --- |
| 第 2 集 | 第 1 集 | 3,920 | 3/3 | 1 | 是 |
| 第 3 集 | 第 2 集 | 4,196 | 3/7 | 2 | 是 |

第 3 集的 QC 账本保留钥匙归属、工单原件归属、诺拉车站会面及两条义务。预算仍省略诺拉独立人物记录和四条世界状态；`summary.json` 明列省略项。因此不能宣称 QC 读取了完整无损账本。

同一请求的模型记忆召回保留 3 名人物、全部 7 条世界事实及会面时限；本样本仅省略第 1、2 集的旧路线约束。两种记忆包的预算和覆盖范围不同，不能把模型已收到某事实当作 QC 已检查该事实。

两集历史正文分别经当前 QC 离线评估为 warnings，第 2 集的 `checked_through_episode_number=1`，证明已读取前集状态；不是质量通过。合成负例另外验证：前集死亡状态经真实 Node 投影后，下一集当前时间线行动被后台判为阻断冲突。

## 验证

- 前端全量：383 passed，0 failed。
- Python 探针、计量与连续性专项：58 passed。
- TypeScript 与 `git diff --check`：通过。
- 原始 run 保存/读回一致，Workspace Snapshot 保存/读回一致，正文与历史保持 provisional。
- 首集预检查和完整离线审计：通过，均为 0 次物理模型请求。
- 本轮没有重跑后端全量、Playwright 或 production build；此前结果仍保留在 21、24、26 号记录中。

复现命令（输出目录必须尚不存在）：

```bash
.venv/bin/python scripts/run_real_generation_probe.py \
  --audit-continuity .cache/real-generation-probe/overseas-medium-20260907 \
  --output-dir .cache/real-generation-probe/overseas-ledger-new-audit
```

## 后续

六步方案还剩 5 步。下一步验证空流、断连后的有界重试及失败集恢复：已成功集不重生成，恢复沿用稳定请求 ID，重试计入实际供应商请求总额。之后再依次做语义审阅、海外三集真实验收、完整八集单元验收，以及认证、多租户和无人值守运行的生产化。

既有真实样本仍只有 2/3 集完成。全长质量、长程连续性、金额成本、未知用量和生产化缺口没有因为本轮离线通过而消失。
