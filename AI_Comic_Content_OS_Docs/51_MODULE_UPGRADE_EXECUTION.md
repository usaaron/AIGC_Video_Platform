# 模块化与模型接入升级记录

## 本轮结论

项目适合继续作为模块化单体运行。现有 Story Project、规划、正文、连续性、Agent 和导出边界已经形成清晰的应用层；拆成微服务会增加跨模块事务、调试和部署成本，当前没有足够的后台吞吐需求证明这个代价。

本轮升级集中在四个实际风险：配置在多个角色间漂移、模型协议被当成同一种 OpenAI 请求、配置资源重启后丢失，以及正文结果把提示词和模型原文带到产品边界。

## 已落地

2026-09-11 更新：当前模型分工以 [53_DEEPSEEK_WORKFLOW_ACCEPTANCE.md](53_DEEPSEEK_WORKFLOW_ACCEPTANCE.md) 为准。所有活跃 GLM 角色已切到 DeepSeek v4 Pro，输入分类、事实提取和独立对白翻译使用 DeepSeek v4 Flash。下方真实 GLM 样本属于切换前记录。

- `llm_protocol.py` 按模型族归一化 thinking、reasoning effort 和 Chat token 字段。GLM 5.3、Gemini 3、DeepSeek 和 OpenAI reasoning wire 的差异由适配器统一处理。
- Grill Me 继续使用 Astra，失败或请求到限时切 DeepSeek v4 Pro。规划类对话修改、大陆正文与正文对话修改使用 DeepSeek v4 Pro；海外正文与正文对话修改使用 Gemini 3.6 Flash Chat Completions。
- 正文服务在请求边界绑定 `release_region`，所有嵌套结构、数量和编辑修复继承同一市场。未带市场字段的恶意或截断提示词不能改变当前请求路由；并发请求使用 ContextVar 隔离。
- 七类重复的进程内仓储收敛为 `DocumentRepository` 的类型化薄适配器，并通过 `module_documents` Alembic 表保存配置和目录资源。数据库读路径无旧内存缓存，事务失败不会发布新值。已有本地目录已迁移 159 条记录。
- 统一 `result_projection` 在 REST、SSE 和 Agent 检查点边界移除 `llm_raw_output`、原始提示词、模板和渲染变量，同时保留业务结果、QC、路由元数据和恢复所需字段。
- 增加宿主授权回调、可信租户/操作者上下文、请求 ID、SSE 兼容观察中间件和 live/ready 健康检查。宿主回调必须在返回上下文前校验路径、查询和请求体中的资源权限。
- 启动脚本使用 `scripts/load_local_env.sh` 统一加载环境变量，移除了三套重复的导出/恢复逻辑；模型日志显示大陆、海外和规划编辑器的实际角色。

## 验证证据

2026-09-11 第一项后续已完成 Gemini 数量修复的故障留档、嵌套结构适配、内容保留与零请求重放。对照过程及历史样本不可精确复现的边界见 [52_GEMINI_PRODUCTION_COUNT_REPAIR.md](52_GEMINI_PRODUCTION_COUNT_REPAIR.md)。下列数字保留为前一批升级的验证记录。

- 后端：`1323 passed, 1 skipped`。
- 前端最新全量：`399 passed`，TypeScript typecheck 与 API 契约一致性检查通过；生成类型补齐后端已有的任务 claim 接口及租约字段。
- 真实协议探针：GLM 5.3 与 DeepSeek v4 Pro 使用 Chat Completions，Astra 使用 Responses，各自流式与非流式通过。Gemini 3.6 Flash 的 Chat 流式与非流式也通过；Gemini Responses 在当前网关返回配额耗尽。两种 wire 的参数映射另外有离线测试，不能把它等同于两种接口都已实测。
- 真实隔离正文：大陆一集 778 个有效正文字符，生成 154.201 秒；海外最新一集 1661 字符，生成 29.274 秒、1 次模型请求，海外语言和连续性检查通过。两份结果都能在新进程、零模型请求下完全重放。
- 海外还保留一个失败样本：4 次请求均正确使用 Gemini，数量修复后仍未满足交付合同，返回 422，没有保存不合格草稿。后续新样本通过，不能据此推断稳定成功率或稳定耗时。当前接入已经可用，生成质量还需要更大样本验收。

本地证据位于 `.cache/module-upgrade-runtime/`：`backend-regression.log`、`mainland-episode/REPORT.md`、`overseas-market-bound/REPORT.md`（失败样本）、`overseas-final-check/REPORT.md` 及各目录的重放报告。协议探针位于 `.cache/model-routing-runtime/`。Gemini 网关的明细 token 字段返回零而 total_tokens 非零，不能据此计算输入/输出费用。

最新开发实例为 `http://127.0.0.1:3002/`，后端 `http://127.0.0.1:8002/`。前端、项目 API 与 ready 均返回 200；1440 和 390 像素宽度的浏览器检查没有页面脚本错误或横向溢出，截图为 `final-page-1440.png` 和 `final-page-390.png`，前端检查日志为 `frontend-check.log`。

## 仍需宿主或生产环境完成

`host_integration.py` 是明确的集成合同，不是已经部署的认证系统。宿主仍需提供真实认证授权回调、租户范围查询和项目/资源行级隔离；当前代码不能凭客户端租户 Header 自动获得权限，也没有替宿主决定租户数据模型。

宿主通过 `create_app(host_authorizer=..., require_host_context=True)` 注入回调。独立进程可设置 `HOST_INTEGRATION_REQUIRED=true`，缺回调时业务接口及 ready 返回 503；本地开发默认关闭该要求。宿主回调返回的 request_id 用于响应头及访问日志。`/health/live` 检查进程，`/health/ready` 检查数据库表和必需回调，不发送付费模型请求。

共享文档仍保留原有最后写入生效语义，不提供多字段编辑 CAS；版本化故事聚合继续使用原有事务与 CAS。PostgreSQL DDL/JSONB 已实现，本轮实际迁移和跨进程测试使用 SQLite，尚未完成真实 PostgreSQL 的并发负载验收。Prompt 管理和构建接口仍属于内部接口，生产宿主需要限制访问；正文 API 脱敏不等于所有管理接口已封闭。

当前仍没有承诺无人值守执行，因此没有新增队列或分布式 worker。若产品承诺后台生成，应先确定 durable queue、租约、幂等键、重试预算和人工暂停语义，再实现 worker；现有 Agent 检查点可以作为该工作的基础。

静态知识目录不是动态 RAG，Creative Deepening 仍默认关闭。完整长篇的创意质量、容量和多集连续性也没有被一集真实样本证明。未来增加 Agent 时应复用现有 Application Service、校验和检查点，不再为同一职责新增自由循环的模型层。大型 generation_service、story_planning_service 和前端 workspace 控制器仍需按实际用例逐步拆分；本轮抽出了共同协议、仓储及结果投影，没有以搬移整个大文件冒充复杂度下降。

## 使用规则

新增模型时先在 `llm_protocol.py` 增加协议族测试，再在 `config/model-config.env.example` 和分片模板增加角色引用，最后运行 `scripts/probe_model_protocols.py --live` 与相应市场的真实隔离样本。配置模板可以组织变量，但启动器仍只读取根目录 `.env.local`；真实密钥不进入 Git、日志或报告。

协议映射参考 [GLM thinking 文档](https://docs.bigmodel.cn/cn/guide/capabilities/thinking)、[DeepSeek thinking 文档](https://api-docs.deepseek.com/guides/thinking_mode/) 和 [Gemini OpenAI 兼容接口](https://ai.google.dev/gemini-api/docs/openai)。供应商文档与当前网关可用性是两层证据，协议探针只证明记录时的实际响应。
