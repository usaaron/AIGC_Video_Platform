# 06 Script Knowledge Framework

## 目的

本文件用于研究未来 `Story QC`、`Prompt Builder`、`Prompt Evaluation`、`Script Revision` 应依赖的专业剧作知识体系。

当前阶段的目标不是立刻把这些知识写成大量评分规则，而是先建立一个可治理、可版本化、可追踪的 `Script Knowledge Framework`。

当前明确边界：

- 本文件是 `Research`，不是代码设计稿
- 本文件不直接驱动主链路改造
- 本文件不意味着当前 `Story QC` 已具备专业编剧评审能力
- 当前 `Story QC` 仍然是 placeholder / 轻量实验能力

## 研究目标

未来 `Story QC` 的长期定位不只是 Quality Checker，而是 `Script Expert`。

这意味着它后续应能够：

- 引用成熟编剧理论
- 引用短剧工业经验
- 引用平台叙事规律
- 根据平台、地区、受众、类型和商业目标做适配
- 给出可解释、可引用来源、可追踪版本的专业评审意见

因此，未来 `Story QC` 的判断不应主要建立在硬编码规则上，而应建立在统一的知识框架上。

## 总体原则

### 1. Knowledge Before Rules

先明确知识来源、适用范围和抽象层级，再决定是否实现成规则、评估项或修订建议。

### 2. Research Before Implementation

先研究：

- 为什么行业采用它
- 适用于哪些内容
- 不适用于哪些内容
- 海外短剧是否仍然适用
- TikTok 是否需要调整
- 哪些部分可以抽象
- 哪些部分不能直接照搬

再决定是否进入：

- `ScriptIndustryKnowledge`
- `Story QC`
- `Prompt Builder`
- `Prompt Evaluation`
- `Benchmark`

### 3. Knowledge Is Not Prompt

这些知识不是为了直接复制到 Prompt。

它们应通过统一机制进入系统，例如：

- `ScriptIndustryKnowledge`
- `Knowledge Base`
- Retriever
- `GenerationStrategy`
- `Story QC`
- `Prompt Builder`

### 4. Adapt Structure, Not Cultural Shell

优先借鉴：

- 结构方法
- 节奏规律
- 质量评审框架
- 工业化流程抽象

不直接照搬：

- 具体作品内容
- 特定文化表达外壳
- 某个平台或地区的表层套路

## 1. Story QC 未来应参考哪些知识

### 1.1 Script Structure

当前值得重点研究的结构知识包括：

- Three-Act Structure
- Save the Cat
- Beat Sheet
- Scene Goal / Conflict / Outcome
- Character Arc
- Emotional Arc

#### 为什么行业采用

- 帮助作者控制故事推进节奏
- 帮助识别“这一场为什么存在”
- 帮助把剧情转折、人物变化和情绪推进结构化

#### 适用于哪些内容

- 需要明确冲突升级的商业类型剧
- 需要强 Hook 和强 cliffhanger 的短剧
- 需要控制角色成长和观众预期的连载内容

#### 不适用于哪些内容

- 强实验性、强氛围型、不以情节驱动为主的作品
- 过度依赖碎片情绪而非明确情节推进的内容

#### 对海外短剧 / TikTok 的启发

- 不应照搬完整电影长度结构
- 更适合抽象成“压缩结构单元”
- 应重点保留：
  - 快速设定
  - 明确冲突
  - 高密度 turning point
  - 可持续的 cliffhanger 节奏

### 1.2 Short Drama Structure

当前重点研究对象：

- TikTok
- ReelShort
- DramaBox
- ShortMax
- Webtoon
- 海外竖屏短剧

研究重点不是具体作品，而是：

- 节奏
- Hook
- Cliffhanger
- Episode Structure
- Character Agency

#### 为什么行业采用

- 短剧商业模式依赖强留存、追更和连续消费
- 单集时间短，必须快速建立矛盾与支付期待

#### 重点抽象方向

- 前 1 到 3 句如何建立冲突
- 单集内部如何完成一次反转或权力变化
- 集尾如何制造下一集必看问题
- 主角如何持续主动制造剧情推进
- 如何在极短时长中保持信息密度与情绪连续性

#### 海外适配注意事项

- TikTok 的节奏通常更快、更直给
- Webtoon 更强调视觉叙事与连续悬念设计
- ReelShort / DramaBox / ShortMax 的付费追更逻辑值得研究，但不能直接复制平台表面套路

### 1.3 Dialogue

当前重点研究：

- 对白节奏
- 信息密度
- 角色区分度
- 冲突语言
- 台词长度

#### 为什么行业采用

- 台词是最直接影响信息传达、角色辨识和节奏体感的层
- 短剧对话往往承担 exposition、冲突推进和评论触发三重任务

#### 适用性判断

- 高冲突类型剧适合短句、高压、意图明确的语言
- 情感重戏需要保留呼吸感，不能只剩功能性台词
- 每个角色应有不同话语姿态，而不是统一“AI 腔”

#### 海外短剧注意点

- 英文短剧对白通常更追求可立即理解
- 直给不等于粗糙，关键是角色意图要清晰
- 需要平衡：
  - 强冲突
  - 自然口语
  - 平台可消费性

### 1.4 Character

当前重点研究：

- 人物主动性
- 人物一致性
- 人物成长
- 人物关系
- 人物驱动力

#### 为什么行业采用

- 主角主动性直接影响剧情牵引力
- 人设一致性直接影响观众信任感
- 角色关系网决定后续冲突可持续性

#### 对 `Story QC` 的启发

- 不能只问“角色有没有设定”
- 应问：
  - 角色是否真正做出推进剧情的选择
  - 角色行为是否符合当前动机
  - 角色关系是否持续制造 tension
  - 角色成长是否可感知

### 1.5 Commercial Storytelling

当前重点研究商业剧本如何提高：

- Retention
- Completion
- Binge
- Continuation
- Shareability
- Comment Trigger

#### 为什么行业采用

- 平台内容不是只评审文学性，还评审可消费性
- 商业剧本需要同时满足叙事推进和行为转化

#### 可研究的抽象指标

- 首屏 Hook 是否足够清晰
- 每场是否有推进价值
- 是否持续制造“再看一集”的问题
- 是否容易触发观众站队、争议、猜测或评论
- 是否存在可传播的情绪/台词节点

## 2. 可借鉴对象

### 编剧理论

- Save the Cat
- Three-Act Structure
- Beat Sheet
- Character Arc

研究重点：

- 核心结构单元
- 可压缩到短剧的部分
- 不适合直接迁移到竖屏短剧的部分

### AI 写作产品

- Sudowrite
- NovelCrafter

研究重点不是 Prompt，而是：

- 它们如何拆解写作能力
- 它们如何组织知识、角色、世界观和 revision
- 它们如何让用户进行局部修改和可控生成

### 平台与内容形态

- TikTok
- ReelShort
- DramaBox
- ShortMax
- Webtoon

研究重点：

- 工作流
- 评审标准
- 能力拆分
- 节奏模式
- 单集结构
- 集尾悬念机制

## 3. Script Knowledge Registry

未来建议建立 `Script Knowledge Registry`。

每条知识建议字段包括：

- `knowledge_id`
- `title`
- `category`
- `description`
- `source`
- `applicability`
- `target_platforms`
- `target_regions`
- `genres`
- `confidence`
- `implementation_status`
- `reference`

### Registry 设计原则

- 每条知识必须有来源和适用边界
- 每条知识必须可被版本管理
- 每条知识必须能被引用，而不是只能口头描述
- 同一知识可以被不同模块复用

### 后续引用方向

未来以下对象应逐步支持引用 `knowledge_id`：

- Prompt
- `Story QC`
- Benchmark
- `Prompt Evaluation`
- `GenerationStrategy`
- `RevisionPlan`

## 4. Story QC 的未来方向

未来 `Story QC` 不应只输出一个总分。

它应逐渐支持以下维度的结构化评审：

- Story Structure
- Scene Purpose
- Conflict
- Pacing
- Hook
- Cliffhanger
- Character Agency
- Dialogue
- Emotion
- Commercial Potential
- Platform Fit
- Culture Fit

### Explainability

未来每个评分都应尽量说明：

- 为什么扣分
- 引用了哪些知识
- 引用了哪些规则
- 这些知识是否适用于当前：
  - Platform
  - Audience
  - Region
  - Genre

## 5. 本阶段不做什么

本轮不做：

- 新增大量 `Story QC` 规则
- 修改 Prompt
- 修改生成逻辑
- 修改主链路
- 新增大型 Engine

本轮只建立知识体系与研究边界。

## 5.1 Story QC Credibility Improvement v1 对 Research 的最小落点

在不实现完整 Knowledge System 的前提下，当前研究可以先支持 `Story QC Credibility Improvement v1` 的最小设计。

当前优先服务的 5 个维度：

- `Hook Quality`
- `Character Agency`
- `Conflict Escalation`
- `Emotional Payoff`
- `Cliffhanger Strength`

当前 Research 作用：

- 为这 5 个维度提供后续可引用知识来源
- 帮助定义“为什么扣分”而不是只给结论
- 帮助把知识引用转换成可治理字段，而不是散落说明文本

### 当前建议的知识引用占位

未来 `StoryQCReport` 可逐步支持：

- `knowledge_refs`

推荐结构示意：

```json
{
  "knowledge_id": "character.agency.active_choice.v1",
  "dimension": "character_agency",
  "reason": "Protagonist reacts to events instead of initiating action.",
  "evidence": "Scene 2"
}
```

当前说明：

- 这不是要求本轮立即构建完整知识检索系统
- 这只是为后续 `Story QC`、`Prompt Evaluation`、`Revision` 预留统一知识引用方式
- `knowledge_id` 的存在意义是提高可追踪性、可复查性和知识治理能力
- 当前代码已支持 `knowledge_refs` 兼容字段，但它仍不代表完整知识系统已落地

### v1 不应过度承诺的内容

即使补充了 `knowledge_refs` 占位，也不代表：

- 当前 `Story QC` 已经具备完整专业评审能力
- 当前知识体系已经可以自动决定所有扣分逻辑
- 当前报告已经可以替代人工剧本打磨

因此，v1 更准确的定位是：

- `Explainability Upgrade`
- 不是 `Professional Story Judge Completed`

## 6. 建议进入长期 Backlog 的能力

- Knowledge-aware `Story QC`
- Knowledge-aware `Prompt Builder`
- Knowledge-aware `Prompt Evaluation`
- Knowledge-aware `Script Revision`
- Knowledge-aware Retrieval
- Knowledge-aware Benchmark

## 7. 当前建议的实现顺序

### 下一阶段优先建议

1. 让 `Story QC` 报告先支持 5 个核心维度的 explainability 字段
2. 让 `Story QC` 报告支持“引用 knowledge_id”占位字段
3. 让 `Prompt Evaluation` 报告支持“使用了哪些 `Story QC` 维度解释”观察项
4. 建立最小 `Script Knowledge Registry` 文档/数据契约

### 暂缓事项

- 不要一次性把所有编剧理论写成硬编码评分器
- 不要在知识边界还不清楚时把它们直接塞进 Prompt
- 不要在还没有 benchmark 证明前宣称 `Story QC` 已经专业化

## 结论

当前 `Story QC` 的正确升级路径不是继续堆评分规则，而是先建立一个统一、可治理、可引用的 `Script Knowledge Framework`。

只有这样，后续 `Story QC`、`Prompt Builder`、`Prompt Evaluation`、`Script Revision` 和 Benchmark 才能在同一知识体系上持续迭代，而不是各自积累难以维护的局部经验。
