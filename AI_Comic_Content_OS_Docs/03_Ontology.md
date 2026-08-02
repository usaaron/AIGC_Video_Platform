# 03_Ontology

## 目标
建立统一标签体系（Ontology）。

一级标签建议：
- Genre
- Theme
- Emotion
- Relationship
- Conflict
- Character
- World
- Action
- Camera
- Voice
- Scene
- Style
- Audience
- CultureCluster
- Platform
- Monetization
- Pace
- Hook
- Twist
- Cliffhanger

后续补充：
- 标签约束
- 标签关系
- 知识图谱

## 当前实现最小约束

系统当前已引入独立 `OntologyNode` 作为受控标签节点。

最小规则包括：

- `OntologyNode.id` 使用稳定标识，例如 `genre.romance`
- `OntologyNode.category` 必须属于一级标签分类
- `ContentSpec.tags` 必须引用已存在的 `OntologyNode`
- `TagRef.label` 与 `TagRef.category` 必须和被引用节点保持一致

## 当前 Benchmark 验证常用节点

当前固定 Benchmark 已使用或预留以下受控节点：

- `genre.romance`
- `genre.drama`
- `genre.supernatural`
- `emotion.revenge`
- `hook.fake_marriage`
- `theme.werewolf`
- `character.ceo`

## 中国大陆运行目录

当前仍使用同一套 `OntologyNode / TagRef` 标签体系，没有新建第二套大陆标签模型。`SCRIPT_MARKET_PROFILE` 决定启动时加载哪个受控目录：

- `cn_mainland`：当前默认，加载中文大陆长篇漫剧创作目录
- `overseas_tiktok`：保留原海外目录，但当前默认关闭

大陆目录当前覆盖：

- 题材类型：现代言情、古代言情、都市、玄幻、仙侠、武侠、悬疑、科幻、家庭伦理等
- 剧情元素：重生、穿越、系统、逆袭成长、隐藏身份、真假千金、豪门、商战、权谋、探案、无限流等
- 关系与冲突：契约关系、先婚后爱、破镜重圆、追妻火葬场、宿敌合作、家族冲突、阶层差异等
- 情绪体验：爽感、悬念、甜宠、虐心、治愈、热血、压迫感等
- 目标受众：女频、男频、青年、熟龄、言情、玄幻、悬疑与家庭题材受众
- 叙事信号：开局危机、目标先行、身份反转、新威胁、真相延迟和稳步升级

运行时只注册当前市场目录，避免大陆 `ContentSpec` 混入海外/TikTok 标签。旧前端 `element.*` ID 在加载项目时迁移到正式的 `theme.* / relationship.*` ID，历史海外资源本身不删除。

## 推荐与自定义边界

- 当前“灵感推荐”是有界的大陆题材策划建议，不是实时热榜，也不代表红果或其他平台的实时统计结论。
- 推荐标签只有被用户主动选择后，才进入 `ContentSpec` 和生成上下文。
- “我的标签”当前只是项目内用户创作关键词，可保存和注入创作说明；目标形态是先建立项目私有、带用户确认和 provenance 的 `CustomTagContext`，而不是立即污染公共 `OntologyNode`。
- 当前每次生成最多激活 12 个标签，避免大量互相冲突的指令稀释创作方向。
- 12 个是安全上限而非推荐填满；未来应区分主类型、核心元素、情绪承诺和受众角色，通过有界组合生成上下文，不能为每种标签排列预建一套库。
- 未来真实 Trending Tags 应由 Data Intelligence 提供来源、时间窗、置信度和证据；在该链路实现前不得把静态灵感建议伪装为市场热度。

## 标签与内容库的关系

长期目标不是孤立标签列表，而是：

```text
Ontology Tag
→ Tag Evidence Library
→ Versioned Tag Knowledge Profile
→ Bounded Tag Context Bundle
→ Story Synopsis / Story Direction
```

- `OntologyNode` 只保存稳定身份、分类和别名。
- `Tag Evidence Library` 保留标签从哪些已有内容、分析结果或受治理资料中提取而来。
- `Tag Knowledge Profile` 聚合受众期待、故事发动机、冲突机制、关系模式、情绪承诺、反模式和适用边界。
- 实时热度使用独立 `Trend Signal / TrendSnapshot`，不能覆盖标签身份或静态知识。
- 自定义标签先形成项目私有上下文；无来源时只能标记为用户定义或 AI inference，不能伪装成行业事实。

完整设计见 `Research/14_Tag_Context_Library_v1_Architecture.md`。

## 目标输入规则与当前差距

目标规则是：Creative Prompt 与标签至少提供一项，二者不能同时为空；Character 输入 optional。系统标签或已确认的项目私有自定义标签都可满足标签输入。

当前已实现 Prompt-only 与受控 Ontology Tag-only。Tag-only 输入由后端从已解析标签生成 `story_goal` 并记录 `story_goal_source=system_derived_from_tags`；Frontend 不再把合成文本标记为用户原文。confirmed CustomTagContext-only 尚未实现。
