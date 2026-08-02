# 10 Tag System

## Positioning

Tag 是创作输入、内容分析、资产/知识检索和能力评估之间的稳定语义入口，不只是 UI 筛选项，也不直接等于知识库。

当前统一关系：

```text
OntologyNode：稳定概念身份
TagRef：ContentSpec / Asset 对概念的受控引用
Tag Evidence / Knowledge Profile：未来标签背后的来源与创作上下文
Trend Signal：未来标签在特定市场与时间窗下的动态热度
```

系统不创建第二套中国大陆 Tag 模型。`SCRIPT_MARKET_PROFILE=cn_mainland` 加载大陆目录；`overseas_tiktok` 资源保留但默认关闭。

## Current Implementation

- 当前大陆 bootstrap 提供 68 个受控 Ontology 节点，覆盖题材、剧情元素、关系/冲突、情绪、受众和部分叙事信号。
- Frontend 支持分类选择、移除、最多 12 个 active tags，以及独立“我的标签”。
- 当前“灵感推荐”是静态策划建议，不是实时热榜；只有用户主动选择后才生效。
- 旧 `element.*` 前端 ID 会迁移到正式 `theme.* / relationship.*` ID。
- 系统标签进入 `ContentSpec.tags`；“我的标签”当前仅作为项目创作关键词进入 generation notes。
- 当前标签关联的 bootstrap Asset 是通用占位参考，不是从热门作品提取的真实内容库。

## Governance Rules

- `TagRef.ontology_node_id` 必须引用 active `OntologyNode`。
- `TagRef.label` 和 `TagRef.category` 必须与节点一致。
- `Asset.tags` 与 `ContentSpec.tags` 统一复用 `TagRef`。
- 不允许仅凭自由文本自动创建公共 Ontology 节点。
- 标签来源、市场、版本、时间窗和 confidence 必须可追踪。
- 不复制未授权作品的完整文本；标签知识只沉淀可泛化模式、来源引用和受治理摘要。
- 未经用户接受的推荐标签不得进入生成要求。

## Target Input Rule

目标产品规则：

- Creative Prompt 与有效标签至少提供一项，二者不能同时为空。
- Character 输入 optional。
- Prompt-only、受控 Tag-only 和 confirmed CustomTagContext-only 都应可进入 Creative Intent Resolution。
- 当前 runtime 已支持 Prompt-only 与受控 Ontology Tag-only：Tag-only 的 Story Goal 由后端透明派生并记录 provenance，不由 Frontend 伪装成用户 Prompt。confirmed CustomTagContext-only 仍待实现。

## Tag-Backed Context Target

```text
Existing Content / AnalysisResult / Governed Sources
→ Tag Evidence Library
→ Versioned Tag Knowledge Profile
→ Bounded Tag Context Bundle
→ Reviewable Story Synopsis / Story Direction
→ Story Bible Root
```

常规标签的目标不是携带某个固定剧情，而是提供受众期待、故事发动机、冲突机制、人物关系、情绪承诺、反模式和适用边界。

实时热门未来由 Data Intelligence 的 `TrendSnapshot / Trend Signal` 接入；热度与增长率是时效数据，不写入稳定 Ontology 定义。

## Custom Tags

“我的标签”未来不直接升级为公共标签，而是先形成 project-scoped `CustomTagContext`：

- 保存用户原词和 optional 定义；
- 检查现有 tag / alias；
- AI inference 必须明确标记；
- 歧义必须由用户确认；
- 可以引用用户授权资料或已有相关 Knowledge；
- 只影响当前项目；
- 有足够来源、去重和治理审核后才可能提升为公共候选。

这既支持即时创作，也避免公共标签和知识库被一次性词条污染。

## Tag Combination

系统不为所有标签排列预建独立库。未来按 primary genre、core elements、relationship/conflict、emotional promise 和 audience role 分别检索，再合成 bounded bundle 并报告冲突。12 个是安全上限，不是推荐填满。

## Current Gaps

- Tag Evidence Library 与 Tag Knowledge Profile runtime
- 动态 Tag Context Retrieval
- Data Intelligence 实时热门接入
- project-scoped CustomTagContext 语义确认与 lineage
- confirmed CustomTagContext-only 输入契约升级
- Tag Context 到可审阅 Story Synopsis / Story Direction 的正式映射

详细 Ontology 约束见 `03_Ontology.md`，知识边界见 `11_KnowledgeBase.md`，完整未来设计见 `Research/14_Tag_Context_Library_v1_Architecture.md`。
