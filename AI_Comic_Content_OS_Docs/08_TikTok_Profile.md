# 08_TikTok_Profile

## 当前状态

`overseas_tiktok` 当前为 `disabled`，不再是默认平台配置。

本文件作为已验证海外模块的保留说明继续存在。相关 Profile、Prompt、Knowledge Item、Benchmark 和切换入口不得删除；只有显式设置 `SCRIPT_MARKET_PROFILE=overseas_tiktok` 时，本地 runtime 才重新注册并选择该配置。

当前 active 配置是 `cn_mainland`。红果仅作为参考平台，不替代平台无关核心契约。

## 历史 V1 范围

原 V1 唯一平台为 TikTok。

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
