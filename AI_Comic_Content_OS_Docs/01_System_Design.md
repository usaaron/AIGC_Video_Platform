# AI Comic Content OS
## 01_System_Design.md
### System Design Specification V1.0

---

## 1. 项目概述

### 1.0 当前 MVP 聚焦

当前 MVP 的唯一目标不是视频生产，而是稳定产出高质量 `MasterScript`。

当前主链路统一为：

Data Intelligence
→ `ContentSpec`
→ Knowledge Base
→ Asset Retrieval
→ Orchestrator
→ Prompt Retrieval
→ Prompt Builder
→ `LLMAdapter`
→ Draft `MasterScript`
→ Story QC
→ `RevisionPlan`
→ `Script Revision`
→ Re-QC
→ Final `MasterScript`

当前 Data Intelligence 还增加了 `Scheduled Ingestion` 分支：

`Scheduled Ingestion` → `DataSourceAdapter` → `RawContentRecord` → 标准分析流程

当前最小实现中，`Asset Retrieval` 的直接输入暂由 `OrchestrationPlan.asset_requests` 承载，用于保证资产检索请求结构化、可控、可测试。

当前 Script Engine 的内部推荐流程为：

`ContentSpec`
→ `CreativeBrief`
→ Asset Retrieval
→ Prompt Retrieval
→ Prompt Builder
→ `LLMAdapter`
→ Draft `MasterScript`
→ Story QC
→ `RevisionPlan`
→ `Script Revision`
→ Re-QC
→ Final `MasterScript`

当前最小联调能力补充：

- 已提供 `Script Generation Draft Integration Service`
- 当前可把 `ContentSpec + GenerationStrategy` 贯通到：
  - `Orchestrator`
  - `Retrieval`
  - `Prompt Builder`
  - `MockLLMAdapter`
  - `Story QC`
  - `RevisionPlan`
  - `Script Revision`

当前该能力仍停留在 `Draft` 级别，不代表已完成自动生成 Final `MasterScript`。

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

因此，本项目不只是一个 AI 漫剧生成工具，而是一套面向海外市场、以 TikTok 为 V1 目标平台的数据驱动内容生产操作系统。

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

## 3. V1 平台定位

### 3.1 当前目标平台

V1 阶段仅围绕 TikTok 构建。

所有内容策略、平台规则、收益规则、内容优化、推荐机制分析，均优先围绕 TikTok。

### 3.2 架构原则

虽然 V1 只做 TikTok，但系统架构不绑定 TikTok。

系统采用：

> Platform First, Platform Agnostic Architecture

即：

- 业务实现先聚焦 TikTok
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

数据分析模块不只输出标签，也输出 Creative Brief。

- Tag 用于匹配资产库
- Creative Brief 用于约束生成逻辑

标签回答：

> 调用什么资产？

Creative Brief 回答：

> 如何生成内容？

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

## 11. Creative Brief 生成机制

数据分析模块除了输出标签，还应输出 Creative Brief。

Creative Brief 用于指导生成。

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
- Beat
- Dialogue
- Emotion
- Action
- Camera
- Voice
- Visual Prompt
- Audio Prompt

剧本是动画生成控制层。

后续如果需要微调动画，应优先修改剧本，再重新生成局部内容。

### 12.4 Animation Pipeline

根据结构化剧本调用视频模型。

V1 视频模型计划使用：

- Seedance 2.0
- Seedance 2.5（如可用）

系统应通过 Video Model Adapter 接入视频模型，避免绑定某个具体模型版本。

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
├── 07_Development_Guide.md
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
