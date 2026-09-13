# 海外提示前约束与第三集性能补测

日期：2026-09-08（Asia/Shanghai）。承接第 41 号报告。本轮继续按“创意质量、一致性、连续性第一，速度也重要，不考虑 token 消耗”推进，并把上一轮正文审阅发现的表演问题转成生成前执行约束。

## 本轮改动

`backend/app/modules/script_engine/prompt_builder.py` 的海外正文合同增加三类前置执行规则：

- 先落实人物站位、可听距离、通话或其他通信渠道，再写远距离对白；设备关闭后再次使用必须交代开启。
- 已接受的条件在后场直接兑现，只有新风险、违约、代价或争议条款出现时才重新谈判；按人物目标区分说话策略。
- 结尾在揭示或交接后保留受影响人物的可见后果；账本、钩子和下一集问题只能登记已经在 `body_order` 中演出的事实，不能替正文补写遗漏。

探针增加有效海外 SCRIPT 路由检查：普通真实生成若有效路由为 mock，会在创建隔离数据库前失败；预检、重放和连续性审计保持离线可用。相关测试 22 项通过。

## 真实补测

最终正式目录：`.cache/real-generation-probe/overseas-report42-performance-medium-v6-20260908/`。来源仍是第 38 号正式修订包的前两集和同一份 v2 固定规划；本轮只新生成第三集，前两集不计为本轮模型生成。v4/v5 是同一提示路线的中间实测，均保留在 `.cache/real-generation-probe/`，不作为最终样本。

| 项目 | 结果 |
| --- | --- |
| 模型/路径 | `gpt-5.6-sol` medium，`overseas_tiktok` |
| 总耗时 | 294.143 秒 |
| 第三集生成耗时 | 294.143 秒 |
| 物理请求 | 1 次，有用量；无编辑或重写 |
| 已知用量 | 输入 25,641，输出 8,700，合计 34,341 tokens；仅作运行记录 |
| 正文 | 3 场、16 动作、30 对白、1,505 有效正文字符 |
| 估时 | 约 112 秒，处于 75–115 秒窗口 |
| 结构/语言连续性 | 0 blocking、0 warning；海外语言契约通过 |
| 保存 | draft、run、provisional artifact、Workspace 读回一致；运行 Agent 已完成 |

最终正文第一项动作先建立电话通道，再出现远距对白；同时包含马路对面站位、遮名副本与原始影像分离、工单核验、调度室线索及姐姐签字揭示。伊芙明确放弃抢先发布机会，姐姐线索之后写下“先查调阅原因”，把批准的主角代价和结尾反应落到可见动作。正文事实、钩子和账本一致。

## 作品审阅结论

本轮不把确定性检查直接当作完整创意验收。最终 v6 已处理本轮的三项具体表演问题，但仍保留以下验收边界：

1. 作品层创意质量尚未完成独立盲评；三集对白仍有程序性表达，不能只凭一次样本宣称人物声音和情绪完成。
2. `episode_quality_review` 的候选匹配仍标记 `protagonist_cost_evidence_missing` 和 `segmented_change_evidence_missing`。v6 已有人类可读的代价和反应，但该确定性信号不具备语义证明能力，需要人工复核后才能关闭。
3. v6 单次 294.143 秒且无编辑，不代表稳定速度；后续速度比较仍以达到可用质量的端到端耗时为准。

本轮仍不启动八集或完整 20 万字真实生成。下一步是对 v6 三集做一次独立作品层复核；若复核确认人物声音、情绪和因果推进达到可用质量，再进入八集单元验收。

## 验证

- `.venv/bin/python -m pytest tests/test_real_generation_probe.py tests/test_prompt_builder.py -q`：22 passed。
- 零调用预检：`.cache/real-generation-probe/overseas-report42-performance-preflight-v5-20260908/`，继承的批准规划、22 条带来源知识、上一集交接和 checkpoint 与第 40 号实测一致。
- 保存与输入核对：`.cache/verify_report42.py` 输出 `draft_run_artifact_workspace_equal=true`、`keyed_facts_in_actual_prompt=22`，核对过程 0 次模型调用。
- 本地服务重启后前端/API 均返回 200，5 个用户项目和 `.env.local` 指纹未变，运行 Agent 为 0。
