# 18 Project Principles

## 目的

本文件记录 AI Comic Content OS 的长期项目原则。这些原则不面向某一次实现，而面向项目的持续演进、多人协作与架构稳定性。

---

## 1. System, Not Tool

项目定位是 Content Operating System，而不是单一的视频生成工具。

任何新增模块都应优先服务于内容决策、资产沉淀、平台理解、反馈学习与生产编排，而不是只追求一次性生成能力。

---

## 2. ContentSpec First

`ContentSpec` 是系统最重要的中间对象。

模块之间应尽量通过 `ContentSpec` 交换结构化信息。

如果一个模块需要传递核心内容决策信息，应优先考虑：

- 读取 `ContentSpec`
- 更新 `ContentSpec`
- 生成新的 `ContentSpec` 衍生结果

而不是私下扩散临时字段和不可追踪的数据流。

---

## 3. Platform First, Platform Agnostic

系统在任一阶段可以聚焦一个目标市场，但核心架构必须保持市场和平台可切换。当前 active 市场为中国大陆漫剧市场，红果只作参考；原 TikTok 海外配置保留但 disabled。

平台相关逻辑必须进入：

- `PlatformProfile`
- `PlatformAdapter`

核心模块不得硬编码 TikTok、红果或任何单一平台规则。

切换市场或支持新平台时，应新增或选择版本化配置与适配层，而不是改写核心域模型或删除既有配置。

---

## 4. Knowledge Over Prompt

Prompt 不是长期资产，知识才是长期资产。

项目应优先沉淀：

- Ontology
- Knowledge Base
- Platform Intelligence
- Asset Library
- Feedback Learning Data

如果一个实现只能产生即时输出、却不能沉淀可复用知识，应谨慎评估其长期价值。

---

## 5. Unified Asset Model

剧本、角色、声音、动作、镜头、场景、风格等资源，原则上都属于统一 `Asset` 体系。

默认通过 `asset_type` 区分，而不是为每类资产建立相互孤立的系统。

只有在确有必要时，才允许在统一模型上增加专用扩展结构。

---

## 6. Ontology Governed Tags

标签系统必须受 Ontology 约束。

禁止无治理地创建自由标签。

新增标签前应判断：

- 分类归属是否明确
- 是否已有相似标签
- 是否会造成标签膨胀
- 是否需要同步更新 Ontology 文档

---

## 7. Modular Delivery

系统按小模块持续交付。

每个模块应具备清晰边界：

- 输入
- 输出
- 数据结构
- API
- 错误处理
- 测试

项目不接受一次性大而全的实现方式。

长篇生成同样遵守有界交付：按阶段生成、保存阶段范围与输入、允许人工暂停和更新后续创作信号。任何“一次请求生成完整长篇”的实现都不属于可接受的生产方案。

---

## 8. Adapters for Replaceable AI Providers

AI 能力接入必须通过 Adapter 完成。

这适用于：

- 视频生成模型
- 语音模型
- 图像模型
- 其他外部 AI 服务

业务逻辑层不应依赖某个单一厂商的接口细节。

---

## 9. Script as Control Layer

剧本不是普通文本，而是生产控制层。

后续任何动画重生成、局部调整、镜头替换，都应优先基于结构化剧本进行，而不是直接对最终视频做不可追踪的修改。

---

## 10. Learning Must Be Preserved

发布后的反馈数据必须可回流。

系统应长期支持从反馈中更新：

- 平台认知
- 用户偏好
- 内容模式
- 收益判断
- 资产效果评估

没有反馈闭环的生成能力，不应被视为系统完成态。

---

## 11. Documentation Is Part of the Product

文档不是附属物，而是系统的一部分。

涉及核心结构、数据模型、接口契约、标签体系、平台规则的变化，必须同步更新文档。

文档与代码不一致时，应先识别冲突，再决定如何修正。

---

## 12. Reuse Before Reinvent

设计任何模块前，优先判断是否已有可复用方案：

- 是否已有成熟开源方案
- 是否已有成熟论文
- 是否已有工业标准
- 是否已有稳定算法

如果存在，应优先借鉴、封装、适配，而不是重复造轮子。

本项目真正需要自主沉淀的核心包括：

- `ContentSpec`
- Ontology
- Knowledge Base
- Data Intelligence
- Content Intelligence
- Asset Matching
- Story Engine
- `MasterScript`

---

## 13. Industry Knowledge Before Free Generation

剧本生成属于专业领域，系统应优先复用经过筛选、版本化、可追踪的行业知识，而不是把质量寄托在一次性自由生成上。

这些知识应通过标准机制进入系统，例如：

- `Knowledge Base`
- `Prompt Library`
- `GenerationStrategy`
- Retrieval

禁止把三幕式、节拍表、角色弧线、短剧节奏或平台叙事经验直接写死在业务逻辑里。

---

## 14. Adapt Structure, Not Cultural Shell

借鉴行业经验时，应优先借鉴：

- 结构方法
- 节奏经验
- 生产流程抽象
- 质量控制框架

不应直接照搬：

- 特定作品剧情
- 特定文化外壳
- 特定地域表达习惯

任何知识调用都应结合平台、地区、语言、文化圈层、受众和商业目标做适配。

---

## 15. Separate Production and Developer Artifacts

正式生产工件与开发者工件必须分离。

正式生产工件用于内容生产链路，例如：

- `ContentSpec`
- `CreativeBrief`
- `DraftMasterScript`
- Final `MasterScript`

开发者工件用于评估、调优和协作，例如：

- `StoryQCReport`
- `RevisionPlan`
- `Evaluation Report`
- `Bilingual Developer View`

开发者工件不得污染正式生产字段，双语说明也不应直接进入目标市场语言的正式剧本内容。

---

## 16. Single Box, Stable Contract

`Script Engine` 最终应对外表现为单入口、单出口、可版本演进的能力盒子，而不是一组长期暴露的内部步骤 API。

上游变化应优先通过 request mapper 适配。

---

## 17. Stable Baselines Before Major Optimization

项目进入 `Capability Optimization Phase` 后，能力优化应建立在稳定版本基线上，而不是漂浮状态上持续叠加修改。

重要能力阶段完成后，应形成可追踪基线，用于：

- 复现实验结果
- 对比能力提升前后差异
- 定位回归问题
- 回滚到最后稳定状态
- 记录能力演进历史

在进行较大范围能力优化前，应尽量确保：

- 主链路已验证
- Benchmark 状态明确
- 测试结果可追踪
- 文档已同步
- 版本标识清晰

没有稳定基线时，不应贸然进行大范围能力重构。

下游变化应优先通过 handoff mapper 适配。

不应因为某个上游输入格式或某个下游消费需求的短期变化，直接污染 `Script Engine` 的核心域逻辑或 Final `MasterScript` 数据契约。
