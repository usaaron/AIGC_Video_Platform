# 全栈工程与编剧全流程审查

日期：2026-09-08。对象：当前工作区代码、实际测试结果、现存三集海外正文及新建中文项目的真实接口探测。优先级中 P1 表示优先修复的项目数据完整性问题，P2 表示正式验收前应处理的问题，P3 表示局部体验问题。

后续更新：本报告保留修复前的审查证据。E1-E5 的工程修复和最新测试结果见 [46_ENGINEERING_FIXES_AND_WORKFLOW_RETEST.md](46_ENGINEERING_FIXES_AND_WORKFLOW_RETEST.md)。

## 1. 审查结论

项目已经具备较完整的规划审批、版本保存、生成恢复、连续性投影和正文交付结构，基础自动化检查覆盖较广；但目前不能判定为稳定跑通的创作生产系统，也不能判定现存正文可直接拍摄。阻碍结论的具体证据是跨项目版本污染、编辑丢失、Mock 新建流程中断、真实规划服务连接失败，以及样本中的因果和场面执行缺口。

本轮完成检查和隔离复现，没有修改产品实现或作品。原工作区已有大量未提交改动，审查以当时的文件内容为准，不能将所有问题归因于某一个提交。此前任务内容已融合到 [分镜前期制作方案](44_PREPRODUCTION_STORYBOARD_PLAN.md)，其中分镜、资产设计、图片/视频提示词和固定版本前期包均仍为待实现范围，不能计入现有功能验收。

## 2. 工程问题

### E1. [P1] 直接保存故事圣经允许跨项目占用同一版本链

[保存逻辑](../backend/app/modules/script_engine/long_story_service.py#L1211)按全局 Bible ID 读取当前版本，却未检查当前对象所属项目是否与提交项目一致。构造项目 B 复用项目 A 的 ID、提交下一草稿版本，会被 REST API 接受。

隔离复现：A/v1 保存和读取均为 200；B/同 ID/v2 保存为 200；此后 A 的最新版读取变为 404，A 正常续存 v2 返回 409。A 的精确 v1 仍可读取，未证明历史内容被删除，也未证明跨账号访问。问题是身份归属和最新版访问被污染。

应在版本校验和编辑记录前固定身份所属项目，复用 [生成保存路径已有的归属检查](../backend/app/modules/script_engine/long_story_service.py#L1302)，并补充跨项目拒绝后 A 仍可正常读写的回归用例。

证据：[后端审查](../.cache/project-review-20260908/backend-findings.md)、[复现输出](../.cache/project-review-20260908/bible-cross-project-output.json)、[复现脚本](../.cache/project-review-20260908/reproduce-bible-cross-project.py)。

### E2. [P2] 创意输入自动保存期间跳转会丢失最后一次编辑

[自动保存](../frontend/components/script-project-editor.tsx#L179)等待 500 毫秒才调用 `updateProject`，组件卸载时清除计时器而不补存。[继续规划按钮](../frontend/components/script-project-editor.tsx#L788)没有等待保存。修改标题后立即离开再重新打开，标题恢复旧值，桌面和移动端均已复现。创意、标签、角色和设置共用这段保存逻辑，也存在相同机制风险。

此外，该逻辑没有等待持久化结果便显示已保存。应在页面跳转和组件卸载前保存最新草稿，并由保存结果驱动成功或失败状态。回归应覆盖“编辑后立即继续规划”和保存失败，不能只检查正常停留超过 500 毫秒的情况。

证据：[前端报告](../.cache/project-review-20260908/frontend/findings.md)、[移动端复现日志](../.cache/project-review-20260908/frontend/diagnostic-mobile.log)、[重新打开后的截图](../.cache/project-review-20260908/frontend/autosave-loss-mobile-chromium.png)。诊断测试断言“观察到丢失”，因此其通过表示缺陷复现成功。

### E3. [P2] 默认 Mock 模式无法生成当前故事圣经结构

[MockLLMAdapter](../backend/app/modules/script_engine/llm_adapter.py#L4597)把结构化输出的每个属性都填成字符串。当前故事圣经要求 `world_rules`、人物弧光、关系、故事线等数组，因此经实际 API 调用和有限合同恢复后仍返回 422。用户流程已完成输入评估、ContentSpec 解析和项目创建，随后卡在故事圣经。

[前端启动说明](../frontend/README.md#L39)仍将无模型配置模式称为 Mock 演示。应为当前规划合同提供确定、合法且相互引用一致的演示数据，并用真实 Mock adapter 串联新建项目路径。现有单元测试使用专门 stub，不能替代这个验证。

证据：[最终有效 Mock 探测](../.cache/project-review-20260908/workflow-mock-v3/summary.json)、[422 响应](../.cache/project-review-20260908/workflow-mock-v3/03-bible-generate.json)。零物理模型请求。更早的两次探测分别因审查脚本未遵守 240 字字段限制、未接受成功状态 201 而终止，均为测试脚本设置问题，不列为产品缺陷。

### E4. [P2] 浏览器健康断言将正常取消的 RSC 流计为失败

[监听器](../frontend/e2e/support/page-health.ts#L29)记录所有 `requestfailed`，[最终断言](../frontend/e2e/support/page-health.ts#L41)要求列表为空。原始 Playwright 14 项中 9 项均在此失败，报告 Next.js RSC 请求 `net::ERR_ABORTED`；Trace 显示已返回 HTTP 200 的组件流被客户端取消，多数为预取，另有切换页面后的流取消。各项业务断言此前均已通过。

只在隔离副本中加入针对 RSC 请求取消的识别后，8 项规划用例通过；移动端创建用例在隔离 API 数据下也通过。产品测试文件未修改，正式结果仍为 5/14 通过，诊断结果单列。修复时应识别预期预取/导航取消，继续捕获业务 API 取消、JavaScript 错误和 5xx。

### E5. [P3] 未启动的正文工作区显示正在生成

[空生成预览](../frontend/components/script-workspace.tsx#L2413)在没有任务时仍使用“正在构思本集，等待第一段正文”文案。测试已确认此状态未发出生成请求且需要作者主动开始。应区分空闲、排队、生成、失败和恢复状态，避免用户等待不存在的任务。

## 3. 编剧与制作问题

本节逐行检查的样本为 `overseas-report42-performance-medium-v6-20260908`。第 1、2 集继承人工修订稿，第 3 集为该轮新增生成，不能称为三集无人干预连续生成。以下结论针对这些具体内容及相关合同，不推断所有题材和整部长篇均有同样问题。

### W1. [P2] 姐姐调阅记录的时间和对象指代不闭合

第 3 集先问“事故当日的值班记录”，纸条也写明事故日记录，随后说姐姐在矿难前一周调阅过“these records / 这批旧记录”。若为同一材料，便提前调阅了尚未产生的记录；若是更早的历史资料，正文没有区分。批准计划已经包含此歧义，应先明确两批材料的身份、形成时间和调阅时间，再调整正文，不能让正文生成器擅自添加答案。

证据：[问题起点](../.cache/real-generation-probe/overseas-report42-performance-medium-v6-20260908/episode_003/SCREENPLAY.md#L123)、[结尾指代](../.cache/real-generation-probe/overseas-report42-performance-medium-v6-20260908/episode_003/SCREENPLAY.md#L153)、[对应批准计划](../.cache/real-generation-probe/overseas-report42-performance-medium-v6-20260908/episode_003/request.json#L156)。

### W2. [P2] 开篇付款缺少用途和关联，时间差不足以驱动调查

第 1 集反复解释付款 18:00、事故 20:00、通报次日 08:00，却未让观众看懂付款人、收款人、用途及其与这次矿难的联系。普通交易发生在事故前不构成疑点。应先用可见字段或一次有阻力的追问建立“这笔钱为何不该在那时支付”，再保留现有“线索尚不等于造假证明”的核验边界。

证据：[付款比较](../.cache/real-generation-probe/overseas-report42-performance-medium-v6-20260908/episode_001/SCREENPLAY.md#L57)、[认定时间异常](../.cache/real-generation-probe/overseas-report42-performance-medium-v6-20260908/episode_001/SCREENPLAY.md#L97)。本轮新建中文项目的测试输入主动补充死亡补偿用途；这只是更明确的测试输入，未回写修改原作品，也不证明后续正文已经解决。

### W3. [P2] 人物选择的代价主要由声明承担，连续三集的戏剧动作重复

伊芙的保护底线反复通过“暂缓发布”“保护身份”表达；第 3 集在证人提出家人风险后说可以立即公开完整视频，与批准计划“不用曝光逼供”发生张力。关闭页面是可撤销操作，所谓失去抢先发布机会尚无明确截止点或可观察后果。

三集持续采用保护名单、核验资料、获得下一线索的谈判结构。转运和移交被反复宣布，较少改变当场可用选项。不同角色频繁共用核验说明语言，姐姐线索揭示后的私人情绪回报也偏弱。建议在规划里先明确本集不可轻易撤回的选择、随之兑现的限制和情绪转折，再用角色各自的目的塑造台词。

证据：[保护交易与发布措辞](../.cache/real-generation-probe/overseas-report42-performance-medium-v6-20260908/episode_003/SCREENPLAY.md#L63)、[代价宣告](../.cache/real-generation-probe/overseas-report42-performance-medium-v6-20260908/episode_003/SCREENPLAY.md#L89)、[情绪收尾](../.cache/real-generation-probe/overseas-report42-performance-medium-v6-20260908/episode_003/SCREENPLAY.md#L159)。不把固定动作/对白条数当作戏剧节奏质量证据。

### W4. [P2] 玻璃门两侧的交流缺少传声条件

第 3 集伊芙在玻璃门外、诺拉在门内，两人已直接对答，伊芙随后才推门进入。电话仅连接伊芙和马路对面的亚当，没有交代诺拉的声路。这个局部调度缺口会迫使分镜或制作人员自行补设定。应在现有动作内写清门状态或其他可执行的交流条件。

证据：[站位和对话](../.cache/real-generation-probe/overseas-report42-performance-medium-v6-20260908/episode_003/SCREENPLAY.md#L5)、[推门时点](../.cache/real-generation-probe/overseas-report42-performance-medium-v6-20260908/episode_003/SCREENPLAY.md#L29)。

### W5. [P2] 整场对白与动作全量重叠的估时不足以支持可拍验收

[估时函数](../backend/app/modules/script_engine/screenplay_duration.py#L29)逐场取 `max(dialogue_seconds, visual_seconds) + 1.5`，不读取 `body_order`，因此无法区分必须先后发生的操作和可并行的表演。第 3 集有解锁、打码、导出、展示、核验、书写和阅读等依赖动作，不能统一假定全部发生在对白期间。

按产品自身英文 2.7 词/秒口径，三集纯对白约 98.9、77.8、87.0 秒，输入目标均为 90 秒；尚未计算必须独立发生的动作和数字读法。这不能证明全部超出 115 秒硬上限，也不能证明实际 90 秒可拍。应将其标为粗估，在锁稿时核对读台词与动作顺序，后续分镜层按顺序、并行和停顿建立预算。[新方案](44_PREPRODUCTION_STORYBOARD_PLAN.md#L93)已提出这一要求，尚待实现。

更完整的六项编剧审阅、批准计划对照和准确行号见 [编剧证据报告](../.cache/project-review-20260908/screenwriter-findings.md)。

## 4. 实际测试结果

| 检查 | 实测结果 | 覆盖解释 |
| --- | --- | --- |
| 后端全量 pytest | 1256 通过，1 跳过，49.62 秒 | 跳过项为需显式启用的真实 LLM 集成测试；有一条 TestClient 依赖弃用警告 |
| 前端 `npm run check` | 391 通过，零失败/跳过 | 包含 API 合同和 TypeScript 检查 |
| 前端生产构建 | 通过 | 有 `::highlight` CSS 解析警告 |
| 原始桌面/移动 Playwright | 5 通过，9 失败 | 9 项都卡在取消 RSC 请求的健康断言，未将其改报为通过 |
| 隔离副本浏览器诊断 | 8 项规划 + 1 项移动创建通过 | 只在副本识别 RSC 取消；创建使用隔离 API 数据 |
| 自动保存缺陷复现 | 桌面和移动端均复现 | 每次使用新的测试浏览器上下文 |
| 跨项目 Bible 复现 | 复现成功 | 隔离 SQLite，历史 v1 保留，最新版访问受损 |
| Mock 新建 API 流程 | 未跑通 | 故事圣经阶段返回 422，零物理模型请求 |
| 真实中文新建 API 流程 | 未跑通，重试仍失败 | Bible 成功，首块分集规划连接失败并返回 503 |
| 固定规划的真实中文正文补测 | 1/1 集生成、保存、读回及 Markdown 输出成功 | 264.005 秒，634 有效字符；连续性 0 阻断、1 警告 |
| 正文持久化重放 | HTTP 200，保存的领域结果一致，零模型请求 | 排除 3 个不进入持久化检查点的调试字段；完整调试响应不同 |

日志：[后端](../.cache/project-review-20260908/backend-tests.log)、[前端检查](../.cache/project-review-20260908/frontend/check.log)、[构建](../.cache/project-review-20260908/frontend/build.log)、[原始 E2E](../.cache/project-review-20260908/frontend/e2e.log)。

### 真实新建流程的中断位置

实际调用链为：输入评估 200 → 创意解析 201 → 项目创建 200 → GLM 故事圣经草稿 200（约 36.7 秒）→ 测试审批 200 → 顶层树接口 200 → 首节点测试审批 200 → Qwen 首块分集规划 503。

两次规划尝试均记录 `ConnectError`，没有模型 HTTP 响应或输出；无凭据的只读连通性检查也在该角色端点失败。故本轮将其列为当前运行环境的阻塞，不直接认定为规划算法缺陷。未擅自修改角色路由或替换模型。首轮有 2 次物理模型请求，恢复尝试新增 1 次；恢复复用了已保存的成功步骤，没有重新生成故事圣经。

顶层树接口的成功只说明本次结构生成与保存成功，不能据此声称模型完成了整部递归故事设计。测试审批是隔离脚本模拟的作者动作，不代表用户批准创意。原计划验证前两集正文、保存、读回、导出和重放，实际未到达这些阶段。

证据：[恢复后的结果](../.cache/project-review-20260908/workflow-real/summary.json)、[规划失败请求响应](../.cache/project-review-20260908/workflow-real/07-roadmap-1.json)、[全部物理请求记录](../.cache/project-review-20260908/workflow-real/provider_requests.jsonl)、[无凭据连通性检查](../.cache/project-review-20260908/network-reachability.json)。

### 固定规划的真实中文正文补测

使用当前 DeepSeek 中文正文角色与现有 v2 固定测试计划，第 1 集产生 3 场、20 条动作、35 条对白，634 个有效正文字符，API 耗时 264.005 秒。总计 3 次物理模型请求，分别用于初稿、时长修复和制作条数修复，均收到 200。连续性检查有 1 条未登记伏笔引用警告，无阻断项；这不是零问题通过。

正文已保存为隔离项目的 provisional 草稿，Artifact 与工作区读回检查完成，并输出 Markdown。重新启动验证进程后，同一生成请求返回 HTTP 200，保存的领域结果一致，零物理模型请求。检查点不保存的原始模型输出、完整提示词和渲染变量已从比较中排除，因此完整响应字节不一致是已说明的调试数据差异。

该集没有经过作者正式确认和 DOCX 导出，不能把 Markdown 抽样输出等同于正式交付验收。634 字低于本次请求的 1667 字参考量及 1167 字推荐下限，当前接受策略仍允许保存。单集不能证明整部字数不达标，但本轮未建立总字数目标已被兑现的证据，也不应从“生成成功”推导 8 万字作品完成。

已人工阅读本次中文正文。开场写明手机连接投屏线后“屏幕上出现付款截图和证人名单预览”，后续才拔线；连续性记录却断言在投屏前拔线、名单未曝光。屏幕是否仅指手机私密预览并不明确，应在锁稿时写清，不能让结构化账本替正文宣布保护成功。该固定计划仍未补充付款用途，因此也不能用本次样本证明 W2 已被修复。这里使用的是原有固定计划，与上一段新建项目的增强创意输入不同。

证据：[抽样报告](../.cache/project-review-20260908/body-real-cn/REPORT.md)、[实际正文](../.cache/project-review-20260908/body-real-cn/episode_001/SCREENPLAY.md#L37)、[连续性记录](../.cache/project-review-20260908/body-real-cn/episode_001/continuity_audit.json)、[生成指标](../.cache/project-review-20260908/body-real-cn/episode_001/run.json#L1061)、[零请求重放结果](../.cache/project-review-20260908/body-real-cn/replay_verification.json)。

## 5. 验收边界和建议顺序

首先修复 Bible 身份归属和离页保存，防止作者继续创作时损坏项目访问或丢失输入；随后修复 Mock 合同与浏览器取消请求识别，使离线全流程和自动化结果可信。恢复规划服务后，应重新执行原始创意到生成规划、连续正文、保存恢复、作者修订、确认和正式导出的同一条流程。

创作方面，先在批准计划中修复交易用途和记录时间，再让代价与压力落到可表演的行动中。正文锁稿前补场面空间、通信和道具状态核对；时长继续作为粗估，不能用程序合格秒数替代实际节拍审阅。

当前测试不证明整部 8 至 20 万字的长期因果、人物弧光、伏笔回收与结局完成度；不证明 2000 集大项目性能；不证明分镜和下游图片/视频生成已经实现。现有正式导出和确认的自动化用例不能代替同一真实新建项目从头到尾完成的证据。

测试使用隔离数据库和前端副本。浏览器初轮创建/书库测试对既有 8000 API 只执行读取，规划/生成操作均被测试拦截；后续诊断完全使用隔离响应。临时前端服务器 3108 已停止，既有 3000/8000 服务保留。

## 6. 复现入口

以下命令从项目根目录运行；输出目录必须为新的隔离目录。真实模型命令需要当前角色的有效配置。

```bash
.venv/bin/pytest -q
npm --prefix frontend run check
npm --prefix frontend run build
.venv/bin/python .cache/project-review-20260908/reproduce-bible-cross-project.py
.venv/bin/python .cache/project-review-20260908/workflow_probe.py --output .cache/project-review-next-mock
```

真实新建流程使用同一审查脚本增加 `--real`。`--resume` 仅用于在原隔离数据库中复用成功步骤；缓存步骤和新调用会明确区分。脚本按当前新建流程调用真实规划 API，不用固定计划冒充生成规划。

固定规划正文补测使用项目现有 `scripts/run_real_generation_probe.py`，本次限制为中文第 1 集、v2 测试计划、最多 10 次物理请求和 600 秒新请求期限。其结果只支持正文这一段的判断。
