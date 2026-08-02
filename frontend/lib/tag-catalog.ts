import { CURRENT_MARKET_PROFILE, type CreatorTag, type TagCategory } from "@/lib/types";

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
  "emotion.dark": "emotion.oppressive",
  "emotion.passion": "emotion.hot_blooded",
  "audience.teen": "audience.youth",
  "audience.young_adult": "audience.youth",
};

const OVERSEAS_CREATOR_TAGS: CreatorTag[] = [
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
  { id: "theme.vampire", label: "Vampire", labelZh: "吸血鬼", category: "Story Element", description: "Immortality, hunger, and forbidden intimacy.", descriptionZh: "永生、欲望与禁忌亲密关系。", trending: true },
  { id: "theme.revenge", label: "Revenge", labelZh: "复仇", category: "Story Element", description: "A pursuit of reckoning and consequence.", descriptionZh: "追求清算，并承担复仇后果。", trending: true },
  { id: "theme.rebirth", label: "Rebirth", labelZh: "重生", category: "Story Element", description: "A second life with remembered stakes.", descriptionZh: "带着记忆重新开始第二次人生。" },
  { id: "theme.hidden_identity", label: "Hidden Identity", labelZh: "隐藏身份", category: "Story Element", description: "A concealed self that changes trust.", descriptionZh: "被隐瞒的身份改变人物之间的信任。", trending: true },
  { id: "theme.time_loop", label: "Time Loop", labelZh: "时间循环", category: "Story Element", description: "Repeated time with accumulating choices.", descriptionZh: "在重复时间中累积选择与代价。" },
  { id: "relationship.forbidden_love", label: "Forbidden Love", labelZh: "禁忌之恋", category: "Story Element", description: "Connection opposed by duty or danger.", descriptionZh: "受到责任或危险阻碍的感情。", trending: true },
  { id: "relationship.contract", label: "Contract", labelZh: "契约关系", category: "Story Element", description: "A binding agreement with emotional cost.", descriptionZh: "带有情感代价的约束性协议。" },
  { id: "theme.supernatural_power", label: "Supernatural Power", labelZh: "超自然能力", category: "Story Element", description: "An extraordinary ability that creates consequence.", descriptionZh: "会带来明确后果的非凡能力。" },
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

type MainlandTagDefinition = readonly [
  id: string,
  label: string,
  labelZh: string,
  category: TagCategory,
  descriptionZh: string,
];

const MAINLAND_TAG_DEFINITIONS: MainlandTagDefinition[] = [
  ["genre.romance", "Romance", "爱情", "Genre", "以人物关系与情感选择推动故事。"],
  ["genre.dark_romance", "Intense Romance", "强情感虐恋", "Genre", "以高压关系、情感代价与边界冲突推动故事。"],
  ["genre.modern_romance", "Modern Romance", "现代言情", "Genre", "现代生活背景下的情感与关系故事。"],
  ["genre.costume_romance", "Costume Romance", "古代言情", "Genre", "古代或架空历史背景下的情感故事。"],
  ["genre.urban", "Urban", "都市", "Genre", "围绕都市生活、职业和社会关系展开。"],
  ["genre.fantasy", "Fantasy", "玄幻", "Genre", "以超常世界规则、成长与力量冲突为核心。"],
  ["genre.xianxia", "Xianxia", "仙侠", "Genre", "以修行、宗门、因果与超凡世界为背景。"],
  ["genre.wuxia", "Wuxia", "武侠", "Genre", "以江湖秩序、武学与人物选择展开。"],
  ["genre.scifi", "Science Fiction", "科幻", "Genre", "探索科技变化及其人物和社会后果。"],
  ["genre.mystery", "Mystery", "悬疑", "Genre", "通过线索、误导与真相揭露维持追读。"],
  ["genre.horror", "Thriller Horror", "惊悚", "Genre", "以未知威胁、恐惧与生存压力推动故事。"],
  ["genre.comedy", "Comedy", "喜剧", "Genre", "通过人物错位和行动后果制造喜剧推进。"],
  ["genre.action", "Action", "动作", "Genre", "强调行动风险、对抗与明确胜负。"],
  ["genre.historical", "Historical", "历史", "Genre", "以明确历史时期或历史语境为基础。"],
  ["genre.school", "School", "校园", "Genre", "围绕校园关系、成长与身份选择展开。"],
  ["genre.apocalypse", "Apocalypse", "末日", "Genre", "在秩序崩塌中处理生存、资源与人性选择。"],
  ["genre.family", "Family Drama", "家庭伦理", "Genre", "通过家庭责任、秘密与关系冲突推进。"],
  ["theme.revenge", "Revenge", "复仇", "Story Element", "围绕清算目标、行动代价与价值选择展开。"],
  ["theme.rebirth", "Rebirth", "重生", "Story Element", "角色带着过去经验重新选择人生。"],
  ["theme.transmigration", "Transmigration", "穿越", "Story Element", "角色进入不同时间、世界或身份处境。"],
  ["theme.system", "System", "系统", "Story Element", "以明确规则、任务与代价辅助剧情推进。"],
  ["theme.power_growth", "Power Growth", "逆袭成长", "Story Element", "通过连续选择和代价实现能力或地位成长。"],
  ["theme.hidden_identity", "Hidden Identity", "隐藏身份", "Story Element", "隐瞒身份持续影响信任、风险与关系。"],
  ["theme.true_fake_heir", "Swapped Heir", "真假千金", "Story Element", "身份归属与家庭利益冲突改变人物关系。"],
  ["theme.wealthy_family", "Wealthy Family", "豪门", "Story Element", "围绕家族资源、身份与权力关系展开。"],
  ["theme.business_war", "Business Conflict", "商战", "Story Element", "以商业目标、信息差与利益博弈推动冲突。"],
  ["theme.palace_intrigue", "Power Intrigue", "权谋", "Story Element", "通过立场、资源和信息博弈改变权力格局。"],
  ["theme.investigation", "Investigation", "探案", "Story Element", "通过调查行动、证据链和风险揭示真相。"],
  ["theme.infinite_flow", "Infinite Flow", "无限流", "Story Element", "以连续规则空间和生存任务推动长线成长。"],
  ["theme.apocalypse_survival", "Apocalypse Survival", "末日求生", "Story Element", "围绕资源、生存选择与群体关系展开。"],
  ["theme.supernatural_power", "Supernatural Power", "异能", "Story Element", "超常能力必须伴随限制、用途与后果。"],
  ["theme.cultivation", "Cultivation", "修仙", "Story Element", "以修行体系、目标与因果代价推动成长。"],
  ["theme.time_loop", "Time Loop", "时间循环", "Story Element", "在重复时间中累积信息、选择与后果。"],
  ["theme.vampire", "Vampire", "吸血鬼", "Story Element", "以身份、欲望、寿命差异与关系代价推动冲突。"],
  ["relationship.contract", "Contract Relationship", "契约关系", "Story Element", "一项约定把人物利益和情感代价绑定。"],
  ["relationship.marriage_first_love_later", "Marriage Before Love", "先婚后爱", "Story Element", "先建立制度关系，再通过事件发展真实感情。"],
  ["relationship.reconciliation", "Reconciliation", "破镜重圆", "Story Element", "旧关系在新冲突中重新建立或彻底破裂。"],
  ["relationship.chasing_spouse", "Regret and Pursuit", "追妻火葬场", "Story Element", "伤害者付出可见代价并争取修复关系。"],
  ["relationship.forbidden_love", "Forbidden Relationship", "禁忌关系", "Story Element", "外部规则与人物选择共同阻碍关系发展。"],
  ["relationship.rivals_to_allies", "Rivals to Allies", "宿敌合作", "Story Element", "对立人物因共同压力被迫协作。"],
  ["relationship.family_conflict", "Family Conflict", "家族冲突", "Story Element", "家庭成员的目标、责任与秘密发生冲突。"],
  ["conflict.class_gap", "Class Gap", "阶层差异", "Story Element", "资源、地位与生活经验差异持续制造选择代价。"],
  ["conflict.identity_exposure", "Identity Exposure", "身份暴露", "Story Element", "身份揭露直接改变风险、关系或权力。"],
  ["emotion.satisfying", "Satisfying", "爽感", "Emotion", "通过压制、反击与可见结果形成情绪释放。"],
  ["emotion.suspense", "Suspense", "悬念", "Emotion", "利用信息差和未解决问题维持期待。"],
  ["emotion.sweet", "Sweet", "甜宠", "Emotion", "通过有行动依据的关怀与关系进展提供甜感。"],
  ["emotion.tragic", "Angst", "虐心", "Emotion", "通过有因果的失去、误解或牺牲制造痛感。"],
  ["emotion.healing", "Healing", "治愈", "Emotion", "通过信任建立和创伤修复形成情绪回报。"],
  ["emotion.hot_blooded", "Hot Blooded", "热血", "Emotion", "通过明确目标、风险与集体行动形成昂扬情绪。"],
  ["emotion.humorous", "Light Comedy", "轻松搞笑", "Emotion", "以轻松节奏和人物反差平衡冲突。"],
  ["emotion.oppressive", "Oppressive", "压迫感", "Emotion", "通过持续压力、限制与风险制造紧张。"],
  ["audience.female_oriented", "Female-oriented Audience", "女频受众", "Audience", "偏好关系、情绪与人物选择驱动的内容。"],
  ["audience.male_oriented", "Male-oriented Audience", "男频受众", "Audience", "偏好成长、目标、行动与世界规则驱动的内容。"],
  ["audience.youth", "Youth Audience", "青年受众", "Audience", "关注成长、身份、关系与现实选择的受众。"],
  ["audience.mature", "Mature Audience", "熟龄受众", "Audience", "关注复杂关系、责任与现实代价的受众。"],
  ["audience.romance", "Romance Audience", "言情受众", "Audience", "偏好情感关系持续发展的受众。"],
  ["audience.fantasy", "Fantasy Audience", "玄幻受众", "Audience", "偏好超常世界、升级与规则探索的受众。"],
  ["audience.mystery", "Mystery Audience", "悬疑受众", "Audience", "偏好线索、推理和真相揭露的受众。"],
  ["audience.family", "Family Drama Audience", "家庭题材受众", "Audience", "关注家庭关系、责任与伦理冲突的受众。"],
];

const MAINLAND_RECOMMENDED_TAG_IDS = new Set([
  "theme.rebirth",
  "theme.transmigration",
  "theme.system",
  "theme.power_growth",
  "theme.hidden_identity",
  "theme.true_fake_heir",
  "relationship.marriage_first_love_later",
  "theme.investigation",
]);

const MAINLAND_CREATOR_TAGS: CreatorTag[] = MAINLAND_TAG_DEFINITIONS.map(([
  id,
  label,
  labelZh,
  category,
  descriptionZh,
]) => ({
  id,
  label,
  labelZh,
  category,
  description: descriptionZh,
  descriptionZh,
  trending: MAINLAND_RECOMMENDED_TAG_IDS.has(id),
}));

export const CREATOR_TAGS: CreatorTag[] = CURRENT_MARKET_PROFILE === "cn_mainland"
  ? MAINLAND_CREATOR_TAGS
  : OVERSEAS_CREATOR_TAGS;

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
    trending: localTag?.trending
      ?? (CURRENT_MARKET_PROFILE === "cn_mainland" && MAINLAND_RECOMMENDED_TAG_IDS.has(node.id)),
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
