# 04 Open Source Workflow References

## 1. 目标

本文件用于记录当前可借鉴的开源工作流与基础设施，帮助项目在不偏离 MVP 目标的前提下，优先复用成熟方案。

当前目标不是“搬来一个完整剧本工厂”，而是判断：

- 哪些能力适合直接借鉴
- 哪些能力适合只借鉴设计思路
- 哪些能力当前不应接入

当前 MVP 唯一目标仍然是：

- 稳定生成高质量 Final `MasterScript`

## 2. 评估原则

评估任何开源工作流时，必须先判断：

- 是否会绕过 `ContentSpec`
- 是否会破坏 Prompt Library / Generation Strategy / Story QC 的边界
- 是否会削弱可解释性、可测试性与 lineage
- 是否会把当前项目强绑定到某个模型厂商或某个框架
- 是否会让系统从 `Content Planning Engine` 退化成“Prompt 试验台”

## 3. 当前推荐优先借鉴对象

### 3.1 Prompt Evaluation / Regression

参考对象：

- `promptfoo`
- Repo: https://github.com/promptfoo/promptfoo

可借鉴内容：

- Prompt 版本回归测试
- Benchmark 对比
- 多版本输出比较
- 对固定样本集做稳定评测

对本项目的价值：

- 适合对 `Prompt Library`
- `GenerationStrategy`
- `Story QC`
- Benchmark 数据集

进行稳定回归验证。

当前采用方式：

- 借鉴评测与回归思路
- 不直接让其接管项目主数据模型

### 3.2 Structured Output / Validation Pattern

参考对象：

- `Instructor`
- Repo: https://github.com/567-labs/instructor

- `Guardrails`
- Repo: https://github.com/guardrails-ai/guardrails

可借鉴内容：

- 结构化输出校验
- 非法输出重试
- schema-first 约束
- 输出失败时明确报错

对本项目的价值：

- 适合强化 `LLMAdapter`
- 适合强化 `Prompt Builder`
- 适合强化 `DraftMasterScript` schema 校验

当前采用方式：

- 借鉴“先 schema、后生成、再校验”的模式
- 项目内仍以 Pydantic 数据模型为唯一结构真相

### 3.3 Workflow Orchestration / Stateful Revision Loop

参考对象：

- `LangGraph`
- Repo: https://github.com/langchain-ai/langgraph

可借鉴内容：

- 有状态工作流
- 节点式编排
- 多阶段生成与修订图
- 中间状态可追踪

对本项目的价值：

- 当 `DraftMasterScript`
- `StoryQCReport`
- `RevisionPlan`
- `RevisedDraftMasterScript`
- `ReQCReport`

链路进一步复杂化时，可借鉴其状态流建模方式。

当前采用方式：

- 当前只借鉴“状态图工作流”的设计思想
- 当前不引入完整框架

原因：

- 当前主链路还处于能力验证阶段
- 现有服务层已经能覆盖受控链路
- 过早引入重型工作流框架会增加复杂度

### 3.4 Screenplay Export Standard

参考对象：

- `Fountain`
- Site: https://fountain.io/

可借鉴内容：

- 剧本导出格式
- 人类可读的编剧交换标准
- 后续与外部写作或制作工具衔接的可能性

对本项目的价值：

- 可作为 Final `MasterScript` 的附加导出格式参考
- 有助于未来接入 Storyboard / Production Tooling

当前采用方式：

- 只作为导出标准参考
- 不能替代结构化 `MasterScript`

## 4. 当前不建议直接搬运的内容

### 4.1 端到端 Prompt App Framework

当前不建议把项目整体迁移为某个通用 Prompt App 框架。

原因：

- 会弱化 `ContentSpec` 的中心地位
- 会把架构焦点从数据驱动内容规划，偏向 Prompt 调试
- 不利于长期沉淀 Ontology、Platform Intelligence 与 Asset Library

### 4.2 多 Agent 编排框架

当前不建议直接接入复杂多 Agent 工作流。

原因：

- 当前 MVP 目标是验证单链路产出质量
- 当前主要瓶颈不在 Agent 数量，而在：
  - 数据解释性
  - Prompt 质量
  - Story QC
  - Revision 闭环

### 4.3 黑盒剧本生成工具

当前不建议直接依赖黑盒剧本生成器作为主生产引擎。

原因：

- 输出不可控
- 很难保留 lineage
- 很难和 `ContentSpec`、Prompt Library、Generation Strategy 对齐

## 5. 对当前项目的实际落地建议

当前建议按以下优先级借鉴：

### P1 立即借鉴

- 借鉴 `promptfoo` 的 Benchmark / Regression 思路
- 借鉴 `Instructor` / `Guardrails` 的结构化输出与重试模式

适配位置：

- `evaluation/`
- `tests/benchmark/`
- `LLMAdapter`
- `Prompt Builder`

### P2 条件成熟后借鉴

- 借鉴 `LangGraph` 的状态流建模思路
- 借鉴 `Fountain` 的导出标准

适配前提：

- Revision Loop 不再是轻量规则式修订
- 剧本导出开始面向外部制作工具

### P3 当前不接入

- 重型多 Agent 框架
- 黑盒自动编剧平台
- 取代现有域模型的通用 LLM App 框架

## 6. 对系统架构的影响

本研究结论不会推翻当前架构，只会强化以下方向：

- `ContentSpec` 仍然是唯一标准内容对象
- Prompt 仍然必须受 Prompt Library / Prompt Builder / Generation Strategy 管理
- LLM 仍然必须通过 `LLMAdapter` 接入
- Final `MasterScript` 仍然必须保留完整 lineage
- Benchmark 与 Evaluation 会优先借鉴成熟评测思路，而不是从零设计全部机制

## 7. 当前结论

当前最适合借鉴的不是“整套现成剧本生产系统”，而是四类基础能力：

- Prompt / Benchmark 回归
- 结构化输出约束
- 有状态修订工作流设计
- 标准化剧本导出

因此当前结论是：

- 借鉴基础设施
- 保留核心域模型自主设计
- 不让开源框架接管主链路
