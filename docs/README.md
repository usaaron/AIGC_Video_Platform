# 序幕TV 文档索引

2026-10-14 [全量检查修复与本地数据库审计](FULL_CHECK_REPAIR_2026-10-14.md)：Docker/依赖恢复、架构拆分、严格测试类型、SQL 与深链接修复、测试服务隔离；包含验证结果、误连开发库处置和后续功能清单。

2026-10-14 [主媒体对象存储证明第十一步](DELIVERY_MEDIA_STORAGE_STEP11_2026-10-14.md)：服务端入库 SHA-256、当前主媒体完整读取/大小/签名/哈希核对、同长覆盖阻断、历史待补和验收版本绑定；附已完成、验证边界及待完成清单。

2026-10-14 [交付门禁查询第十步：正式交付只读判定](DELIVERY_GATE_QUERY_STEP10_2026-10-14.md)：服务端重新计算冻结合同任务的正式交付门禁，展示允许/阻断/待补原因，物理失败不能通过删减合同要求绕过；正式发布/下载和扣费仍待后续。

2026-10-13 [交付合同冻结 UI 第九步](DELIVERY_CONTRACT_FREEZE_UI_STEP9_2026-10-13.md)：生成队列正式冻结入口、合同草稿默认要求、服务端哈希边界、回拉状态与完成/待完成清单。

2026-10-13 [交付证据第二步：任务事实快照](DELIVERY_EVIDENCE_STEP2_2026-10-13.md)：证据绑定组织/项目/任务/媒体版本，严格区分 Provider、媒体、内容审核、物理审计和连续性；只读投影，不开放交付门禁。

2026-10-13 [交付合同第三步：冻结纯函数](DELIVERY_CONTRACT_FREEZE_STEP3_2026-10-13.md)：未冻结草稿规范化、SHA-256 哈希、重复冻结拒绝和不可变输入；对象存储验证尚待下一步。

2026-10-13 [交付对象存储验证第四步：尾帧可读性事实](DELIVERY_STORAGE_VERIFICATION_STEP4_2026-10-13.md)：任务范围、大小和基础图片签名检查，区分 pending/failed/passed；只读验证，不开放发布门禁。

2026-10-13 [交付合同第五步：任务级冻结边界](DELIVERY_CONTRACT_PERSISTENCE_STEP5_2026-10-13.md)：受权限保护的任务级合同冻结、组织/项目范围、乐观并发、一次冻结和用户 metadata 防伪；未接自动交付门禁。

2026-10-13 [交付门禁第六步：冻结合同与同范围证据判定](DELIVERY_GATE_EVALUATION_STEP6_2026-10-13.md)：冻结合同、证据 scope、通过/失败/待补证据判定；未接 UI、发布或扣费。

2026-10-13 [交付验证第七步：只读查询与生成队列展示](DELIVERY_VERIFICATION_QUERY_STEP7_2026-10-13.md)：按任务授权的只读查询、当前尾帧重验、生成队列按需弹层展示；未接自动发布或扣费。

2026-10-13 [交付验证第八步：真实浏览器走查](DELIVERY_VERIFICATION_BROWSER_WALKTHROUGH_STEP8_2026-10-13.md)：修复入场动画导致的固定弹层错位，验证冻结合同任务的入口、状态展示和关闭；走查夹具已恢复，未接自动发布或扣费。

2026-10-11 [提示词优化阶段收口](STORYBOARD_FREEZE_2026-10-11.md)：固定范围、验收标准和四次调用上限；候选未达标，已归档并恢复上一轮 v3，明确当前人工验收边界，不再自动无限迭代。

2026-10-11 [证据对应、动作归属与状态失效验证](STATE_BINDING_2026-10-11.md)：v3 通用规则、本地启用、260 项相关检查；四次真实请求及零新增调用回放，阅读指定问题改善，复杂语义仍未完整通过。

2026-10-11 [状态变化过程依据修复与四样本验证](STATE_TRANSITION_EVIDENCE_2026-10-11.md)：通用变化分类、证据时序与后续影响限制，234项相关检查、本地启用；复杂样本重试后拦住前次漏报，剩余语义问题完整记录。

2026-10-11 [状态表稳定性与复杂请求复测](SCENE_STATE_STABILITY_2026-10-11.md)：通用生成合同及格式修复，最终四请求完成，三例通过本轮检查，复杂内容未通过；217项相关验证通过，本地启用。

2026-10-11 [分镜状态与交付时长修复及四样本复测](SCENE_EXECUTION_GUARDS_2026-10-11.md)：通用状态链和待确认事项分类、交付拦截、210 项相关检查、本地启用。复测部分通过，复杂样本仍未完成新生成验收，正式项目和视频保持。

2026-10-11 [正文可执行性与真实分镜复测](SCENE_SOURCE_STEP4_2026-10-11.md)：紧凑写作接线修复、正文与选区执行规则、105 项回归及 10 次真实文字调用。正文/分镜部分改善，仍未通过整场内容验收，候选未采用。

2026-10-11 [第三步：真实首场质量验证](REAL_QUALITY_STEP3_2026-10-11.md)：两次真实文字生成、通用约束补强与格式兼容、152 项去重回归。内容仍未通过，原项目和视频保持，不把警告当作语义阻断。

2026-10-11 [海外工作流第二步：人物声音差异](CHARACTER_VOICE_STEP2_2026-10-11.md)：共享生成要求、主站编辑与非阻断建议、样本和事实边界、完整引用与本地验证。

2026-10-11 [海外工作流第一步：共享故事背景](OVERSEAS_HOST_PROFILE_2026-10-11.md)：主站入口、默认文化规则、旧项目兼容、本地验证及旧测试差异。

2026-10-11 [场景可执行性优化](SCENE_EXECUTION_2026-10-11.md)：物理支撑、通行空间、群体纵深及职责反应的全流程约束、编辑/编译继承与验收提示，284 项回归，本地 v20。

2026-10-11 [视频内容验收与生成前检查](VIDEO_CONTENT_REVIEW_2026-10-11.md)：限定文字冲突检查、按视频版本保存人工验收、尾帧衔接关卡及 180 项验证，本地已启用。

2026-10-11 [第一集首镜内容修复](EPISODE1_CONTENT_FIX_2026-10-11.md)：v19 提示词优先级、资产姿势冲突处理、97 项回归、480P 实测与首镜局部后期及真实尾帧回填。

2026-10-11 [第一集首镜试生成](EPISODE1_VIDEO_TRIAL_2026-10-11.md)：历史人物匹配、明确未入画角色排除、视频参考图传输体积修复与真实生成验证记录。

本目录按“当前事实、开发边界、专项能力、质量、运维、历史”组织。新 Agent 先读根目录 `AGENTS.md`，再读 `CURRENT_STATE.md`。工程化升级前的全量审查见 [ENGINEERING_AUDIT.md](ENGINEERING_AUDIT.md)。

2026-10-13 [交付合同第九步：正式冻结 UI 与业务入口](DELIVERY_CONTRACT_FREEZE_UI_STEP9_2026-10-13.md)：生成队列对符合条件的已完成视频任务提供合同冻结入口，5183 已用临时任务完成确认、哈希回拉、只读核验和夹具恢复；终端任务轮询已修复，正式交付门禁仍待后续。

2026-10-10 [第一至第五步本地启用验证](PROMPT_LOCAL_ACTIVATION_2026-10-10.md)：依赖校正、实际构建、预览服务重启、398项回归及数据核对完成；未发布线上或进行付费模型对照。

2026-10-10 [资产提示词融合（第四步）](PROMPT_ASSET_INTEGRATION_2026-10-10.md)：独立视图、可选三联总览、风格/状态边界与视角保存；已在当前本地预览启用。

2026-10-10 [分镜参考与提示词融合（第五步）](PROMPT_STORYBOARD_INTEGRATION_2026-10-10.md)：按人物造型/朝向选图、实际图号与用途、Worker槽位保护、镜头动作/焦点/时长核对；旧prompting依赖已修正，v18已在当前本地预览启用。

## 当前事实

| 文档                                                   | 用途                                 | 状态                        |
| ------------------------------------------------------ | ------------------------------------ | --------------------------- |
| [CURRENT_STATE.md](CURRENT_STATE.md)                   | 当前功能矩阵、生产状态、限制和优先级 | 当前事实源，2026-08-03 核对 |
| [HANDOFF_GUIDE.md](HANDOFF_GUIDE.md)                   | 30 分钟项目总览和代码地图            | 当前交接入口                |
| [DEVELOPMENT_MEMORY.md](DEVELOPMENT_MEMORY.md)         | 历史决策、事故、验收和迁移记录       | 历史日志，顶部当前快照优先  |
| [PRODUCT_VOCABULARY.md](PRODUCT_VOCABULARY.md)         | 产品词汇和角色冻结                   | 有效                        |
| [ACCOUNT_DELIVERY_GUIDE.md](ACCOUNT_DELIVERY_GUIDE.md) | 公账付款后的 C 端/B 端账号交付 SOP   | 有效                        |

## 架构与开发

| 文档                                                   | 用途                                 |
| ------------------------------------------------------ | ------------------------------------ |
| [ARCHITECTURE.md](ARCHITECTURE.md)                     | 总体运行架构和持久化边界             |
| [BACKEND_BOUNDARIES.md](BACKEND_BOUNDARIES.md)         | 八个后端业务边界和跨边界规则         |
| [AUTHORIZATION.md](AUTHORIZATION.md)                   | 登录、注册、邮箱验证、角色与组织权限 |
| [PERMISSION_MATRIX.md](PERMISSION_MATRIX.md)           | 正式权限矩阵和高权限限制             |
| [ORGANIZATION_MIGRATION.md](ORGANIZATION_MIGRATION.md) | organization/tenant 兼容策略         |
| [CODE_STYLE.md](CODE_STYLE.md)                         | React、TypeScript、样式和自动化规范  |
| [JSON_RETIREMENT.md](JSON_RETIREMENT.md)               | JSON Store 退出计划与剩余使用点      |

## 产品与 Provider

| 文档                                                     | 用途                                   | 当前阶段                    |
| -------------------------------------------------------- | -------------------------------------- | --------------------------- |
| [ASSET_GENERATION.md](ASSET_GENERATION.md)               | 资产、可信人像、图片、视频、分镜和成片 | 主流程有效                  |
| [DIRECTOR_PIPELINE_AUDIT.md](DIRECTOR_PIPELINE_AUDIT.md) | 剧本到有声粗剪的链路审计与升级方案     | 2026-08-04 调研结论         |
| [NOVEL_TO_VIDEO_AGENT.md](NOVEL_TO_VIDEO_AGENT.md)       | 长篇小说到视频的阶段方案               | 后端实验，前端开发中        |
| [NOVEL_REGRESSION.md](NOVEL_REGRESSION.md)               | 小说真实样本回归                       | 手工显式执行                |
| [SCENE_MASTER_EXPERIMENT.md](SCENE_MASTER_EXPERIMENT.md) | 按场次母带成片实验                     | 实验脚本，不是产品入口      |
| [BILLING_PAYMENTS.md](BILLING_PAYMENTS.md)               | 积分、Stripe 沙箱与正式支付缺口        | Ledger 可用，正式支付未上线 |

## 测试与质量

- [剧本流程续接与 Image2 验证](WORKFLOW_RESUME_2026-10-10.md)：同步预览、提交冲突保护、定向回归及当前 Image2 上游渠道不可用的验证结果。

- [本地去重与性能核查](DEDUP_PERFORMANCE_AUDIT_2026-09-24.md)：两仓库扫描范围、实测优化、验证结果和既有架构检查失败。

- [网剧统一创作流程](SERIES_CREATION_FLOW.md)：本地新版的单入口、项目绑定、同步边界与验证方法。

- [创作端 UI 预览](STUDIO_UI_PREVIEW_2026-09-17.md)：主站与剧本大师新视觉、本地预览边界和验证范围，尚未部署。
- [人物身份约束与确认后自动加白](CHARACTER_IDENTITY_AND_AUTO_PORTRAIT_2026-09-15.md)：2026-09-15 修复、测试范围和发布状态。

| 文档                                                                                           | 用途                                           |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| [BACKEND_TESTING.md](BACKEND_TESTING.md)                                                       | 单元、契约、集成和安全测试分层                 |
| [TEST_REPORT_2026-09-14.md](TEST_REPORT_2026-09-14.md)                                         | 主项目与剧本大师本地全量测试、失败项和上线阻断 |
| [SCRIPT_MASTER_INTEGRATION.md](SCRIPT_MASTER_INTEGRATION.md)                                   | 独立剧本大师运行、交接边界与已知限制           |
| [SCRIPT_MASTER_ADAPTATION_REVIEW_2026-09-15.md](SCRIPT_MASTER_ADAPTATION_REVIEW_2026-09-15.md) | 线上适配检查、项目绑定与修订版问题、交接验证   |
| [NON_FUNCTIONAL_QUALITY.md](NON_FUNCTIONAL_QUALITY.md)                                         | k6、混沌和安全测试计划                         |
| [RELIABILITY_GATES.md](RELIABILITY_GATES.md)                                                   | CI 与生产拨测门禁                              |
| [OBSERVABILITY.md](OBSERVABILITY.md)                                                           | 日志、健康、readiness、指标和 trace            |
| [USAGE_METRICS.md](USAGE_METRICS.md)                                                           | 用量指标名称、时间窗口、计数规则和可见范围     |

## 部署与运维

| 文档                                                         | 用途                                           |
| ------------------------------------------------------------ | ---------------------------------------------- |
| [OPERATIONS_RUNBOOK.md](OPERATIONS_RUNBOOK.md)               | 当前生产实例、巡检、发布、故障和账号运维       |
| [DEPLOYMENT.md](DEPLOYMENT.md)                               | 新环境部署和上线门槛                           |
| [PRODUCTION_INITIALIZATION.md](PRODUCTION_INITIALIZATION.md) | migration 与首次账号初始化                     |
| [CICD.md](CICD.md)                                           | GitHub Actions、Artifact Registry 和模块化发布 |
| [BACKUP_RESTORE.md](BACKUP_RESTORE.md)                       | Postgres、JSON 和 GCS 备份恢复                 |
| [ENVIRONMENT_STRATEGY.md](ENVIRONMENT_STRATEGY.md)           | 本地、CI、预发布和生产数据策略                 |

## 维护规则

- 当前行为变化：更新 `CURRENT_STATE.md` 和对应专项文档。
- 部署、域名、实例或发布方式变化：更新 `OPERATIONS_RUNBOOK.md`、`DEPLOYMENT.md` 和 `DEVELOPMENT_MEMORY.md`。
- 契约、状态枚举或角色变化：更新 contracts、测试、`AGENTS.md`、权限文档和交接指南。
- 新增文档后把它登记在本索引，不让孤立文档成为隐性事实源。
- 历史记录可以保留当时状态，但必须注明日期，不能覆盖当前事实。
- 文档不得包含真实密码、邀请码、邮箱验证码、API Key、Cookie 或用户上传内容。

- [剧本大师灵感与批量交接](SCRIPT_MASTER_BULK_IMPORT_2026-09-16.md)：空项目对话修复、v2 正文／分镜／资产导入及测试发布记录。

- [剧本大师整页工作台与上游核对（2026-09-16）](SCRIPT_MASTER_WORKSPACE_REFRESH_2026-09-16.md)：入口、创作设定、返回项目和发布验证。

- [分镜多张参考图](SHOT_REFERENCE_IMAGES.md)：上传、编号插入、保存、尾帧映射与视频生成快照。

- [本地视频配置与假成功修复](LOCAL_VIDEO_CONFIGURATION_2026-10-10.md)：5183 视频配置加载、缺配置扣费拦截、历史任务退款及验证边界。
