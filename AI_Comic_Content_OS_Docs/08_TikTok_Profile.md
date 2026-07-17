# 08_TikTok_Profile

V1唯一平台。

包括：
- Recommendation Rules
- Creator Rewards
- Community Guidelines
- AI Policy
- Best Practices
- Publishing Strategy

采用 Platform Adapter，可扩展其他平台。

## 当前实现约束

TikTok 平台知识不应直接硬编码进 `ContentSpec` 或其他核心内容模块。

当前应通过独立 `PlatformProfile` 对象表达，例如：

- `id = tiktok_v1`
- `platform_name = TikTok`
- `content_mode = short_video`

## 当前最小结构

`PlatformProfile` 当前最小上包含：

- Recommendation Rules
- Creator Rewards
- AI Policies
- Community Guidelines
- Best Practices
- Publishing Strategy

这些结构当前作为平台规则容器，用于承接平台知识，后续可再扩展为更细粒度的数据来源、版本策略与适配逻辑。
