# 02 Data Intelligence Design

## 1. Data Intelligence 目标

Data Intelligence 的职责不是简单收集素材，而是将原始数据稳定转化为可控的内容规划输入。

当前目标包括：

- 识别高价值内容信号
- 生成受控标签
- 生成 `AnalysisResult`
- 生成 `ContentSpecDraft`
- 生成最终 `ContentSpec`
- 为后续 Knowledge Base、Asset Retrieval、Orchestrator、Prompt Builder、`MasterScript` 提供标准输入

## 2. 数据来源

长期可用数据来源包括：

- 平台内容样本
- 平台规则与政策
- 用户评论与反馈
- 创作者商业化样本
- 竞品内容样本
- 外部社区讨论
- 手工研究整理结果

## 3. MVP 数据来源

当前 MVP 采用：

- 手工 JSON 导入
- 手工 CSV 导入

对应接入方式：

- `ManualJSONImportAdapter`
- `ManualCSVImportAdapter`

选择原因：

- 先稳定数据模型与分析链路
- 降低抓取系统复杂度
- 便于快速验证 `RawContentRecord -> ContentSpec` 的标准流程

## 4. 未来扩展数据来源

未来可扩展为：

- `TikTokScraperAdapter`
- `ApifyAdapter`
- `RedditAdapter`
- `YouTubeAdapter`
- `WebtoonAdapter`

这些数据源当前只保留接口位置，不实现真实抓取。

## 4.1 Scheduled Data Ingestion

当前新增 `Scheduled Data Ingestion` 架构，用于按周期自动触发数据导入。

当前阶段目标不是实现复杂爬虫，而是先稳定：

- `DataIngestionJob`
- `DataIngestionRunHistory`
- `TrendSnapshot`
- `DataSourceAdapter` 绑定关系
- 调度周期字段
- 运行状态字段
- 去重规则
- 自动进入标准 Data Intelligence 流程

当前可运行的定时导入仅包括：

- `ManualJSONImportAdapter`
- `ManualCSVImportAdapter`

占位不实现的自动数据源包括：

- `TikTokScraperAdapter`
- `ApifyAdapter`
- `RedditAdapter`
- `YouTubeAdapter`
- `WebtoonAdapter`

## 5. 每类数据采集字段

当前 `RawContentRecord` 统一字段包括：

- `id`
- `source_name`
- `source_item_id`
- `platform`
- `source_url`
- `title`
- `body_text`
- `author_handle`
- `language`
- `region`
- `published_at`
- `engagement`
- `metadata`
- `imported_at`

当前 `engagement` 子结构包括：

- `view_count`
- `like_count`
- `comment_count`
- `share_count`
- `save_count`
- `completion_rate`

## 6. DataSourceAdapter 设计

所有数据源必须通过统一抽象接入：

`DataSourceAdapter`

当前规则：

- 统一输出 `list[RawContentRecordInput]`
- 采集实现不直接进入核心分析服务
- 数据源差异通过 Adapter 吸收

当前实现：

- `ManualJSONImportAdapter`
- `ManualCSVImportAdapter`
- `DataIngestionJob` 通过 `adapter_type` 绑定数据源适配器

预留占位：

- `TikTokScraperAdapter`
- `ApifyAdapter`
- `RedditAdapter`
- `YouTubeAdapter`
- `WebtoonAdapter`

## 7. Data Pipeline

当前统一流程：

Raw Data
→ `RawContentRecord`
→ Cleaning
→ Basic Feature Extraction
→ Rule-based Tag Mapping
→ Preference Score
→ `AnalysisResult`
→ `ContentSpecDraft`
→ `ContentSpec`

当前 Scheduled Ingestion 分支流程：

`Scheduled Ingestion`
→ `DataSourceAdapter`
→ `RawContentRecord`
→ Cleaning
→ Basic Feature Extraction
→ Rule-based Tag Mapping
→ Preference Score
→ `AnalysisResult`
→ `ContentSpecDraft`
→ `ContentSpec`

这个流程是当前项目必须遵守的最小标准链路。

## 8. Data Cleaning

当前 Cleaning 重点包括：

- 文本空白规范化
- 基础小写化处理
- 输入结构校验
- 基础字段完整性校验

当前不实现：

- 多语言复杂清洗
- OCR
- 去重聚类
- 噪声账号识别
- 登录态抓取
- 大规模自动采集编排

## 9. Feature Extraction

当前 MVP 仅实现基础特征抽取：

- `normalized_text`
- `token_count`
- `keyword_hits`
- `detected_signals`

目标是先形成可测试、可解释、可控的最小分析闭环。

## 10. Tag Mapping

当前标签生成方式为：

- Rule-based Tag Mapping

规则基于关键词和已有 Ontology 节点映射，当前要求：

- 只输出受控标签
- 不允许自由文本标签直接进入 `ContentSpec`
- Ontology 节点不存在时不得强行生成新标签

## 11. Preference Score

当前 `Preference Score` 是规则计算分值，用于近似表达内容偏好强度。

当前可参考信号包括：

- views
- likes
- comments
- shares
- completion rate

当前目标不是精确预测，而是形成稳定、透明、可迭代的评分基础。

## 12. Analysis Result

`AnalysisResult` 是原始内容经过分析后的标准对象。

当前应包含：

- 关联的 `raw_content_record_id`
- `extracted_features`
- `mapped_tags`
- `preference_score`
- `commercial_score`
- `platform_fit_score`
- `summary`

它的作用是：

- 保存单条内容分析结果
- 支撑后续聚合
- 为 `ContentSpecDraft` 提供依据

## 13. ContentSpec Draft

`ContentSpecDraft` 是 `ContentSpec` 之前的中间草稿对象。

当前作用包括：

- 汇总多个 `AnalysisResult`
- 形成标签候选
- 形成剧本方向说明
- 形成 `CreativeBrief`
- 形成目标时长、目标情绪、质量等级等内容规划决策

## 14. 输出 ContentSpec

最终输出必须是标准 `ContentSpec`。

原则：

- `ContentSpec` 仍然是唯一标准对象
- `ContentSpecDraft` 不是系统最终真相
- 后续模块应尽量消费 `ContentSpec` 而不是直接消费原始数据

## 15. 可借鉴算法

未来可借鉴但当前不实现的方向包括：

- BERTopic
- Embedding Clustering
- LLM Topic Labeling
- Emotion Analysis
- Semantic Retrieval

当前这些仅作为扩展接口方向，不进入 MVP 实装。

## 16. 当前不实现内容

当前明确不实现：

- 自动大规模爬虫
- 登录态抓取
- 黑盒推荐模型
- 违反平台规则的数据采集
- 多源实时同步
- 自动主题聚类
- 自动情绪识别模型
- 自动语义召回系统

## 16.1 当前 Scheduled Ingestion 说明

当前 `DataIngestionJob` 至少记录：

- `adapter_type`
- `schedule_type`
- `cron_expression`
- `last_run_at`
- `next_run_at`
- `run_status`
- `error_message`

当前 `DataIngestionRunHistory` 用于记录：

- 每次运行的开始时间与结束时间
- 运行结果状态
- 导入数量与去重数量
- 对应的 `RawContentRecord` / `AnalysisResult` / `ContentSpec`
- 错误信息与运行说明

当前 `TrendSnapshot` 用于聚合：

- 最近若干次 ingestion run history
- 成功 / 跳过 / 失败数量
- 导入量与去重量
- 受控标签出现频率
- 基础平均质量分信号

当前去重策略至少覆盖：

- `source_item_id`（外部内容 ID）
- `source_url`

当前 `custom_cron` 仅提供 MVP 级受限支持，主要用于稳定字段与接口，不视为完整调度引擎。

## 17. Phase 2 扩展方向

Phase 2 可继续扩展：

- 更多数据源 Adapter
- 更强的数据清洗与标准化
- 更复杂的标签映射与主题聚类
- 更强的 Platform Intelligence 分析能力
- 与 Knowledge Base 的深度联动
- 更强的 `ContentSpecDraft` 评估与排序

## 18. 与 Script Generation Strategy 的关系

Data Intelligence 的职责是提供结构化内容约束，而不是直接拼接模型专属 Prompt。

当前下游约束关系：

- `AnalysisResult` 提供内容信号解释
- `ContentSpecDraft` 提供生成方向草稿
- `ContentSpec` 作为唯一标准对象进入 Script Engine
- Prompt 选择应由 `Prompt Library` 与 `GenerationStrategy` 控制
- 最终 Prompt 应由 `Prompt Builder` 统一生成

当前明确不允许：

- Data Intelligence 直接输出某个模型专用的大 Prompt
- 在分析流程里散落模型厂商耦合逻辑
- 绕过 `ContentSpec` 直接把原始数据送入剧本生成

## 结论

当前 Data Intelligence 不是抽象占位模块，而是一个已经定义清晰输入、输出、对象与步骤的分析链路。

MVP 阶段应继续围绕这条链路打磨稳定性、可解释性与可测试性，而不是提前转向视频生成。
