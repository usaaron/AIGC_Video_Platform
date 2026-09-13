import { creatorTagCanonicalId, creatorTagIdentity, deduplicateCreatorTags, findCreatorTagByLabel, matchingSelectedTagIds, resolveLegacyTagId, uniqueSelectedTagIds } from "@/lib/tag-catalog";
import { hongguoTagId, hongguoTagLabel } from "@/lib/platform-tag-id";
export { hongguoTagId, hongguoTagLabel } from "@/lib/platform-tag-id";
import { CURRENT_MARKET_PROFILE, type CreatorTag, type CustomTagDraft, type ProjectMarketProfile, type TagCategory } from "@/lib/types";
import type { components } from "@/lib/generated/api-schema";

export const HONGGUO_FORMATS = ["real", "comic", "ai"] as const;
export type HongguoTag = components["schemas"]["HongguoCategory"];
export type HongguoTrend = components["schemas"]["HongguoTagRecommendation"];
export type HongguoCategories = components["schemas"]["HongguoCategoriesData"];
export type HongguoTrends = components["schemas"]["HongguoTrendsData"];

export interface HongguoCombinedCatalog {
  categories: HongguoTag[];
  recommendations: HongguoTrend[];
  fetched_at: string | null;
  stale: boolean;
  sample_work_count: number;
}

export function combineHongguoCatalogs(feeds: Array<HongguoCategories | HongguoTrends>): HongguoCombinedCatalog | null {
  const usable = HONGGUO_FORMATS.map((format) => feeds.find((feed) => feed.format === format && feed.status !== "unavailable"))
    .filter((feed): feed is HongguoCategories | HongguoTrends => Boolean(feed));
  if (!usable.length) return null;
  const categories = new Map<string, HongguoTag>();
  const trends = new Map<string, HongguoTrend>();
  const keyFor = (tag: HongguoTag) => tag.tag_id ? resolveLegacyTagId(tag.tag_id) : `label:${tag.label}`;
  for (const feed of usable) {
    if ("categories" in feed) for (const tag of feed.categories ?? []) {
      if (!categories.has(keyFor(tag))) categories.set(keyFor(tag), tag);
    }
    if ("recommendations" in feed) for (const tag of feed.recommendations ?? []) {
      const key = keyFor(tag);
      const current = trends.get(key);
      const samples = [...(current?.sample_works ?? []), ...(tag.sample_works ?? [])].sort((a, b) => a.rank - b.rank);
      const worksByUrl = new Map<string, typeof samples[number]>();
      for (const work of samples) if (!worksByUrl.has(work.url)) worksByUrl.set(work.url, work);
      trends.set(key, {
        ...tag,
        label: current?.label ?? tag.label,
        raw_labels: [...new Set([...(current?.raw_labels ?? []), ...tag.raw_labels])],
        // These are appearances across independent lists, not globally unique works.
        ranked_work_count: (current?.ranked_work_count ?? 0) + tag.ranked_work_count,
        weighted_score: Number(((current?.weighted_score ?? 0) + tag.weighted_score).toFixed(6)),
        sample_works: [...worksByUrl.values()].slice(0, 3),
      });
    }
  }
  const recommendations = [...trends.values()]
    .sort((a, b) => b.weighted_score - a.weighted_score || b.ranked_work_count - a.ranked_work_count || a.label.localeCompare(b.label, "zh"))
    .map((tag, index) => ({ ...tag, rank: index + 1 }));
  const timestamps = usable.flatMap((feed) => feed.fetched_at ? [feed.fetched_at] : [])
    .sort((a, b) => Date.parse(a) - Date.parse(b));
  return {
    categories: [...categories.values()], recommendations,
    fetched_at: timestamps[0] ?? null,
    stale: usable.length < HONGGUO_FORMATS.length || usable.some((feed) => feed.stale || feed.status === "stale"),
    sample_work_count: usable.reduce((sum, feed) => sum + ("sample_work_count" in feed ? feed.sample_work_count ?? 0 : 0), 0),
  };
}

export function manualCreatorTags(custom: CustomTagDraft[], available: CreatorTag[], market: ProjectMarketProfile): CreatorTag[] {
  const catalogKeys = new Set(available.map((tag) => creatorTagIdentity(tag, market)));
  return deduplicateCreatorTags(custom.filter((tag) => !hongguoTagLabel(tag.id)).map((tag): CreatorTag => ({
    id: tag.id, label: tag.label, labelZh: tag.label, category: "My Tags", description: "", descriptionZh: "", custom: true,
  })).filter((tag) => !catalogKeys.has(creatorTagIdentity(tag, market))), market);
}

export function manualCustomTagCount(custom: CustomTagDraft[], available: CreatorTag[] = [], market: ProjectMarketProfile = CURRENT_MARKET_PROFILE): number {
  return manualCreatorTags(custom, available, market).length;
}

const SOURCE_GENRES = new Set(["传奇", "奇幻", "恐怖", "志怪", "青春", "灾难", "战争", "冒险", "犯罪", "都市日常", "年代爱情", "都市玄幻", "古装传奇", "奇幻爱情", "悬疑情感", "悬疑推理", "乡村爱情", "动作冒险", "民国爱情", "青春爱情"]);
const NON_CREATIVE_SOURCE_LABELS = new Set(["剧情", "综艺"]);

export function hongguoTagOption(
  tag: HongguoTag,
  available: CreatorTag[],
  custom: CustomTagDraft[],
  market: ProjectMarketProfile = CURRENT_MARKET_PROFILE,
): CreatorTag {
  const platformCustom = custom.find((item) => item.id === hongguoTagId(tag.label));
  const known = findCreatorTagByLabel(tag.label, market);
  const system = available.find((item) => creatorTagCanonicalId(item.id) === creatorTagCanonicalId(tag.tag_id ?? known?.id ?? ""))
    ?? available.find((item) => item.labelZh === tag.label);
  const key = creatorTagIdentity(system ?? { id: hongguoTagId(tag.label), labelZh: tag.label }, market);
  const existingCustom = platformCustom ?? custom.find((item) => creatorTagIdentity({ id: item.id, labelZh: item.label }, market) === key);
  const option: CreatorTag = system ?? { id: hongguoTagId(tag.label), label: tag.label, labelZh: tag.label,
    category: SOURCE_GENRES.has(tag.label) ? "Genre" : "Story Element", description: "", descriptionZh: "", custom: true };
  // Keep the persisted custom ID even if a later catalog introduces a canonical ID.
  return existingCustom ? { ...option, id: existingCustom.id, custom: true } : option;
}

export function buildCreatorCatalog(available: CreatorTag[], source: HongguoTag[], market: ProjectMarketProfile): CreatorTag[] {
  return deduplicateCreatorTags([...available, ...source.filter((tag) => !NON_CREATIVE_SOURCE_LABELS.has(tag.label))
    .map((tag) => hongguoTagOption(tag, available, [], market))], market);
}

export function hongguoTrendOptions(records: HongguoTrend[], available: CreatorTag[], custom: CustomTagDraft[]) {
  const seen = new Set<string>();
  return records.flatMap((record) => {
    if (NON_CREATIVE_SOURCE_LABELS.has(record.label)) return [];
    const tag = hongguoTagOption(record, available, custom);
    const key = creatorTagIdentity(tag);
    // Older cached feeds may still separate synonyms. Keep the highest-ranked record;
    // their truncated evidence cannot prove that summing counts would be accurate.
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ record: { ...record, rank: seen.size }, tag }];
  });
}

const MIXED_GENRES = new Set(["genre.dark_romance", "genre.modern_romance", "genre.costume_romance"]);
const MIXED_GENRE_LABELS = new Set(["都市日常", "年代爱情", "都市玄幻", "古装传奇", "奇幻爱情", "悬疑情感", "悬疑推理", "乡村爱情", "动作冒险", "民国爱情", "青春爱情"]);
const SETTING_LABELS = new Set(["豪门", "萌宝", "隐藏身份", "隐藏大佬", "总裁", "战神", "大男主", "现代", "古代", "古装", "年代", "民国", "乡村", "架空", "宫廷", "异界", "脑洞", "系统", "异能", "修仙", "穿越", "重生", "真假千金", "无限流", "时间循环", "读心术", "奇幻脑洞", "双穿越", "家族", "吸血鬼", "超自然能力"]);
const RELATIONSHIP_LABELS = new Set(["日久生情", "闪婚", "宫斗宅斗", "换嫁", "暗恋成真", "友情岁月", "亲情治愈", "矛盾和解"]);

export function groupCreatorTags(tags: CreatorTag[], category: TagCategory | "Trending"): Array<{ key: string; tags: CreatorTag[] }> {
  const groups = new Map<string, CreatorTag[]>();
  const order = category === "Genre" ? ["baseGenres", "mixedGenres"] : category === "Story Element" ? ["settings", "relationships", "plot"] : ["all"];
  for (const key of order) groups.set(key, []);
  for (const tag of tags) {
    const key = category === "Genre" ? (MIXED_GENRES.has(tag.id) || MIXED_GENRE_LABELS.has(tag.labelZh) ? "mixedGenres" : "baseGenres")
      : category === "Story Element" ? (tag.id.startsWith("world.") || SETTING_LABELS.has(tag.labelZh) ? "settings"
        : tag.id.startsWith("relationship.") || tag.id === "conflict.class_gap" || RELATIONSHIP_LABELS.has(tag.labelZh) ? "relationships" : "plot") : "all";
    groups.get(key)!.push(tag);
  }
  return [...groups].filter(([, items]) => items.length).map(([key, items]) => ({ key, tags: items }));
}

export function toggleCreatorTag(
  tag: CreatorTag,
  selected: string[],
  custom: CustomTagDraft[],
  market: ProjectMarketProfile = CURRENT_MARKET_PROFILE,
): { selectedTagIds: string[]; customTags: CustomTagDraft[]; limit?: "selected" | "custom" } {
  const matched = new Set(matchingSelectedTagIds(tag, selected, custom, market));
  if (matched.size) return { selectedTagIds: selected.filter((id) => !matched.has(id)), customTags: custom };
  if (uniqueSelectedTagIds(selected, custom, market).length >= 12) return { selectedTagIds: selected, customTags: custom, limit: "selected" };
  const needsCustom = tag.custom && !custom.some((item) => item.id === tag.id);
  if (needsCustom && !hongguoTagLabel(tag.id) && manualCustomTagCount(custom) >= 20) {
    return { selectedTagIds: selected, customTags: custom, limit: "custom" };
  }
  return { selectedTagIds: [...selected, tag.id], customTags: needsCustom
    ? [...custom, { id: tag.id, label: tag.labelZh, createdAt: new Date().toISOString() }] : custom };
}
