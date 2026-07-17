# 03 Script Generation Strategy

## 1. 目标

当前阶段的 Script Generation Strategy 目标不是寻找某一个“神奇 Prompt”，而是建立可复用、可替换、可评估的剧本生成工作流。

当前最终产物仍然是：

- Final `MasterScript`

## 2. 当前原则

- 不强绑定某一个大模型
- 不在业务代码中散落 Prompt
- Prompt 必须结构化管理
- LLM 必须通过 `LLMAdapter` 接入
- 剧本生成优先考虑质量、一致性、可控性与商业价值

## 3. Prompt Library

`Prompt Library` 属于 `Knowledge Base` 的一部分。

它用于存储和管理：

- Story Planning Prompt
- Character Development Prompt
- Dialogue Generation Prompt
- Hook Generation Prompt
- Cliffhanger Generation Prompt
- TikTok Optimization Prompt
- Story QC Prompt
- Commercial Evaluation Prompt
- Localization Prompt
- Negative Prompt

当前字段建议：

- `id`
- `name`
- `prompt_type`
- `target_module`
- `applicable_tags`
- `target_platform`
- `target_audience`
- `version`
- `prompt_template`
- `input_variables`
- `output_schema`
- `evaluation_notes`
- `created_at`
- `updated_at`

## 4. Generation Strategy

`GenerationStrategy` 表示一次剧本生成任务采用的完整生成方案。

它不仅包含 Prompt，还包括：

- 使用哪个 `LLMAdapter`
- 使用哪些 Prompt
- 模型参数
- 工作流步骤
- 是否启用多轮生成
- 是否启用 Story QC
- 是否启用自检
- 是否需要人工审核
- 输出格式要求

## 5. Prompt Builder

`Prompt Builder` 负责根据以下输入动态生成最终 Prompt：

- `ContentSpec`
- `CreativeBrief`
- `PlatformProfile`
- Audience / Commercial 上下文
- Retrieved Assets
- `GenerationStrategy`

当前要求：

- 输出可追踪
- 输出可版本化
- 输出可复盘

## 6. LLMAdapter

`LLMAdapter` 用于接入不同大语言模型。

当前阶段只保留接口与 Mock 实现。

建议接口：

- `generate_text()`
- `generate_structured_output()`
- `validate_output()`
- `get_model_info()`

未来可接入：

- OpenAI
- Claude
- Gemini
- DeepSeek
- Qwen
- Local Model

## 7. Story QC

`Story QC` 用于评估草稿剧本质量。

未来重点检查：

- 剧情逻辑
- 人设一致性
- 情绪曲线
- Hook 强度
- Cliffhanger 强度
- TikTok 平台适配
- 商业潜力
- 文化适配
- 风险内容

当前阶段仅保留接口和轻量 placeholder。

## 8. 推荐链路

`ContentSpec`
→ `CreativeBrief`
→ Asset Retrieval
→ Prompt Retrieval
→ Prompt Builder
→ `LLMAdapter`
→ Draft `MasterScript`
→ Story QC
→ Final `MasterScript`

## 9. 当前不实现

- 真实模型 API 接入
- 复杂多 Agent 编排
- Prompt 自动优化闭环
- 专用剧本模型训练
- 视频生成链路接入

## 10. 对当前架构的影响

当前影响是正向补充，而不是推翻已有架构：

- `ContentSpec` 仍然是唯一标准对象
- `Knowledge Base` 新增 `Prompt Library` 维度
- Script Engine 进入模型无关设计阶段
- `MasterScript` 仍然是当前 MVP 最终输出
