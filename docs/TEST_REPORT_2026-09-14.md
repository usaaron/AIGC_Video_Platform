# 本地全量测试记录：2026-09-14

## 结论

本地预览和测试账号可用，主项目与剧本大师的正常启动、指定项目鉴权、两集剧本交接和重复交接已实测通过。全量检查未全部通过，当前结果不能作为多组织上线或“100 集一天以内生成有声成片”的验收依据。

优先阻断项是剧本大师的账号隔离、长任务授权续期、交接原子性，以及尚未通过的后端回归。测试使用两个仓库当前工作区，包含此前未提交的支付、会员和剧本大师接入变更，不代表线上部署状态。

## 环境与范围

- Windows 本地；主项目创作端 `http://localhost:5173/`、管理端 `5174`、API `8787`；剧本大师前端 `3000`、FastAPI `8000`。
- 主项目采用 JSON Store 和 inline 队列，剧本大师采用本地 SQLite。Docker Desktop 后端不可用，Postgres/Redis 容器测试无法完成。
- 已创建一个普通创作者测试账号，配置创作会员套餐及 2000 测试积分，并通过真实本地 API 和浏览器验证登录。账号不是组织管理员；凭据仅通过对话交付，不写入仓库。
- 自动化生成、支付和浏览器 E2E 使用测试数据或 mock。没有执行真实收费支付、付费模型生成、生产部署或真实用户数据迁移。
- 本次 API 冒烟创建的临时项目已归档。未删除已有项目或用户在测试期间创建的项目。

## 执行结果

各行是独立命令的结果，存在重复覆盖，不应直接相加当作唯一用例数。

| 范围                                | 结果                                         | 说明                                                                                     |
| ----------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 主项目 contracts                    | 56 通过                                      | 共享契约                                                                                 |
| 主项目 prompting                    | 17 通过                                      | 提示词模块                                                                               |
| 主项目 admin 单测                   | 19 通过                                      | 管理端前端测试                                                                           |
| 主项目 web 单测                     | 241 通过                                     | 包含充值、会员、功能栈等                                                                 |
| 主项目 API 全量测试                 | 410 通过、1 失败、88 跳过；17 个测试文件失败 | Docker 不可用导致数据库 fixture 初始化和 BullMQ 测试失败，不能视为通过                   |
| 主项目 Script Master 定向回归       | 10 通过                                      | 4 个路由用例及新增 6 个交接仓库用例；SQL 使用 mock，未连接真实 Postgres                  |
| 主项目 E2E                          | 5 通过                                       | 资产库、批量图片、积分/重试/提示词、管理账号等 mock 流程                                 |
| 本地真实 API 冒烟                   | 18 项通过                                    | 登录、权限、两集交接、幂等、越权拒绝及归档清理                                           |
| 主项目 lint / build                 | 通过                                         | 修复后再次完成 lint 和 API 构建；工作区全量构建通过                                      |
| 主项目格式检查                      | 通过                                         | 修复初次发现的 9 个文件格式问题，未降低检查规则                                          |
| 主项目部署安全静态检查              | 通过                                         | 不等同于生产安全验收                                                                     |
| 主项目架构检查                      | 未通过                                       | `apps/api/src/app.test.ts` 5270 行，基线 5267；`apps/web/src/App.jsx` 1020 行，上限 1000 |
| 剧本大师前端单测                    | 568 通过、0 失败                             | 初次 564 个用例有 9 个失败；修复后新增 4 个宿主集成回归用例                              |
| 剧本大师 TypeScript / Next 生产构建 | 通过                                         | 使用独立临时构建目录，不覆盖正在运行的 dev 输出                                          |
| 剧本大师 OpenAPI 契约检查           | 通过                                         | Windows Python/Node 启动和跨 Python 版本响应描述已兼容                                   |
| 剧本大师 E2E                        | 66 通过                                      | 桌面和移动 Chromium，使用测试场景                                                        |
| 剧本大师 Python 全量测试            | 1681 通过、12 失败、3 跳过、2 错误           | 不能把全部失败归因于环境；包含工作流、恢复和来源追踪断言                                 |
| 剧本大师 OpenAPI 导出定向测试       | 1 通过                                       | 另由最终契约检查验证导出结果匹配已签入契约                                               |

`pnpm check` 总门禁仍未通过：最初停在格式检查，修正格式后仍受架构门禁阻断。lint、测试和 build 已分别执行，不能据此宣称总门禁通过。

## 本次修复

1. 主项目 `apps/api/src/modules/scriptMaster/deliveryRepository.ts`：原先的 `INSERT ... ON CONFLICT DO UPDATE RETURNING` 无法区分首次预占和已在处理的交接，首次提交也会被判定为处理中。改为 `DO NOTHING RETURNING` 判断预占所有权，冲突时读取并校验目标、来源、版本及内容哈希；补充首次提交、并发、冲突、回执重放和预占丢失测试。
2. 剧本大师 `frontend/lib/api-client.ts`：兼容无浏览器 location 的测试环境；嵌入页存储被拒绝时仍可发送启动票据，只有成功保存后才从地址移除票据；每次普通请求和 SSE 请求只读取一次票据。
3. 剧本大师 `frontend/lib/host-delivery.ts`：补齐 JSON 请求头并复用一次读取的票据，覆盖交接错误传递。
4. 剧本大师前端 source assertion 测试统一规范化 CRLF，保留原有断言；OpenAPI 生成脚本兼容 Windows 解释器路径和 Node CLI 启动方式。
5. 剧本大师 `scripts/export_openapi.py` 规范化 Python 标准库版本间 413/422 的默认英文响应描述，不改变 API 状态码、结构或自定义响应描述。

本轮未进行账号隔离或任务架构重构，也未扩大架构行数限制来绕过检查。

## 浏览器与真实 API 验证

- 测试账号可登录主项目，恢复 session、读取积分摘要和资产库；普通成员访问管理接口返回 403，未登录访问项目返回 401。
- 从主项目可进入剧本大师，嵌入工作台实际渲染。带项目范围的票据访问其他项目返回 403，缺少票据返回 401。
- 在隔离的临时项目导入两集返回 201，原请求重放返回 200，读回仍为两集；同一幂等键改变正文返回 409；向票据范围外的主项目交接返回 403。
- 积分充值页显示六个模拟档位。实测选择 500 积分 / 45 元、支付宝、立即充值，弹窗中的金额和支付方式一致，显示不可付款的二维码占位图。
- 模拟弹窗点击“我已支付”明确提示未扣款及权益未变化，余额仍为 2000。关闭弹窗可恢复页面操作。
- 会员中心正确展示已开通会员、500 月度积分和 3 路并发，阻止已开通账号再次购买；免费账号开通及支付方式分支由前端自动化覆盖。本轮没有真实续费验收。

## 上线阻断与缺口

### P0：剧本大师缺少完整账号隔离

主项目启动接口允许不传 `projectId`（`apps/api/src/modules/scriptMaster/routes.ts:14`）。剧本大师前端只在存在 `host_project_id` 时过滤同源 IndexedDB 中的项目（`frontend/providers/project-provider.tsx:80`），后端列表也只在票据指定项目时过滤（`backend/app/api/routes/story_projects.py:415`）。`backend/app/host_integration.py:64` 主要校验路径中的项目 ID，未形成对租户、项目所有者及请求体资源的统一授权。

实测新账号打开独立模块时可见此前工作台内容。需要在数据库、浏览器缓存和资源授权中引入账号/组织范围，验证同浏览器切换账号及不同账号直接访问项目的拒绝行为；不能仅依赖前端过滤。修复前不应向多个 B 端组织开放这个独立模块。

### P1：启动票据不能支持数小时任务

`apps/api/src/config.ts:27` 的启动票据默认 300 秒，最多 900 秒。当前票据被直接作为后续 API 凭据使用，未见换取长期会话或续期流程。到期后的后续读取、修改、恢复和交接会鉴权失败，不能保证整条长任务交互持续可用。

应以启动票据交换可续期且可撤销的服务会话，补测过期、续期失败、注销和任务恢复。直接增加票据有效期无法替代会话设计。

### P1：交接还没有事务性和稳定分集映射

`apps/api/src/modules/scriptMaster/routes.ts:165` 逐集调用保存，再完成交接回执。中途失败可能已经写入部分剧集；预占记录与剧集写入不是同一事务。契约携带 `sourceEpisodeId`，但未将它持久化为目标剧集映射，输入集号缺口、乱序或后续修订存在错误对应风险。

Postgres 模式保存交接记录，本地 JSON 模式仍使用进程内 Map，重启会丢失回执。此次修复仅解决首次预占误判。还需实现原子导入、来源分集映射、重启恢复，以及独立新建剧本项目与主项目之间的明确绑定。

### P1：生产持久化与剩余回归未验证通过

Docker Linux engine 的 named pipe 不存在，Postgres/Redis 的组织权限、账本、事务和队列等测试受阻；本地 JSON/inline 结果不代表生产模式。需在 Docker 可用的环境补跑数据库、队列和安全集成测试。剧本大师以下 Python 用例仍失败：

| 文件                                         | 失败用例 / 现象                                                                                                                                                |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/test_local_env.py`                    | `test_model_overrides_are_literal_and_future_roles_need_no_allowlist`、`test_missing_local_env_without_exported_overrides_is_valid`；Windows bash/路径执行问题 |
| `tests/test_mock_story_workflow.py`          | 默认可重放工作流，以及三集重启恢复的 `cn_mainland` / `overseas` 两个变体；均在 `project-readback` 失败                                                         |
| `tests/test_model_config_templates.py`       | `test_config_templates_wire_requested_editors_and_astra_fallbacks` 的 `merged` / `parts` 两个变体；配置模板验证未通过                                          |
| `tests/test_overseas_recovery_acceptance.py` | 第二集失败后复用编辑前状态、第一集跨进程保留的恢复验收；子进程失败                                                                                             |
| `tests/test_real_generation_probe.py`        | `test_real_product_projection_reaches_backend_conflict_check`；产品投影子进程退出 134                                                                          |
| `tests/test_real_generation_probe_resume.py` | `test_revised_source_provenance_selects_corrected_drafts`、`test_restore_revised_working_draft_rebuilds_real_product_state`；来源路径/投影恢复问题待定位       |
| `tests/test_revise_overseas_probe_sample.py` | `test_report38_rejects_mismatched_run_before_writing`；校验错误文本与 fixture 预期不一致                                                                       |
| `tests/test_hongguo_trends.py`               | 一个超大参数 ID 导致 setup/teardown 两个错误；pytest 环境变量超过 Windows 长度限制                                                                             |

这些是本次原有全量测试的结果，尚未通过 Linux 对照复测或逐项修复，不能直接归类为“仅 Windows 问题”。文件名中的 `real_generation` 表示被测试模块，并不表示本轮执行了真实付费生成。

### 其他明确边界

- `App.jsx` 和 `app.test.ts` 超出架构门禁，应按职责拆分并保留回归覆盖。
- 本地热重载曾留下指向已退出进程的 JSON Store 锁，导致 API 退出。核实原进程已结束后清理该残留锁并重启，预览恢复；没有修改 Store 锁实现，异常退出恢复仍需完善。
- 微信和支付宝目前都是模拟支付；手机号/微信扫码登录按此前要求暂缓。
- 组织管理员批量开账号、导出初始密码和划拨积分的完整交付验收未完成；普通测试账号与 mock 管理端测试不能替代该验收。
- 当前人物可信入库仍要求先确认面部基准，不能宣称任意生成完成的人物已自动加白。
- 单镜可生成声音，但当前完整成片合成使用 `-an`。本轮未验收有声成片播放下载，也未实测 100 集、每集约 60 秒的全链路一天内完成。

## 后续验收顺序

1. 完成账号/组织隔离及可续期服务会话，补充跨账号访问和到期恢复的集成测试。
2. 完成交接事务、持久回执、稳定分集映射和独立项目绑定，补充中途失败、并发、重启及修订回归。
3. 在可用 Postgres/Redis 环境补跑主项目全量测试，定位剧本大师 Python 剩余失败，恢复架构门禁。
4. 验收组织账号交付、资产归集和人物加白，再在确认模型预算后执行有声成片及 100 集全链路计时。

## 日志

日志保存在本机任务目录 `C:/Users/admin/Documents/Codex/2026-09-10/wechat-payment-ui-handoff-md-c/outputs/`，不包含在仓库提交中：

- 主项目：`main-tests.log`、`main-e2e.log`、`main-lint.log`、`main-build.log`。
- 剧本大师：`script-master-frontend-retest.log`、`script-master-backend-tests.log`、`script-master-build.log`、`script-master-e2e.log`。
- 真实 API 冒烟：`preview-api-smoke-results.json`，仅记录检查标签、状态码和临时测试项目标识，不保存登录凭据或票据。

Python 日志有超长参数行；查询时使用 `rg -n -M 300 --max-columns-preview` 限制输出长度。
