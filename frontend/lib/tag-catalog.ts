import type { CreatorTag, TagCategory } from "@/lib/types";

export interface OntologyTagSource {
  id: string;
  label: string;
  category: string;
  description: string;
  is_active: boolean;
}

export const TAG_CATEGORIES: Array<TagCategory | "Trending"> = [
  "Genre",
  "Story Element",
  "Emotion",
  "Audience",
  "My Tags",
  "Trending",
];

const CREATOR_FACING_ONTOLOGY_CATEGORIES = new Set([
  "Genre",
  "Theme",
  "Emotion",
  "Relationship",
  "Conflict",
  "Character",
  "World",
  "Action",
  "Style",
  "Audience",
  "CultureCluster",
  "Pace",
  "Hook",
  "Twist",
  "Cliffhanger",
]);

const LEGACY_TAG_ID_MAP: Record<string, string> = {
  "element.vampire": "theme.vampire",
  "element.revenge": "theme.revenge",
  "element.rebirth": "theme.rebirth",
  "element.hidden_identity": "theme.hidden_identity",
  "element.time_loop": "theme.time_loop",
  "element.forbidden_love": "relationship.forbidden_love",
  "element.contract": "relationship.contract",
  "element.supernatural_power": "theme.supernatural_power",
};

export const CREATOR_TAGS: CreatorTag[] = [
    { id: "genre.romance", label: "Romance", labelZh: "爱情", category: "Genre", description: "Relationship-led storytelling.", descriptionZh: "以人物关系发展为核心的故事。" },
    { id: "genre.dark_romance", label: "Dark Romance", labelZh: "暗黑爱情", category: "Genre", description: "Intimacy shaped by danger, power, and moral boundaries.", descriptionZh: "由危险、权力与道德边界塑造的亲密关系。" },
  { id: "genre.fantasy", label: "Fantasy", labelZh: "奇幻", category: "Genre", description: "Magic, myth, and altered worlds.", descriptionZh: "魔法、神话与异世界。" },
  { id: "genre.scifi", label: "Sci-Fi", labelZh: "科幻", category: "Genre", description: "Speculative technology and social consequence.", descriptionZh: "探索未来科技及其社会后果。" },
  { id: "genre.mystery", label: "Mystery", labelZh: "悬疑", category: "Genre", description: "Questions, clues, and concealed truth.", descriptionZh: "围绕疑问、线索与隐藏真相展开。" },
  { id: "genre.horror", label: "Horror", labelZh: "恐怖", category: "Genre", description: "Dread, danger, and the uncanny.", descriptionZh: "恐惧、危险与超常体验。" },
  { id: "genre.comedy", label: "Comedy", labelZh: "喜剧", category: "Genre", description: "Escalation built around comic consequence.", descriptionZh: "以喜剧后果推动冲突升级。" },
  { id: "genre.action", label: "Action", labelZh: "动作", category: "Genre", description: "Physical stakes and decisive momentum.", descriptionZh: "强调行动风险与果断推进。" },
  { id: "genre.historical", label: "Historical", labelZh: "历史", category: "Genre", description: "Stories anchored in an earlier period.", descriptionZh: "以特定历史时期为背景。" },
  { id: "genre.school", label: "School", labelZh: "校园", category: "Genre", description: "Coming-of-age conflict in school life.", descriptionZh: "发生在校园生活中的成长冲突。" },
  { id: "genre.apocalypse", label: "Apocalypse", labelZh: "末日", category: "Genre", description: "Survival under societal collapse.", descriptionZh: "社会崩溃背景下的生存故事。" },
  { id: "element.vampire", label: "Vampire", labelZh: "吸血鬼", category: "Story Element", description: "Immortality, hunger, and forbidden intimacy.", descriptionZh: "永生、欲望与禁忌亲密关系。", trending: true },
  { id: "element.revenge", label: "Revenge", labelZh: "复仇", category: "Story Element", description: "A pursuit of reckoning and consequence.", descriptionZh: "追求清算，并承担复仇后果。", trending: true },
  { id: "element.rebirth", label: "Rebirth", labelZh: "重生", category: "Story Element", description: "A second life with remembered stakes.", descriptionZh: "带着记忆重新开始第二次人生。" },
  { id: "element.hidden_identity", label: "Hidden Identity", labelZh: "隐藏身份", category: "Story Element", description: "A concealed self that changes trust.", descriptionZh: "被隐瞒的身份改变人物之间的信任。", trending: true },
  { id: "element.time_loop", label: "Time Loop", labelZh: "时间循环", category: "Story Element", description: "Repeated time with accumulating choices.", descriptionZh: "在重复时间中累积选择与代价。" },
  { id: "element.forbidden_love", label: "Forbidden Love", labelZh: "禁忌之恋", category: "Story Element", description: "Connection opposed by duty or danger.", descriptionZh: "受到责任或危险阻碍的感情。", trending: true },
  { id: "element.contract", label: "Contract", labelZh: "契约关系", category: "Story Element", description: "A binding agreement with emotional cost.", descriptionZh: "带有情感代价的约束性协议。" },
  { id: "element.supernatural_power", label: "Supernatural Power", labelZh: "超自然能力", category: "Story Element", description: "An extraordinary ability that creates consequence.", descriptionZh: "会带来明确后果的非凡能力。" },
  { id: "emotion.dark", label: "Dark", labelZh: "暗黑", category: "Emotion", description: "Dangerous, morally tense atmosphere.", descriptionZh: "危险且充满道德张力的氛围。" },
  { id: "emotion.sweet", label: "Sweet", labelZh: "甜蜜", category: "Emotion", description: "Warmth, affection, and gentle release.", descriptionZh: "温暖、亲密与柔和的情绪释放。" },
  { id: "emotion.tragic", label: "Tragic", labelZh: "悲剧", category: "Emotion", description: "Loss shaped by meaningful choice.", descriptionZh: "由重要选择造成的失去。" },
  { id: "emotion.suspense", label: "Suspense", labelZh: "紧张悬念", category: "Emotion", description: "Anticipation under incomplete information.", descriptionZh: "在信息不完整时形成持续期待。" },
  { id: "emotion.healing", label: "Healing", labelZh: "治愈", category: "Emotion", description: "Repair, safety, and earned connection.", descriptionZh: "修复创伤、获得安全与真实连接。" },
  { id: "emotion.passion", label: "Passion", labelZh: "炽烈", category: "Emotion", description: "High emotional and relational intensity.", descriptionZh: "高强度的情绪与关系张力。" },
  { id: "emotion.righteous_anger", label: "Righteous Anger", labelZh: "正义之怒", category: "Emotion", description: "Moral outrage driving visible action.", descriptionZh: "由道德愤怒推动明确行动。" },
  { id: "audience.romance", label: "Romance Audience", labelZh: "爱情题材受众", category: "Audience", description: "Viewers seeking relationship-driven drama.", descriptionZh: "偏好人物关系驱动剧情的观众。" },
  { id: "audience.fantasy", label: "Fantasy Audience", labelZh: "奇幻题材受众", category: "Audience", description: "Viewers seeking imaginative worlds.", descriptionZh: "偏好想象世界与超常设定的观众。" },
  { id: "audience.teen", label: "Teen Audience", labelZh: "青少年受众", category: "Audience", description: "Teen-focused themes and accessibility.", descriptionZh: "适合青少年理解与共鸣的主题。" },
  { id: "audience.young_adult", label: "Young Adult", labelZh: "青年受众", category: "Audience", description: "Identity, ambition, and first major choices.", descriptionZh: "关注身份、抱负与人生重要选择。" },
  { id: "audience.mystery", label: "Mystery Fans", labelZh: "悬疑爱好者", category: "Audience", description: "Viewers motivated by clues and reveals.", descriptionZh: "会被线索与真相揭露持续吸引的观众。" },
];

export function getTag(tagId: string): CreatorTag | undefined {
  return CREATOR_TAGS.find((tag) => tag.id === tagId);
}

export function creatorTagFromOntology(node: OntologyTagSource): CreatorTag {
  const localTag = getTag(node.id);
  return {
    id: node.id,
    label: node.label,
    labelZh: localTag?.labelZh ?? node.label,
    category: mapOntologyCategory(node.category),
    description: node.description,
    descriptionZh: localTag?.descriptionZh ?? node.description,
    trending: localTag?.trending,
  };
}

export function isCreatorFacingOntologyNode(node: OntologyTagSource): boolean {
  return node.is_active && CREATOR_FACING_ONTOLOGY_CATEGORIES.has(node.category);
}

export function resolveLegacyTagId(tagId: string): string {
  return LEGACY_TAG_ID_MAP[tagId] ?? tagId;
}

function mapOntologyCategory(category: string): TagCategory {
  if (category === "Genre" || category === "Emotion" || category === "Audience") {
    return category;
  }
  if (category === "CultureCluster") return "Audience";
  return "Story Element";
}

export function getLocalizedTagLabel(tag: CreatorTag, locale: "en" | "zh"): string {
  return locale === "zh" ? tag.labelZh : tag.label;
}

export function getLocalizedTagDescription(tag: CreatorTag, locale: "en" | "zh"): string {
  return locale === "zh" ? tag.descriptionZh : tag.description;
}
