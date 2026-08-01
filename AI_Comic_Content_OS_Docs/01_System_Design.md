# AI Comic Content OS
## 01_System_Design.md
### System Design Specification V1.0

---

## 1. 项目概述

### 1.0 当前 MVP 聚焦

当前 MVP 的唯一目标不是视频生产，而是稳定产出高质量 `MasterScript`。

自 2026-08-01 起，默认市场配置从海外 TikTok 切换为中国大陆漫剧市场：

- `cn_mainland` 为当前 active 配置
- 红果为参考平台，不形成供应商或平台硬绑定
- `overseas_tiktok` 完整保留但默认 disabled
- Creative Deepening 前后端运行开关默认关闭，不进入当前创作路径
- 当前已加入基础阶段生成边界：按项目总集数分有界批次生成，批次间允许更新创作输入；PostgreSQL/JSONB schema、migration、Repository 和长篇规划资源 API 已实现，但 Frontend 切换、后台任务恢复与专业长篇规划仍待实现

本文后续未改写的 TikTok V1 内容属于历史设计背景或停用资产说明，不再代表当前默认运行目标。

当前主链路统一为：

Data Intelligence
→ `ContentSpec`
→ optional `ResolvedCreativeContext`
→ Orchestrator / Asset Retrieval
→ Prompt Retrieval
→ Static Creative Knowledge Selection（optional, strategy-declared）
→ Prompt Builder
→ `LLMAdapter`
→ Draft `MasterScript`
→ Creative Deepening Candidate（当前默认关闭；保留可切换能力）
→ Source / Candidate QC Comparison（仅在显式启用 Deepening 时存在）
→ Story QC
→ `RevisionDecision`
→ `RevisionStrategy`
→ `RevisionPlan`
→ `RevisionExecutor`
→ Re-QC
→ `AcceptanceDecision`（shadow）
→ `ScriptRevisionRun`
→ Finalization Gate
→ Final `MasterScript`

当前 Data Intelligence 还增加了 `Scheduled Ingestion` 分支：

`Scheduled Ingestion` → `DataSourceAdapter` → `RawContentRecord` → 标准分析流程

当前已实现 Phase 1 输入控制边界。Data Intelligence 不再被视为最终创作规范的唯一决定者：

Data Intelligence → Recommended Tags

User → Selected Tags / Added Tags / Excluded Tags / Creative Prompt

`PlatformProfile` → Hard Constraints

以上输入 → Creative Brief Resolution → Final `ContentSpec` → 现有 Script Generation

其中 Phase 1 已通过现有 `ContentSpecService` 实现确定性 `CreativeIntentInput -> ContentSpec + ResolvedCreativeContext` Resolution API。Script Engine 的标准化需求输入仍是 `ContentSpec`，Character Context、字段 provenance、locked fields 和 exclusions 通过独立 optional 上下文进入 Draft Generation，不写入 `ContentSpec.metadata`。Phase 2 已接入由 `GenerationStrategy` 显式声明、按 tag / platform / stage 校验的静态 Draft 与 Deepening Knowledge Bundle。Creative Deepening 代码保留，但当前由独立前后端开关关闭。Frontend MVP 已通过现有步骤 API 支持逐集和分阶段全部生成；每个阶段保存集数范围、阶段指令和完成状态，并允许下一阶段读取更新后的标签、角色、故事线与人物关系。该能力仍是对单集 API 的有界编排，不是 Story Blueprint / Episode Planning runtime。后端已建立 PostgreSQL 长篇 schema、Alembic migration、事务型 Repository 和 Project / Story Bible / Stage / Episode Plan 资源 API，但 Frontend 尚未切换，因此当前浏览器项目仍不具备自动服务端恢复。推荐标签 fallback、alias / unresolved tag 处理、正式后端 Relationship Contract、AI 自动补全、动态 Knowledge Retrieval / RAG 仍未实现。

当前最小实现中，`Asset Retrieval` 的直接输入暂由 `OrchestrationPlan.asset_requests` 承载，用于保证资产检索请求结构化、可控、可测试。

当前 Script Engine 的内部推荐流程为：

`ContentSpec`
→ optional `ResolvedCreativeContext`
→ `CreativeBrief`
→ Orchestrator / Asset Retrieval
→ Prompt Retrieval
→ Static Creative Knowledge Selection（optional）
→ Prompt Builder
→ `LLMAdapter`
→ Draft `MasterScript`
→ Creative Deepening Candidate（optional shadow）
→ Source / Candidate QC Comparison（observational）
→ Story QC
→ `RevisionDecision`
→ `RevisionStrategy`
→ `RevisionPlan`
→ `RevisionExecutor`
→ Re-QC
→ `AcceptanceDecision`（shadow）
→ `ScriptRevisionRun`
→ Finalization Gate
→ Final `MasterScript`

当前最小联调能力补充：

- 已提供 `Script Generation Draft Integration Service`
- 当前可把 `ContentSpec + GenerationStrategy` 贯通到：
  - `Orchestrator`
  - `Retrieval`
  - `Prompt Builder`
  - `LLMAdapter`（Mock 或 OpenAI-compatible Real）
  - `Story QC`
  - `RevisionPlan`
  - `Script Revision`

当前已具备从 Draft、受控 Revision、Re-QC 到 Final `MasterScript` 的完整运行链；`AcceptanceDecision` 仍处于 shadow mode，不阻断 Finalization。

当前阶段视频生成、动画生成、Storyboard、Seedance、配音、剪辑等全部属于 Phase 2，仅保留接口与扩展位置。

当前 `Knowledge Base` 的最小实现当前包括：

- 统一 `Asset` 模型
- `Prompt Library Foundation`

后续再逐步扩展到检索、图谱与更复杂的知识组织方式。

当前 Script Engine Foundation 已进一步包括：

- `GenerationStrategy Foundation`

### 1.1 项目背景

AI 视频生成模型、AI 绘图模型、语音合成模型和大语言模型正在快速降低内容生产门槛。对于 AI 漫剧出海项目而言，单纯搭建视频生成工作流已经不再是长期壁垒。

本项目的核心判断是：

> 视频生成是执行层问题，内容决策与内容资产沉淀才是长期竞争力。

因此，本项目不只是一个 AI 漫剧生成工具，而是一套可按市场配置切换的数据驱动内容生产操作系统。当前默认面向中国大陆漫剧市场；海外 TikTok 是已保留但停用的历史验证配置。

系统长期目标不是简单地自动生成动画，而是实现：

- 自动理解市场趋势
- 自动理解 TikTok 平台规则与收益机制
- 自动分析海外用户偏好
- 自动分析付费人群画像
- 自动沉淀内容资产
- 自动生成结构化剧本
- 自动调用视频、声音、动作、人物等资产库
- 自动生成动画（Phase 2）
- 自动根据反馈持续优化

---

## 2. 项目愿景

AI Comic Content OS 的长期愿景是构建一套可复用、可扩展、可学习的内容操作系统。

它不是：

> AI 漫剧视频生成器。

而是：

> 数据驱动的内容策划、资产调度、剧本生成、动画生成与反馈学习系统。

系统长期沉淀的核心资产包括：

- 内容知识库
- 标签体系
- 知识图谱
- 用户偏好数据
- TikTok 平台策略数据
- 商业化分析数据
- 剧本结构库
- 人物库
- 声音库
- 动作语义库
- 镜头语言库
- 场景库
- 风格库

这些资产未来可以继续支持：

- AI 漫剧
- AI 漫画
- AI 小说
- AI 短剧
- AI 动画
- 游戏叙事
- 教育内容

---

## 3. 当前市场定位

### 3.1 当前目标市场

当前围绕中国大陆漫剧市场构建长篇故事母本能力，不绑定单一发行平台。

红果、番茄 IP 改编生态及其他国内平台实践只作为有来源、可版本化、可验证的市场参考。具体平台的分发、分账、字数、付费卡点与推荐规则不得变成全局硬编码。

原 TikTok 海外配置保留为 `overseas_tiktok`，当前状态为 disabled；后续只有在明确切换市场配置时才重新启用。

### 3.2 架构原则

系统架构不绑定中国大陆、红果或 TikTok。

系统采用：

> Platform First, Platform Agnostic Architecture

即：

- 当前业务实现聚焦中国大陆长篇故事母本
- 架构设计保留平台适配能力

未来如需支持 YouTube Shorts、Instagram Reels、WEBTOON、ReelShort 等平台，只需新增对应 Platform Profile，而不是重构整个系统。

---

## 4. 核心设计原则

### 4.1 Data Driven

所有内容决策尽可能基于数据，而不是单纯依赖创作者经验。

数据包括：

- TikTok 热门内容
- 评论区反馈
- 用户行为数据
- 热点趋势
- 商业化数据
- 平台规则
- 付费用户画像

### 4.2 Knowledge First

一次性手写 Prompt 不是长期资产，知识才是长期资产。

系统不应依赖一次性 Prompt，而应沉淀：

- 剧情结构知识
- 角色知识
- 情绪结构知识
- 动作语义知识
- 声音风格知识
- TikTok 平台规则知识
- 商业化知识

当前进一步补充：

- 结构化 `Prompt Library` 可以作为 `Knowledge Base` 的一部分长期沉淀
- Prompt 必须可版本化、可追踪、可评估
- 业务代码中不应散落模型耦合 Prompt 文本

### 4.3 Modular

系统采用模块化架构。

每个模块职责独立，输入输出清晰，便于：

- 分工开发
- 单独测试
- 后续替换
- 长期维护

### 4.4 Reusable Asset

所有可复用内容都应进入资产库。

资产包括：

- 剧本结构
- 人物设定
- 声音模板
- 动作语义
- 镜头语言
- 场景设定
- 世界观
- 视觉风格

### 4.5 Tag + Creative Brief 双驱动

Data Intelligence 应输出可解释的推荐标签与推荐理由，但不直接决定最终 Creative Brief。最终创作输入由数据建议、用户选择、用户自由创意和平台硬约束共同解析。

- Recommended Tag 用于提供可接受或拒绝的数据建议
- Selected / Added Tag 表示用户明确采用的受控 Ontology 节点
- Excluded Tag / Pattern 表示用户明确不希望出现的内容
- User Creative Prompt 表达标签无法充分承载的创作意图
- `PlatformProfile` 提供不可被用户覆盖的平台与安全硬约束
- 解析结果映射为 `ContentSpec.tags`、`ContentSpec.creative_brief`、目标字段和可追踪 warning

标签回答：

> 调用什么资产？

Creative Brief 回答：

> 如何生成内容？

当前新增边界：原始标签和自由 Prompt 属于上游 authoring input，不允许绕过标准化解析直接替代 `ContentSpec`。

### 4.6 Script as Control Layer

剧本不是普通文本，而是动画生成的中控层。

后续如果需要修改动画，不直接修改视频，而是修改结构化剧本，再局部重生成动画。

这可以提高：

- 可控性
- 可维护性
- 局部修改能力
- 团队协作效率

### 4.7 Continuous Learning

每一次内容发布之后，系统都应该收集反馈并更新知识库。

反馈包括：

- 评论
- 点赞
- 收藏
- 分享
- 完播率
- 留存
- 付费表现
- 平台推荐表现

---

## 5. 系统总体架构

系统分为四大层：

```text
Decision Layer
↓
Knowledge Layer
↓
Production Layer
↓
Learning Layer
```

### 5.1 当前 MVP 执行边界

当前实际执行边界到 `MasterScript` 为止。

当前阶段 Production Layer 只覆盖：

- Asset Retrieval
- Orchestrator
- Script Engine
- `MasterScript`

视频相关执行层能力当前不进入实际开发。

未来 Media Production Phase 的兼容方向为：

Final `MasterScript`
→ Script-to-Production Adapter
→ Model-Independent Production Package
→ Video Model Adapter
→ Provider-Specific Generation Package

其中 Seedance 只允许作为 `Video Model Adapter` 的一种实现。角色视觉锚点、镜头、灯光、音频、连续性约束和模型 Prompt 应从 Final `MasterScript` 派生，不得以 Seedance 专用字段污染 Script Engine 核心契约。

---

## 6. Decision Layer 决策层

Decision Layer 负责回答：

> 做什么内容？

它包括以下模块：

### 6.1 Data Intelligence

负责收集与分析外部数据。

数据来源包括：

- TikTok
- YouTube Shorts
- WEBTOON
- Tapas
- Reddit
- Google Trends
- TikTok Creative Center
- DramaBox
- ReelShort
- App Store
- Google Play

未来可扩展：

- Sensor Tower
- data.ai
- Similarweb

### 6.2 Audience Intelligence

负责分析用户偏好。

分析维度包括：

- 国家
- 地区
- 文化簇
- 年龄
- 性别
- 兴趣
- 喜欢的题材
- 喜欢的角色
- 喜欢的剧情结构
- 讨厌的内容
- 弃剧原因

系统优先按照文化簇分析，而不是一开始就按国家精细划分。

例如：

- Dark Romance Cluster
- Werewolf / Supernatural Cluster
- Revenge Drama Cluster
- Fantasy Cluster

### 6.3 Commercial Intelligence

负责分析商业价值。

它不只回答：

> 用户喜欢什么？

还要回答：

> 用户愿意为什么付费？

分析维度包括：

- 付费用户画像
- 高 LTV 用户
- 高订阅意愿用户
- 高广告价值用户
- 高 IP 延展价值用户
- 高周边消费潜力用户
- 不同文化簇的商业潜力
- 不同题材的变现潜力

### 6.4 Trend Intelligence

负责识别趋势与热点。

例如：

- 最近 7 天某题材热度上升
- 某角色类型评论率上升
- 某类剧情结构在 TikTok 爆发
- 某类关系模式在海外用户中增长

热点线和长线 IP 线都可以使用 Trend Intelligence。

当前 MVP 最小实现中，Trend Intelligence 先通过 `TrendSnapshot` 聚合 `DataIngestionRunHistory`，而不是直接上复杂趋势模型。

### 6.5 Platform Intelligence

V1 阶段重点分析 TikTok。

Platform Intelligence 负责研究：

- TikTok 推荐机制
- TikTok Creator Rewards 收益规则
- TikTok AI 内容政策
- TikTok Community Guidelines
- TikTok 内容最佳实践
- TikTok 发布策略

Platform Intelligence 输出 Platform Profile，并作为 Content Spec 的重要输入。

---

## 7. TikTok Platform Intelligence

### 7.1 TikTok Platform Profile

V1 阶段系统维护一个 TikTok Profile。

TikTok Profile 包括：

- Recommendation Rules
- Creator Rewards Rules
- AI Content Policy
- Community Guidelines
- Content Best Practices
- Publishing Strategy
- Platform Constraints

### 7.2 推荐机制关注点

系统需要持续记录和验证 TikTok 内容表现指标，包括：

- 完播率
- 平均观看时长
- 评论率
- 分享率
- 收藏率
- 二刷率
- 追更能力
- 系列内容连续观看表现

### 7.3 收益规则

系统需要维护 TikTok Creator Rewards 相关规则。

包括：

- 原创内容要求
- 视频时长要求
- 账号资格要求
- 内容合规要求
- AI 内容披露要求
- 收益资格判断

这些规则必须作为可更新配置，而不是写死在代码里。

### 7.4 AI 内容政策

系统需要记录：

- AI 生成内容是否需要标识
- AI 内容是否影响推荐
- AI 内容是否影响收益资格
- 哪些 AI 内容存在风险

### 7.5 社区规范

系统需要把 TikTok Community Guidelines 作为内容生成约束。

例如规避：

- 过度血腥
- 色情内容
- 仇恨内容
- 违规暴力内容
- 版权风险内容

### 7.6 TikTok 最佳实践

系统需要沉淀 TikTok 内容策略，例如：

- 前几秒建立强 Hook
- 每集结尾设置 Cliffhanger
- 系列化内容提高追更
- 标题与封面服务点击率
- 评论区反馈影响下一集设计

---

## 8. Knowledge Layer 知识层

Knowledge Layer 负责回答：

> 系统拥有哪些内容资产？

它包括多个资产库。

这些库像一个个图书馆，每个库都有自己的资产、标签、元数据和版本。

### 8.1 剧情结构库

存储可复用剧情结构。

例如：

- 复仇
- 黑化
- 救赎
- 身份反转
- 契约恋爱
- 敌人变恋人
- 背叛后回归
- 隐藏身份
- 真假关系

### 8.2 人物库

存储角色资产。

包括：

- 人物身份
- 外貌设定
- 性格
- 背景
- 价值观
- 人物关系
- 成长轨迹
- 角色功能

人物不是简单图片，而是角色系统。

### 8.3 声音库

存储声音资产。

包括：

- 音色
- 语速
- 情绪范围
- 停顿习惯
- 说话风格
- 角色声音一致性规则

声音库应服务于角色系统，而不是单独堆积音色。

### 8.4 动作语义库

动作库不是存动作视频，而是存动作语义。

例如：

- 背叛
- 告白
- 犹豫
- 拔刀
- 回避眼神
- 后退一步
- 情绪崩溃
- 慢慢转身
- 雨夜拥抱
- 战斗闪避

动作是叙事动作，不只是物理动作。

### 8.5 镜头语言库

存储镜头表达方式。

例如：

- Close-up
- Slow Zoom
- POV
- Over Shoulder
- Tracking Shot
- Low Angle
- Wide Shot

镜头库用于控制观看体验和情绪表达。

### 8.6 世界观库

存储世界设定。

例如：

- 现代都市
- 魔法学院
- 中世纪王国
- 黑帮世界
- 狼人部落
- 吸血鬼贵族
- 赛博朋克城市

### 8.7 场景库

存储具体场景。

例如：

- 月夜森林
- 雨夜街道
- 宫殿大厅
- 医院走廊
- 学校天台
- 黑帮仓库

### 8.8 风格库

存储视觉风格。

例如：

- Anime
- Semi Realistic
- Dark Cinematic
- Comic Style
- Gothic Fantasy
- Modern Romance

### 8.9 Platform Knowledge Library

存储平台知识。

V1 主要存 TikTok 相关知识：

- TikTok Creator Rewards
- TikTok AI Policy
- TikTok Community Guidelines
- TikTok Recommendation Strategy
- TikTok Best Practices
- TikTok Publishing Strategy

---

## 9. Ontology 标签体系

系统必须建立统一 Ontology。

禁止无限制自由标签。

标签用于：

- 数据分析输出
- 资产库检索
- 内容匹配
- 知识图谱关联
- Creative Brief 生成
- Orchestrator 融合判断

一级标签建议包括：

- Genre
- Theme
- Emotion
- Relationship
- Conflict
- Character Archetype
- World
- Action
- Camera
- Voice
- Scene
- Style
- Audience
- Culture Cluster
- Monetization
- Platform
- Pace
- Hook
- Twist
- Cliffhanger
- Risk
- Policy
- Cost Quality

标签之间可以存在关系。

例如：

```text
Werewolf
→ Dark Romance
→ Identity Reveal
→ Moonlight Forest
→ Low Male Voice
→ Slow Walk
→ Blue Cold Tone
```

这部分后续会在 `03_Ontology.md` 中单独设计。

---

## 10. Content Spec 核心对象

Content Spec 是整个系统最重要的中间表示。

它不是 Prompt，也不是普通剧本。

它是一份标准化创作规范。

Content Spec 包括：

- Platform Goal
- Audience Goal
- Commercial Goal
- Creative Goal
- Genre
- Theme
- Emotion
- Story Direction
- Character Direction
- Visual Direction
- Voice Direction
- Tags
- Creative Brief
- Constraints
- Cost Quality Placeholder

所有模块都读取 Content Spec。

所有模块也可以更新 Content Spec。

---

## 11. Creative Brief 输入与解析机制

Data Intelligence 负责提供推荐信号，用户负责确认创作意图，`PlatformProfile` 负责提供硬约束。它们应通过确定性的 Creative Brief Resolution 映射到最终 `ContentSpec`。

当前文档级流程为：

Recommended Tags
→ User Selection / Addition / Exclusion
→ User Creative Prompt
→ Platform and Safety Constraints
→ Creative Brief Resolution
→ Final `ContentSpec`

Creative Brief Resolution 当前不作为新 Engine 实现，也不改变 Script Engine 主链路。未来最小实现可作为上游 mapper / resolver 存在。

### 11.0 CreativeBriefInput 最小契约

建议的 authoring input 至少包含：

- `schema_version`
- `recommendation_context`
- `recommendation_policy`
- `recommended_tags`
- `selected_tag_ids`
- `added_tag_ids`
- `excluded_tag_ids`
- `excluded_patterns`
- `user_creative_prompt`
- `generation_constraints`
- `request_metadata`

约束：

- `recommendation_policy` 默认建议为 `suggest_only`
- `recommended_tags` 只是建议，不自动进入最终 `ContentSpec`
- `selected_tag_ids` 与 `added_tag_ids` 都必须解析到现有 `OntologyNode`
- 用户输入的未知标签不得自动创建自由节点；应进入 unresolved 状态等待确认
- `excluded_patterns` 用于表达不能由单个 Ontology 节点完整表示的负向约束
- `user_creative_prompt` 不直接作为最终 Master Prompt，而应先映射为结构化创作目标
- `generation_constraints.platform_profile_id` 必须引用现有 `PlatformProfile`

### 11.0.1 确定性优先级

解析优先级固定为：

1. Platform / Safety Hard Constraints
2. User Excluded Tags / Patterns
3. Explicit User Prompt Constraints
4. User Selected / Added Tags
5. Data Intelligence Recommended Tags
6. Traceable System Defaults

其中第 5 级只在请求显式允许 recommendation fallback 时生效；默认 `suggest_only` 模式下，未被用户选择的推荐标签不会进入 resolved tags。

冲突处理规则：

- 硬约束与用户输入冲突时，阻止解析并返回明确原因
- 同一标签同时被选择和排除时，排除优先，并产生 conflict warning
- 用户 Prompt 与排除项发生重大语义冲突时，标记 `requires_user_resolution`，禁止静默猜测
- 结构化 `generation_constraints` 与自由 Prompt 对同一字段表述不一致时，以结构化字段为准并产生 warning
- 用户明确选择与推荐标签冲突时，以用户选择为准，并记录被舍弃建议及原因
- 未知 added tag 不得进入最终 `ContentSpec.tags`
- 默认值只能来自集中、版本化配置，并进入 mapping trace

### 11.0.2 标签数量边界

- Creative Brief Resolution v1 建议默认最多激活 12 个标签
- 现有 `ContentSpec.tags` 的技术上限仍为 20，不在本轮修改
- 每个核心创作维度建议只保留 1 至 2 个高意图标签，避免相互冲突和 Prompt 稀释
- 超出上限时不得只按置信度静默截断；应优先保留用户明确选择，并返回被延后标签列表

### 11.0.3 解析输出与追踪

未来 Resolution Result 至少应保留：

- 推荐、选择、新增和排除标签
- 原始用户 Prompt
- 完整 `CreativeBriefInput` snapshot 或稳定引用
- 最终 resolved tags
- 映射后的 `CreativeBrief` 字段
- 生成约束映射
- 未解析标签
- 冲突 warning 与用户确认状态
- 最终 `ContentSpec` 或 `ContentSpecDraft` 引用

这些记录用于后续分析哪些创作选择影响了生成结果，但本轮不实现持久化。

Creative Brief 用于指导生成，当前运行时仍使用 `ContentSpec.creative_brief`。

包括：

### 11.1 Story Brief

定义故事方向。

例如：

- 面向美国女性用户
- Dark Romance
- 强背叛感
- 快节奏
- 每集结尾强悬念

### 11.2 Character Brief

定义人物方向。

例如：

- 男主冷酷但有情感缺陷
- 女主独立而非被动
- 两人关系从对抗走向复杂依赖

### 11.3 Dialogue Brief

定义对白风格。

例如：

- 避免中式翻译腔
- 避免过长独白
- 增加潜台词
- 使用自然英文表达

### 11.4 Visual Brief

定义画面风格。

例如：

- 电影感构图
- 暗色调
- 雨夜
- 冷光
- 强情绪特写

### 11.5 Voice Brief

定义声音表现。

例如：

- 男主低沉克制
- 女主坚定但情绪层次丰富
- 高潮部分增加停顿与呼吸感

### 11.6 Negative Brief

定义不要生成什么。

例如：

- 避免中式霸总套路
- 避免工具人角色
- 避免剧情推进过慢
- 避免文化错配
- 避免不符合 TikTok 政策的内容

---

## 12. Production Layer 生产层

Production Layer 负责回答：

> 如何把内容生产出来？

### 12.1 Asset Retrieval

系统根据 Content Spec 和 Tags，并行检索多个资产库。

例如：

- 剧情结构库
- 人物库
- 声音库
- 动作语义库
- 镜头语言库
- 世界观库
- 场景库
- 风格库

这些库像多个图书馆。

当系统需要一个题材时，会并行从各个库中调取相关资产。

### 12.2 Orchestrator 融合引擎

Orchestrator 负责把并行检索到的资产融合成一致的内容方案。

它需要检查：

- 人物是否一致
- 声音是否符合角色
- 动作是否符合人物
- 镜头是否服务剧情
- 视觉风格是否统一
- 平台规则是否满足
- TikTok 收益规则是否考虑
- 商业目标是否一致

### 12.3 Script Engine

Script Engine 负责生成结构化剧本。

剧本包含：

- Episode
- Scene
- Scene Purpose / Beat Summary
- Dialogue / Dialogue Intent
- Emotional Shift / Emotional Objective
- Character Action
- Turning Point
- Hook / Cliffhanger

剧本是动画生成控制层。

Final `MasterScript` 负责描述“发生什么”以及“为什么发生”。Camera、Voice、Visual Prompt、Audio Prompt、Lighting、Negative Prompt 和模型专用语法不属于当前核心剧本字段，应由未来 Script-to-Production Adapter 根据稳定故事语义派生。

后续如果需要微调动画，应优先修改剧本，再重新生成局部内容。

### 12.4 Animation Pipeline

未来应先通过 Script-to-Production Adapter 将结构化剧本转换为模型无关 Production Package，再通过视频模型 Adapter 生成供应商专用请求。

V1 视频模型计划使用：

- Seedance 2.0
- Seedance 2.5（如可用）

系统应通过 Video Model Adapter 接入视频模型，避免绑定某个具体模型版本。

当前只记录该兼容边界，不实现 Production Package、Seedance Prompt、视频调用或生产工作流。

### 12.5 Audio Pipeline

调用声音库与语音模型，生成：

- 角色配音
- 情绪化语音
- BGM
- 环境音

### 12.6 Video Composer

负责合成最终视频。

包括：

- 视频片段
- 配音
- 字幕
- BGM
- 转场
- 封面

输出 TikTok 视频。

---

## 13. Cost-Quality Optimization Module 成本与质量平衡模块

本模块当前仅保留位置。

未来调研市场与生成成本后再详细设计。

该模块未来负责：

- 平衡生成成本与视频质量
- 判断哪些内容值得高成本生成
- 判断哪些内容只做低成本测试
- 判断是否使用 Seedance 2.0 或 2.5
- 控制重生成次数
- 控制热点线与长线 IP 线的预算差异
- 结合收益预期进行生成策略选择

初步位置：

```text
Content Spec
↓
Cost-Quality Optimization Module
↓
Asset Retrieval / Script Engine / Animation Pipeline
```

---

## 14. Learning Layer 学习层

Learning Layer 负责让系统越来越聪明。

发布内容后，系统收集反馈。

### 14.1 用户反馈

包括：

- 评论
- 点赞
- 收藏
- 分享
- 追更请求
- 用户情绪
- 用户对角色的反应

### 14.2 行为反馈

包括：

- 完播率
- 留存
- 二刷率
- 跳出点
- 平均观看时长

### 14.3 商业反馈

包括：

- 收益表现
- 付费转化
- 广告价值
- IP 延展表现

### 14.4 平台反馈

包括：

- 推荐表现
- 是否触发平台限制
- 是否符合收益资格
- TikTok 规则是否变化

### 14.5 知识更新

反馈会更新：

- Content Spec
- Tag 权重
- Knowledge Base
- Platform Profile
- Commercial Intelligence
- Audience Intelligence

---

## 15. 两条内容生产线

系统支持两条内容线。

### 15.1 长线 IP 内容线

目标：

- 稳定追更
- 角色沉淀
- 世界观沉淀
- 粉丝积累
- 长期商业价值

特点：

- 人工干预更多
- 质量更高
- 剧情更完整
- 角色一致性要求更高

### 15.2 热点爆款内容线

目标：

- 快速测试热点
- 获取流量
- 验证题材
- 发现新机会

特点：

- 生产速度快
- 成本更敏感
- 可结合 Trend Intelligence
- 可用于测试潜力题材

---

## 16. 推荐技术栈

MVP 阶段建议：

```text
n8n：工作流编排
Python / FastAPI：核心业务服务
PostgreSQL：结构化数据存储
pgvector / Qdrant：向量检索
Object Storage：图片、视频、音频素材存储
Seedance Adapter：视频生成接口
```

后续复杂后可扩展：

```text
FastAPI + Celery/RQ + Redis + PostgreSQL
```

Codex 用作开发助手。

开发策略：

- 一个模块一个模块写
- 每个模块输入输出清晰
- 先写数据结构，再写生成逻辑
- 不让 Codex 一次性写完整系统

---

## 17. MVP 优先级

第一阶段应优先完成：

1. 项目骨架
2. Data Model
3. Ontology
4. Tag System
5. Content Spec
6. TikTok Platform Profile
7. Knowledge Base 基础结构
8. Asset CRUD
9. Asset Retrieval
10. Creative Brief Generator
11. Script Engine 初版

第二阶段：

1. 动作语义库
2. 声音库
3. 镜头语言库
4. Orchestrator
5. Seedance Adapter
6. 视频生成任务队列

第三阶段：

1. 反馈学习模块
2. 成本质量模块
3. A/B Testing
4. 更完整的商业分析
5. 平台扩展能力

---

## 18. 文档体系规划

建议项目 docs 目录如下：

```text
docs/
├── 01_System_Design.md
├── 02_Data_Model.md
├── 03_Ontology.md
├── 04_Database_Design.md
├── 05_API_Design.md
├── 06_Project_Structure.md
├── 08_TikTok_Profile.md
├── 09_ContentSpec.md
├── 10_Tag_System.md
├── 11_KnowledgeBase.md
├── 12_Retrieval_Engine.md
├── 13_Orchestrator.md
├── 14_Script_Engine.md
├── 15_Learning_Engine.md
├── 16_Cost_Quality_Module.md
└── 17_MVP_Roadmap.md
```

---

## 19. 总结

AI Comic Content OS 的核心不是视频生成，而是内容操作系统。

系统真正的长期价值来自：

- 数据分析能力
- TikTok 平台理解能力
- 商业分析能力
- 标签体系
- 知识图谱
- 内容资产库
- Content Spec
- 结构化剧本控制能力
- 反馈学习能力

AI 模型只是执行器。

Content OS 才是核心资产。
