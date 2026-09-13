# 工程修复与工作流复测

日期：2026-09-08。承接 [45 号审查](45_FULLSTACK_SCREENWRITER_WORKFLOW_REVIEW.md)。本轮实施已复现的 E1-E5 工程修复，保留原有工作区改动和作品内容，没有提交或部署。

## 已修复

| 问题 | 当前行为 | 回归证据 |
| --- | --- | --- |
| E1 跨项目 Bible 版本污染 | 版本校验前固定 Bible 所属项目，跨项目 ID 写入返回 409，原项目仍可读、续存和确认 | `tests/test_long_story_api.py` 54 项通过，新增用例修复前失败、修复后通过 |
| E2 离页丢失创意编辑 | 修改立即进入现有本地持久化队列，保存成功后才显示已保存；过时完成事件不覆盖新状态，失败显示尚未保存 | 5 项聚焦单元回归，桌面/移动立即跳转与失败恢复用例通过 |
| E3 Mock 故事圣经返回非法类型 | 对当前 Bible 和分集规划合同生成确定性中文演示数据，保留人物和故事线引用；其他历史 Mock 输出兼容 | 107 项 adapter 测试通过，新增完整 Mock API 回归通过 |
| E4 RSC 取消被误报为页面故障 | 仅放行同源 GET、RSC 头、`_rsc` 参数齐全且属于预取或已成功组件响应的取消 | 3 项监听器回归验证 API 中断、未知导航、重置、JS 错误和 5xx 仍被拒绝 |
| E5 空闲正文显示正在生成 | 尚无生成任务时显示“本集尚未开始生成。” | 规划门禁浏览器用例同时验证未发请求和空闲文案 |

E1 使用现有异常与 HTTP 409 约定，没有数据库结构变更。E2 同时按项目身份重新建立编辑表单，避免直接切换项目时复用旧草稿。浏览器关闭时若保存未完成或失败，会使用原生离页保护；用户强行关闭、进程崩溃不在恢复保证范围。

每次编辑立即入队可能增加同步触发频率，现有 IndexedDB 写入会合并待处理快照，服务端同步继续使用已有串行队列。未另建第二套存储或改变持久化协议。

Mock 产物明确标为离线演示，只用于操作和合同验证，不承诺按用户创意进行智能写作。没有将同一套演示输出接到真实模型路径。

## 最新测试结果

下表为 E1-E5 工程修复完成后的全量基线；其后追加的编剧合同与版本化输入使用文末列出的聚焦回归验证，没有再次运行全量后端套件。

| 检查 | 结果 |
| --- | --- |
| 后端全量测试 | 1258 通过、1 跳过，52.86 秒；保留一条已有 TestClient 弃用警告 |
| 前端 `npm run check` | 399 通过，API 合同与 TypeScript 均通过 |
| 前端生产构建 | 通过；保留已有 `::highlight` CSS 解析警告 |
| 生产构建 Playwright | 桌面与手机共 18 项全部通过，14.7 秒 |
| 默认 Mock API 工作流 | 输入评估、创意解析、项目、Bible、树及分解、首个叶节点分集规划、前两集正文、Artifact/工作区保存读回、Markdown 输出和幂等重放通过 |
| Mock 物理模型请求 | 0；重放的领域结果一致 |
| 格式检查 | `git diff --check` 通过 |

浏览器冒烟测试的书库和标签数据现已隔离，不再依赖用户现有项目列表。自动保存故障测试故意使 IndexedDB 写入失败，再验证下一次编辑能恢复。生产测试服务器使用 3108，测试前端独立复制，未覆盖现有前端构建目录。

临时 3108 测试服务器已停止，既有 3000/8000 服务保留；3000 页面返回 HTTP 200。

日志：[后端](../.cache/project-fixes-20260908/backend-tests.log)、[前端检查](../.cache/project-fixes-20260908/frontend-check.log)、[构建](../.cache/project-fixes-20260908/frontend-build.log)、[浏览器](../.cache/project-fixes-20260908/frontend-e2e.log)、[Mock 工作流](../.cache/project-fixes-20260908/workflow-mock/summary.json)、[CI 工作流回归](../.cache/project-fixes-20260908/mock-workflow-test.log)。

## 可重复执行的工作流

新增 [run_story_workflow_probe.py](../scripts/run_story_workflow_probe.py) 和 [默认 Mock 回归](../tests/test_mock_story_workflow.py)。从项目根目录运行，输出目录应为新目录：

```bash
.venv/bin/python scripts/run_story_workflow_probe.py --output .cache/story-workflow-check
.venv/bin/pytest -q tests/test_mock_story_workflow.py
```

脚本默认清理子进程中的模型角色设置并启用 Mock，创建独立 SQLite，复用产品当前规划接口和 TypeScript 连续性投影。需要前端 Node 依赖。每一步保留请求、响应、状态、耗时和源文件指纹；任何阶段失败都以非零退出码结束。模型调用由零请求额度强制保护，测试不会因本机存在真实模型凭据而产生外部生成请求。

加载有效真实模型环境后加 `--real` 可测试实际调用链，但离线回归成功不证明真实生成质量。模拟批准是测试作者动作，草稿仍保存为 provisional，不能视为批准用户作品。此脚本只验证首个叶节点和前两集，不包含正式确认、DOCX 交付或整部作品完成。

## 真实模型与创作边界

本轮只读复测仍显示中文分集规划角色 `qwen3.8-max` 的 TLS 握手被远端或网络链路关闭，错误为 `SSL: UNEXPECTED_EOF_WHILE_READING`。同期 Bible 角色端点可连接，正文角色端点也收到 HTTP 响应。没有证据将此归因于规划算法，没有修改模型路由、密钥或关闭 TLS 验证。需恢复该角色端点后再执行同一条真实创意到正文链路。证据：[无凭据连通性结果](../.cache/project-fixes-20260908/network-reachability.json)。

45 号报告中付款用途、历史记录指代、人物代价、重复谈判、空间通信和时长粗估等编剧问题尚未通过作品修订与真实生成复验解决。本轮没有擅自改写已批准剧情或历史样本，也没有新增泛化模型审稿轮次。应先在规划中确认缺失的事实与戏剧动作，再沿版本流程生成正文候选并审阅。

文字分镜、资产设计、图片/视频提示词和版本化前期包仍处于 [44 号方案](44_PREPRODUCTION_STORYBOARD_PLAN.md) 的待实现范围。以上测试不能证明整部 8 至 20 万字作品的创意质量、连续性或制作可行性。

## 编剧约束与诊断增补

继续核查后，已在现有生成前合同内补齐以下内容，没有新增模型审稿阶段：

- 悬疑交易需有已建立的用途、交易方及与事件的联系；缺失信息作为待核验问题，不能用时间先后代替因果，也不能擅自编造付款性质。
- 材料的形成日期、内容涵盖期间、调阅日期分别核对；历史档案与后来形成的事故当天记录明确区分。已批准的特殊世界规则仍有优先权。
- 未曝光材料的保护结果需先建立私密设备和公共屏幕各自的状态，之后才执行拔线等动作；实际已曝光的状态继续保留。
- 时长口径明确标为粗估，生成前沿 `body_order` 核对操作、读证据和反应停顿的先后依赖。当前估时算法仍不是实拍时长验收。

新增版本化 [测试输入](../scripts/story_workflow_review_case.v1.json)，工作流脚本通过 JSON 解析读取，保存原样副本和源指纹。输入明确说明它是隔离测试创作，不是用户作品修订；关键测试事实及审阅标准完整进入 ContentSpec 创作备注和 Bible 请求，回归核对其没有被短提示字段截断。原历史 v1/v2 三集样本未被替换。

增强输入后的 Mock 流程再次完成前两集保存、读回和重放。证据：[输入来源及规划回归](../.cache/project-fixes-20260908/story-source-contract-tests.log)、[增强输入工作流](../.cache/project-fixes-20260908/workflow-reviewed-source/summary.json)、[生成服务相邻回归](../.cache/project-fixes-20260908/generation-contract-regression.log)。这些检查验证来源传递和接口行为，不证明模型已解决相应创作问题。

增补验证结果：提示合同及输入工作流 13 项通过，生成服务 119 项通过；最后一次合同措辞调整后，[提示合同 12 项复测](../.cache/project-fixes-20260908/prompt-contract-final.log)全部通过。复测与前述用例存在重叠，不累计为新的独立测试数。

TLS 又用 httpx 的环境代理/直连两种设置，以及 curl 默认 TLS/TLS 1.2 分别复核，四种方式都在 HTTP 响应前失败。因此真实规划服务仍是外部阻塞，当前没有可验证的应用侧修复。完整记录见 [TLS 诊断](../.cache/project-fixes-20260908/tls-diagnosis.json)。

## 13:18 真实流程重跑

按用户要求重新执行真实调用，测试子进程明确加载项目根目录 `.env.local`，新建隔离 SQLite。未变更模型地址、密钥、路由或业务代码。测试目标仍是创意输入到前两集保存、Markdown 导出与重放，不包含全部 48 集、浏览器交互或正式交付确认。

首次运行耗时 65.473 秒，在首次分集规划失败；随后仅重试失败阶段，耗时 2.288 秒，再次失败。重试复用了本次已保存的成功规划步骤，源文件及测试输入指纹均与首次运行一致。

| 阶段 | 本次结果 |
| --- | --- |
| 输入评估 | HTTP 200，实际调用 `gpt-5.6-sol` 成功，约 20.9 秒 |
| 创意解析、项目创建 | HTTP 201 / 200，通过 |
| 故事圣经生成 | HTTP 200，实际调用 `glm-5.2` 成功，约 42.2 秒 |
| 测试确认、技术剧情树、首节点确认 | HTTP 200，通过；技术树建立没有额外模型请求 |
| 首次分集规划 | 两次均为应用 HTTP 503；`qwen3.8-max` 实际请求分别在 1.512 / 1.478 秒发生 `ConnectError`，上游 HTTP 状态均为空 |
| 正文生成、产物保存读回、Markdown 导出、幂等重放 | 因前置分集规划失败，本次未执行 |

合计 4 次物理模型请求，2 次成功收到响应、2 次连接失败。成功请求报告共 14793 tokens；失败请求没有 usage，不能推断其计费。`whole_work_quality_accepted` 保持 `false`。

本次独立检查中，httpx 使用环境网络设置及 `trust_env=False` 两种方式均出现 TLS EOF；curl 默认 TLS 和限制最高 TLS 1.2 均以退出码 35、HTTP 状态 000 失败。可确认的是这台机器当前无法完成到所配置规划地址的 TLS 连接；这些记录不能证明密钥、余额或模型名称有误，也未定位到具体是哪一段网络或服务端网关造成中断。

证据：[首次完整运行](../.cache/workflow-rerun-20260908-1320/summary-before-resume-614d8541.json)、[失败阶段重试](../.cache/workflow-rerun-20260908-1320/summary.json)、[分集规划响应](../.cache/workflow-rerun-20260908-1320/07-roadmap-1.json)、[脱敏角色配置](../.cache/workflow-rerun-20260908-1320/runtime-roles.json)、[本次 TLS 诊断](../.cache/workflow-rerun-20260908-1320/tls-diagnosis.json)、[首次运行日志](../.cache/workflow-rerun-20260908-1320.log)、[重试日志](../.cache/workflow-rerun-20260908-1320-resume.log)。所有测试进程已结束，既有服务未重启。

## 13:34 Qwen 链路专项诊断

本次只测试现有 Qwen 地址 `https://openrouter.icu/v1`，没有修改配置。大陆/海外的 Qwen 规划及其他相关角色共 9 项均指向该地址。

| 检查 | 结果 |
| --- | --- |
| 本机 DNS | 返回 `198.18.0.5` |
| TCP 443 | 可连接该本机解析地址 |
| 系统路由 | `198.18.0.5` 经 `utun8`、网关 `198.18.0.1` 转发；系统代理为 `127.0.0.1:7897` |
| TLS 握手 | `SSLEOFError: UNEXPECTED_EOF_WHILE_READING` |
| 最小 Qwen 请求 | 使用当前模型和密钥，仅要求回复 OK；默认网络设置、`trust_env=False`、显式现有本地代理三种方式均在 HTTP 响应前失败 |
| 独立 curl HTTPS | 退出码 35，HTTP 状态 000 |
| Google 公共 DNS over HTTPS | `Status: 3`，NXDOMAIN，没有公网 A 记录 |
| Cloudflare 公共 DNS over HTTPS | `Status: 3`，NXDOMAIN，没有公网 A 记录 |

更新结论：当前项目配置的 Qwen 网关链路确实不可用，进一步发现其网关域名在两家公共 DNS 均返回 NXDOMAIN。应先核对服务商当前提供的域名和 BASE_URL，或由服务商修复域名解析。这不能推断 Qwen 官方模型整体故障，也不能判断密钥或余额，因为请求未进入鉴权阶段。

此前把 `trust_env=False` 称为“直连”不严谨：它关闭 HTTPX 对进程环境网络设置的使用，但不会绕过系统 `utun8` 隧道。本机 DNS 和 TCP 可达结果也不证明网关公网地址可达。现有证据不足以断言域名失效的具体原因或永久性。

证据：[分层测试与两个最小请求](../.cache/qwen-link-20260908-1331/summary.json)、[显式系统代理最小请求](../.cache/qwen-link-20260908-1331/explicit-proxy.json)、[系统路由](../.cache/qwen-link-20260908-1331/system-route.txt)、[系统代理](../.cache/qwen-link-20260908-1331/system-proxy.txt)、[Google DNS 结果](../.cache/qwen-link-20260908-1331/dns-google.json)、[Cloudflare DNS 结果](../.cache/qwen-link-20260908-1331/dns-cloudflare.json)。所有诊断请求保留 TLS 校验，没有记录密钥或向新模型服务商发送密钥。
