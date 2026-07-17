# 06_Project_Structure

## 建议目录

backend/
frontend/
docs/
modules/
services/
adapters/
tests/
datasets/
evaluation/
scripts/

## 当前实现目录

```text
backend/
  app/
    api/routes/
    modules/asset/
    modules/content_spec/
    modules/data_intelligence/
    modules/master_script/
    modules/ontology_node/
    modules/orchestrator/
    modules/platform_profile/
    modules/retrieval/
    modules/scheduled_ingestion/
    modules/script_engine/
    modules/trend_snapshot/
tests/
tests/benchmark/
datasets/
  mock/
  benchmark/
evaluation/
examples/
AI_Comic_Content_OS_Docs/
AI_Comic_Content_OS_Docs/Research/
```

## 当前目录职责

- `backend/app/main.py`
  - FastAPI 应用入口
- `backend/app/api/routes/`
  - API 路由层
- `backend/app/modules/content_spec/`
  - `ContentSpec` 模块的数据模型、服务、仓储
- `backend/app/modules/asset/`
  - `Knowledge Base` 当前最小统一 `Asset` 模块
- `backend/app/modules/data_intelligence/`
  - Data Intelligence 模块的数据模型、导入适配器、分析服务
- `backend/app/modules/master_script/`
  - `MasterScript` 模块的数据模型、服务、仓储与 Draft-to-Final 映射
- `backend/app/modules/ontology_node/`
  - `OntologyNode` 模块的数据模型、服务、仓储
- `backend/app/modules/orchestrator/`
  - `Orchestrator` 模块的数据模型、服务、仓储
- `backend/app/modules/platform_profile/`
  - `PlatformProfile` 模块的数据模型、服务、仓储
- `backend/app/modules/retrieval/`
  - `Asset Retrieval` 模块的数据模型、规则检索服务与 API
- `backend/app/modules/scheduled_ingestion/`
  - Scheduled Data Ingestion 的 Job、去重、运行服务与 API
- `backend/app/modules/script_engine/`
  - Script Generation Strategy 占位模块，包含 `Prompt Library`、`Prompt Retrieval`、`GenerationStrategy`、`PromptBuilder`、`LLMAdapter`、`StoryQC` 的基础接口与数据模型
- `backend/app/modules/trend_snapshot/`
  - Trend Intelligence 当前最小 `TrendSnapshot` 聚合模块
- `tests/`
  - 单元测试与 API 测试
- `tests/benchmark/`
  - 固定 Benchmark 回归测试
- `datasets/`
  - Mock 数据与固定 Benchmark 数据
- `evaluation/`
  - Benchmark、Rubric 与能力验证评估逻辑
- `examples/`
  - 示例输入数据
- `AI_Comic_Content_OS_Docs/Research/`
  - 行业研究、平台研究、算法研究与数据智能设计文档

## 结构约束

- 平台规则未来放入 `modules/platform_profile/` 或 `adapters/platforms/`
- 视频模型适配器未来放入 `adapters/video_generation/`
- 不允许把 TikTok 规则直接写入 `content_spec` 核心模块
- Research 先影响 Architecture，再影响代码
