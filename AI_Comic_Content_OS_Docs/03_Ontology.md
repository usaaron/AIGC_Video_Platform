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
