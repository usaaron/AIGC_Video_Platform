# 21 Current Status Checklist

## 目标

本清单用于在当前 MVP 阶段进行一次正式人工复查。

当前项目目标不是继续扩展新模块，而是确认：

- 当前 `Content Planning Engine` 是否已经按设计跑通
- 当前主链路是否仍然以 `ContentSpec` 为中心
- 当前哪些能力已经落地
- 当前哪些能力仍然只是 placeholder
- 下一阶段应优化什么，而不是继续盲目加骨架

---

## 一、当前主链路

当前已实现并可测试的主链路为：

`Raw Data`
→ `RawContentRecord`
→ `AnalysisResult`
→ `ContentSpecDraft`
→ `ContentSpec`
→ Asset Retrieval
→ Orchestrator
→ Prompt Retrieval
→ Prompt Builder
→ `LLMAdapter`
→ Draft `MasterScript`
→ `Story QC`
→ `RevisionPlan`
→ `Script Revision`
→ Re-QC
→ Final `MasterScript`

当前该链路已具备：

- API
- Pydantic 数据模型
- 基础错误处理
- 单元测试
- Benchmark 测试
- E2E smoke test

---

## 二、当前已落地能力

### 1. Data Intelligence

当前已落地：

- `ManualJSONImportAdapter`
- `ManualCSVImportAdapter`
- `RawContentRecord -> AnalysisResult -> ContentSpecDraft -> ContentSpec`
- 基础 Cleaning
- 基础 Feature Extraction
- Rule-based Tag Mapping
- Preference Score
- Analysis explainability

当前已支持输出：

- `keyword_evidence`
- `preference_score_breakdown`
- `commercial_signal_summary`
- `recommended_hook_type`
- `recommended_cliffhanger_type`

### 2. Platform Layer

当前已落地：

- `PlatformProfile`
- TikTok 规则通过 Profile 注入
- 核心业务逻辑未硬编码 TikTok 细节

### 3. Ontology / Tag System

当前已落地：

- `OntologyNode`
- `TagRef`
- 受控标签校验
- ContentSpec / Asset 标签一致性校验

### 4. Knowledge Base

当前已落地：

- 统一 `Asset`
- `asset_type` 区分人物、场景等资产
- `Prompt Library`
- `GenerationStrategy`

### 5. Retrieval / Orchestrator

当前已落地：

- `OrchestrationPlan`
- 规则化 `Asset Retrieval`
- `Prompt Retrieval`

### 6. Script Engine

当前已落地：

- `Prompt Builder`
- `MockLLMAdapter`
- Draft `MasterScript` 生成
- `PlaceholderStoryQC`
- `RevisionPlan`
- `ScriptRevisionService`
- Re-QC
- Final `MasterScript` 映射

### 7. Capability Validation

当前已落地：

- 固定 Benchmark 数据集
- `Benchmark Runner`
- `Benchmark API`
- `score_summary`
- `revision_summary`
- `highlights`
- E2E smoke test

---

## 三、当前仍是 Placeholder 的部分

以下内容当前仍然是占位实现，这是符合当前 MVP 范围的：

### 1. LLM 能力

- `MockLLMAdapter`
- 未绑定真实模型提供商
- 未做真实结构化生成优化

### 2. Story QC

- 当前是轻量规则 + Rubric placeholder
- 不是完整剧本审校系统

### 3. Script Revision

- 当前是规则化修订
- 不是基于真实 LLM 的智能改稿

### 4. Finalization

- Final `MasterScript` 当前通过确定性映射生成
- 当前 dialogue 仍属于 placeholder 级补全

### 5. Scheduled Ingestion 扩展数据源

以下 adapter 当前只保留扩展位置：

- `TikTokScraperAdapter`
- `ApifyAdapter`
- `RedditAdapter`
- `YouTubeAdapter`
- `WebtoonAdapter`

### 6. Phase 2 能力

当前仍明确不实现：

- Storyboard
- Video Generation
- Seedance
- Voice
- Subtitle
- Composition
- Publish System

---

## 四、当前建议验收点

人工复查时，建议逐项确认：

### A. 架构一致性

- 是否仍然以 `ContentSpec` 作为标准核心对象
- 是否存在绕过 `ContentSpec` 的隐式数据流
- TikTok 逻辑是否仍然封装在 `PlatformProfile`
- Prompt 是否仍然来自 `Prompt Library / Prompt Builder`

### B. 数据一致性

- `AnalysisResult` 是否可解释
- `ContentSpecDraft -> ContentSpec` 是否清晰
- 标签是否仍然受 `OntologyNode` 控制
- 资产是否仍然统一走 `Asset`

### C. 剧本链路一致性

- 是否一定先有 Draft `MasterScript`
- 是否一定先做 `Story QC`
- 是否一定先生成 `RevisionPlan`
- 是否一定先执行 Re-QC 再进入 Final `MasterScript`

### D. 能力验证一致性

- 固定 Benchmark 是否稳定通过
- E2E smoke test 是否稳定通过
- Revision 后分数是否不低于 Draft
- Final 分数是否不低于 Revised Draft

---

## 五、当前可直接运行的验证命令

### 1. 全量测试

```bash
pytest
```

### 2. Benchmark API

```bash
uvicorn app.main:app --app-dir backend --reload
curl -X POST http://127.0.0.1:8000/benchmarks/run \
  -H "Content-Type: application/json" \
  -d '{"dataset_id":"us_female_dark_romance","dataset_type":"benchmark"}'
```

### 3. E2E Smoke Test

```bash
pytest tests/test_e2e_content_planning_pipeline.py
```

---

## 六、当前建议先不要做的事

在我们完成正式人工复查前，建议先不要继续做：

- 新平台接入
- 新视频模块
- 真实视频生成
- 多 Agent
- 大规模爬虫
- 前端
- 复杂数据库迁移

原因：

- 当前第一优先级仍然是验证内容规划与剧本生成链路是否可靠
- 当前最大价值在于确认结构正确，而不是继续扩张功能面

---

## 七、下一阶段建议方向

如果本轮人工复查通过，下一阶段建议优先顺序为：

1. 优化 `Story QC` 与 `Script Revision` 的质量判断能力
2. 小范围验证 `RealLLMAdapter`
3. 强化 Prompt / Script Evaluation
4. 之后再决定是否进入更真实的数据采集与更强生成能力

当前结论：

- 基础框架已完成
- 能力验证主链路已完成
- 当前适合进入一次正式人工验收，而不是继续堆新模块
