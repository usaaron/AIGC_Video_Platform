# 模型配置拆分方案

当前 `.env.local` 已能加载多市场、多角色配置，但同一个模型的 URL、Key 和策略分散在通用变量、市场变量和备用变量中，修改时容易误改路由。Qwen 的旧地址也已经在链路诊断中确认不可用。

本轮加入可迁移的拆分模板 [model-config.env.example](../config/model-config.env.example)，用于查看和整理变量分组。运行时继续使用单文件 `.env.local`，不引入额外配置目录。

建议最终采用以下层次：

| 分片 | 内容 | 每个模型保留 |
| --- | --- | --- |
| `00-runtime.env` | 数据库、市场、功能开关 | 不放模型 Key |
| `10-provider-credentials.env` | GPT、Gemini、Qwen、DeepSeek 的供应商凭据 | `CFG_*_BASE_URL`、`CFG_*_API_KEY`、模型名、协议 |
| `20-common-policies.env` | 超时、重试、推理和熔断默认值 | 不重复 URL/Key |
| `30-cn-mainland-roles.env` | 大陆创意、圣经、剧情树、路线图、正文 | 每个角色引用对应供应商槽位 |
| `40-overseas-roles.env` | 海外对应角色 | 每个角色引用对应供应商槽位 |
| `90-optional-fallbacks.env` | 备用网关和备用 Key | 只在确认可用后启用 |

这样改的重点是：每个模型的地址和 Key 只需要在凭据区填写一次；不同角色共享该槽位，但仍输出后端实际读取的 `LLM_*` 变量。备用线路独立保存自己的 URL 和 Key，不会复用主线路密钥。

模板没有替换当前 `.env.local` 中的真实值，也没有猜测新的 Qwen 地址。当前本地文件通过环境变量引用复用已有的供应商凭据，`CFG_*` 是模板中的分组方案；编号分片不会被启动器自动加载，使用时需按顺序合并到 `.env.local`。

2026-09-10：共享 `LLM_PLANNING_EDITOR`（DeepSeek）和 `LLM_ASTRA_FALLBACK`（GLM）只在通用策略区定义。两条市场路径分别保留 Grill Me（Astra）和正文对话编辑器（大陆 GLM、海外 Gemini）。合并模板与分片模板均已通过变量展开及运行时适配器接线测试；切换规则以 [14_Script_Engine.md](14_Script_Engine.md) 为准。

2026-09-11：运行配置与模板已统一到当前分工，规划生成使用 Astra Responses；规划对话修改使用 DeepSeek v4 Pro Chat Completions；大陆正文为 DeepSeek v4 Pro Chat Completions，海外正文为 Gemini 3.6 Flash Chat Completions。Gemini Responses 在当前网关受配额限制；其 Chat 接口已通过流式、非流式和真实正文样本。Qwen 槽位保留为可选凭据，当前模板不再让活跃规划角色依赖它。

同日追加：Astra 备用也已改为 DeepSeek v4 Pro，独立请求预算为 300 秒；输入完成度分类、已提供事实提取与独立对白翻译使用 DeepSeek v4 Flash。Pro/Flash 共享 DeepSeek 凭据，轻量角色关闭思考，正文和复杂修改启用 high 思考。最新验证范围见 [53_DEEPSEEK_WORKFLOW_ACCEPTANCE.md](53_DEEPSEEK_WORKFLOW_ACCEPTANCE.md)。

`ModelProtocol` 集中处理每个模型的推理参数与 token 字段；Astra 默认启用严格 Schema，关闭 transport response_format 时提示词仍包含输出合同。本地网关 BASE_URL 已补齐实际 `/v1` 前缀。不要用同一个 wire 或 thinking 开关假设所有供应商行为一致，当前核验见 [51_MODULE_UPGRADE_EXECUTION.md](51_MODULE_UPGRADE_EXECUTION.md)。

验证配置时至少检查：每个启用角色的 `MODEL`、`BASE_URL`、`API_KEY`、`WIRE_API` 成对一致。`scripts/probe_model_protocols.py` 默认只展示配置；`--live` 发送合成 JSON 请求，之后再验证对应业务流程。不要把 API Key 写入 Git、测试日志或报告。
