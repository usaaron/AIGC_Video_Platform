import { mergeOverseasCharacterNames } from "./bilingual-dialogue.ts";
import { clientSceneHeading } from "./client-screenplay-format.ts";
import { characterReferenceNames } from "./character-reference.ts";
import type {
  BilingualScriptView,
  CharacterDraft,
  CharacterActingProfile,
  CharacterRelationship,
  ContinuityStateRecord,
  GeneratedDraft,
} from "./types.ts";

export interface ProductionEpisodeSource {
  episodeNumber: number;
  draft: GeneratedDraft;
  bilingualView?: BilingualScriptView;
}

export interface ProductionCharacterRecord {
  name: string;
  code: string;
  englishName: string;
  chineseName: string;
  role: string;
  identity: string;
  coreTraits: string;
  relationships: string[];
  appearanceCount: number;
  episodeNumbers: number[];
  designNotes: string;
  actingProfile?: CharacterActingProfile;
  personality: string;
  description: string;
}

export interface ProductionSceneRecord {
  name: string;
  englishName: string;
  chineseName: string;
  episodeNumbers: number[];
  appearanceCount: number;
  functions: string[];
  designKeywords: string[];
}

export interface ProductionPropRecord {
  name: string;
  englishName: string;
  chineseName: string;
  functions: string[];
  relatedScenes: string[];
  relatedCharacters: string[];
  appearanceCount: number;
  episodeNumbers: number[];
  designNotes: string[];
  owners: string[];
  directUsers: string[];
  secondaryContacts: string[];
}

export interface ProductionIndex {
  characterNameLanguage?: "en" | "zh";
  characters: ProductionCharacterRecord[];
  scenes: ProductionSceneRecord[];
  props: ProductionPropRecord[];
}

export interface ProductionIndexInput {
  characters: CharacterDraft[];
  relationships?: CharacterRelationship[];
  continuityStates?: ContinuityStateRecord[];
  episodes: ProductionEpisodeSource[];
}

interface MutableCharacter {
  character?: CharacterDraft;
  actingProfile?: CharacterActingProfile;
  name: string;
  englishName: string;
  chineseName: string;
  roles: Set<string>;
  descriptions: Set<string>;
  motivations: Set<string>;
  episodeNumbers: Set<number>;
  relationships: Map<string, number>;
}

interface MutableScene {
  name: string;
  episodeNumbers: Set<number>;
  appearanceCount: number;
  functions: Map<string, number>;
  designKeywords: Map<string, number>;
}

interface MutableProp {
  name: string;
  aliases: Set<string>;
  functions: Map<string, number>;
  scenes: Map<string, number>;
  characters: Map<string, number>;
  appearanceSceneKeys: Set<string>;
  designNotes: Map<string, number>;
  owners: Map<string, number>;
  directUsers: Map<string, number>;
  secondaryContacts: Map<string, number>;
}

const COMMON_PROPS = [
  "手机", "电话", "录音笔", "相机", "摄像机", "电脑", "笔记本电脑", "平板电脑",
  "电视", "屏幕", "监控器", "门卡", "房卡", "钥匙", "车钥匙", "戒指", "项链",
  "吊坠", "手链", "耳环", "胸针", "手表", "徽章", "印章", "王冠", "硬币", "银行卡",
  "名片", "护照", "证件", "合同", "文件", "档案", "报告", "名单", "信", "纸条",
  "照片", "地图", "图纸", "账本", "日记", "书", "报纸", "杂志", "U盘", "硬盘",
  "芯片", "存储器", "枪", "手枪", "步枪", "子弹", "弹匣", "刀", "匕首", "餐刀",
  "剪刀", "绳子", "锁链", "手铐", "束缚带", "药瓶", "药片", "针筒", "注射器",
  "血样", "纱布", "绷带", "口罩", "手套", "眼镜", "雨伞", "背包", "行李箱",
  "公文包", "钱包", "信封", "礼盒", "戒指盒", "酒杯", "咖啡杯", "酒瓶", "水杯",
  "打火机", "香烟", "蜡烛", "手电筒", "遥控器", "话筒", "耳机", "窃听器",
  "追踪器", "定位器", "录音设备", "直播设备", "防弹衣", "头盔", "军牌", "制服",
  "外套", "领带", "围巾", "高跟鞋", "鲜花", "玩偶", "拐杖", "轮椅", "担架",
  "病历", "车票", "机票", "船票", "车", "汽车", "摩托车", "自行车",
  "phone", "recorder", "camera", "computer", "laptop", "tablet", "television", "screen",
  "keycard", "key", "ring", "necklace", "pendant", "bracelet", "watch", "badge", "crown",
  "coin", "passport", "contract", "document", "file", "report", "list", "letter", "photo",
  "map", "blueprint", "ledger", "diary", "drive", "chip", "gun", "pistol", "rifle", "knife",
  "rope", "chain", "handcuffs", "medicine", "syringe", "bandage", "umbrella", "backpack",
  "suitcase", "briefcase", "wallet", "envelope", "box", "glass", "bottle", "flashlight",
  "microphone", "earpiece", "tracker", "bulletproof vest",
];

const VISUAL_KEYWORDS = [
  "昏暗", "明亮", "冷白", "暖黄", "霓虹", "雨", "雪", "雾", "烟", "血迹", "破旧",
  "奢华", "空旷", "拥挤", "凌乱", "整洁", "潮湿", "冰冷", "幽闭", "红色", "黑色",
  "白色", "蓝色", "金色", "银色", "玻璃", "金属", "木质", "石材", "荧光",
];

export function buildProductionIndex(input: ProductionIndexInput): ProductionIndex {
  const characters = new Map<string, MutableCharacter>();
  const overseas = input.episodes.some(source => (source.draft.language ?? "").toLowerCase().startsWith("en"));
  const aliases = new Map<string, string>();
  if (overseas) for (const source of input.episodes) {
    mergeOverseasCharacterNames(aliases, source.bilingualView);
    for (const scene of source.draft.scenes) for (const line of scene.dialogues) {
      if (line.chinese_character_name && !containsHan(line.character_name)) {
        aliases.set(line.chinese_character_name, cleanSpeakerName(line.character_name));
      }
    }
  }
  const identity = (name: string) => aliases.get(cleanSpeakerName(name)) ?? cleanSpeakerName(name);
  const ensureIdentity = (name: string) => ensureCharacter(characters, identity(name));
  const characterIds = new Map<string, string>();
  const scenes = new Map<string, MutableScene>();
  const props = new Map<string, MutableProp>();
  const itemNames = [
    ...(input.continuityStates ?? []).filter(state => state.entityType === "item").map(state => state.entityName),
    ...input.episodes.flatMap(source => (source.draft.continuity_state_updates ?? [])
      .filter(update => update.entity_type === "item").map(update => update.entity_name)),
  ];
  const productionPropNames = new Set<string>();
  for (const source of input.episodes) {
    for (const scene of source.draft.scenes ?? []) {
      const declared = scene.content_manifest?.props ?? [];
      const body = sceneBodyText(scene);
      const names = declared.length ? declared : [...COMMON_PROPS, ...itemNames].filter(name => containsTerm(body, name));
      for (const name of names) {
        if (!/^(?:sl_|memory[.:]|story[_-]line[.:])/.test(name)) productionPropNames.add(normalizeName(name));
      }
    }
  }

  for (const character of input.characters) {
    const record = ensureIdentity(character.name);
    record.character = character;
    record.actingProfile = character.actingProfile;
    record.roles.add(character.role);
    if (character.description) record.descriptions.add(character.description);
    if (character.motivation) record.motivations.add(character.motivation);
    characterIds.set(character.id, identity(character.name));
  }

  for (const state of input.continuityStates ?? []) {
    if (state.entityType !== "item" || !productionPropNames.has(normalizeName(state.entityName))) continue;
    const prop = ensureProp(props, state.entityName);
    addRanked(prop.designNotes, state.currentState);
    if (state.futureConstraint) addRanked(prop.functions, state.futureConstraint);
    if (state.stateDomain === "ownership" || state.stateDomain === "possession") {
      for (const character of input.characters) {
        if (containsName(state.currentState, character.name)) {
          addRanked(prop.owners, identity(character.name));
        }
      }
    }
  }

  const orderedEpisodes = input.episodes.slice().sort((a, b) => a.episodeNumber - b.episodeNumber);
  for (const source of orderedEpisodes) {
    const translations = bilingualCharacterNames(source.bilingualView);
    for (const draftCharacter of source.draft.characters ?? []) {
      const record = ensureIdentity(draftCharacter.name);
      record.actingProfile ??= draftCharacter.acting_profile;
      record.roles.add(draftCharacter.role);
      if (draftCharacter.description) record.descriptions.add(draftCharacter.description);
      if (draftCharacter.motivation) record.motivations.add(draftCharacter.motivation);
      const translated = translations.get(normalizeName(draftCharacter.name));
      applyTranslatedName(record, translated);
    }

    const episodeItemUpdates = (source.draft.continuity_state_updates ?? [])
      .filter((update) => update.entity_type === "item" && productionPropNames.has(normalizeName(update.entity_name)));
    for (const update of episodeItemUpdates) {
      const prop = ensureProp(props, update.entity_name);
      addRanked(prop.functions, update.change_cause);
      addRanked(prop.designNotes, update.current_state);
      for (const character of input.characters) {
        if (containsName(`${update.current_state} ${update.change_cause}`, character.name)) {
          if (update.state_domain === "ownership" || update.state_domain === "possession") {
            addRanked(prop.owners, identity(character.name));
          }
        }
      }
    }

    for (const scene of source.draft.scenes ?? []) {
      const sceneName = extractLocationName(
        scene.content_manifest?.location || scene.scene_heading || scene.setting_hint || scene.setting || scene.slug,
      );
      const sceneKey = normalizeName(sceneName) || `scene-${source.episodeNumber}-${scene.scene_number}`;
      const sceneRecord = scenes.get(sceneKey) ?? {
        name: sceneName || `第${source.episodeNumber}集第${scene.scene_number}场`,
        episodeNumbers: new Set<number>(),
        appearanceCount: 0,
        functions: new Map<string, number>(),
        designKeywords: new Map<string, number>(),
      };
      scenes.set(sceneKey, sceneRecord);
      sceneRecord.episodeNumbers.add(source.episodeNumber);
      sceneRecord.appearanceCount += 1;
      addRanked(sceneRecord.functions, scene.purpose || scene.beat_summary);

      const sceneText = [
        scene.purpose,
        scene.beat_summary,
        scene.emotional_objective,
        scene.emotional_shift,
        ...(scene.character_actions ?? []),
        ...(scene.dialogues ?? []).map((line) => `${line.character_name} ${line.text}`),
      ].filter(Boolean).join(" ");
      for (const keyword of VISUAL_KEYWORDS) {
        if (sceneText.includes(keyword)) addRanked(sceneRecord.designKeywords, keyword);
      }

      const presentCharacters = new Set<string>();
      const declaredCast = scene.content_manifest?.character_refs?.length
        ? scene.content_manifest.character_refs : scene.character_refs ?? [];
      for (const name of characterReferenceNames(declaredCast, input.characters)) {
        if (name && !/^(?:story-bible-)?character[.:]/.test(name)) {
          presentCharacters.add(ensureIdentity(name).name);
        }
      }
      for (const line of scene.dialogues ?? []) {
        const name = cleanSpeakerName(line.character_name);
        if (name) presentCharacters.add(ensureIdentity(name).name);
      }
      // Legacy drafts have no cast manifest. Once an explicit cast exists,
      // a name written on paper or mentioned in an action is not an appearance.
      if (!declaredCast.length) {
        for (const character of characters.values()) {
          if ((scene.character_actions ?? []).some((action) => containsName(action, character.name))) {
            presentCharacters.add(character.name);
          }
        }
      }
      for (const name of presentCharacters) {
        ensureIdentity(name).episodeNumbers.add(source.episodeNumber);
      }
      for (const sourceName of presentCharacters) {
        for (const targetName of presentCharacters) {
          if (sourceName === targetName) continue;
          addRanked(ensureIdentity(sourceName).relationships, targetName);
        }
      }

      const declaredProps = (scene.content_manifest?.props ?? []).filter(name => productionPropNames.has(normalizeName(name)));
      const candidates = new Set<string>(declaredProps);
      if (!declaredProps.length) {
        const body = sceneBodyText(scene);
        for (const prop of props.values()) {
          if ([...prop.aliases].some((alias) => containsTerm(body, alias))) candidates.add(prop.name);
        }
        for (const term of COMMON_PROPS) {
          if (containsTerm(body, term)) candidates.add(term);
        }
      }
      for (const name of declaredProps.length ? candidates : reduceNestedCandidates(candidates)) {
        const prop = ensureProp(props, name);
        prop.appearanceSceneKeys.add(`${source.episodeNumber}:${scene.scene_number}`);
        addRanked(prop.scenes, sceneRecord.name);
        addRanked(prop.functions, scene.purpose || scene.beat_summary);
        for (const characterName of presentCharacters) {
          addRanked(prop.characters, characterName);
          const direct = (scene.character_actions ?? []).some((action) => (
            containsName(action, characterName) && [...prop.aliases].some((alias) => containsTerm(action, alias))
          ));
          addRanked(direct ? prop.directUsers : prop.secondaryContacts, characterName);
        }
      }
    }
  }

  for (const relationship of input.relationships ?? []) {
    const source = characterIds.get(relationship.sourceCharacterId);
    const target = characterIds.get(relationship.targetCharacterId);
    if (!source || !target) continue;
    addRanked(ensureIdentity(source).relationships, target, 8);
    addRanked(ensureIdentity(target).relationships, source, 8);
  }

  const characterRecords = [...characters.values()]
    .filter((record) => record.episodeNumbers.size > 0 || Boolean(record.character))
    .sort((a, b) => b.episodeNumbers.size - a.episodeNumbers.size || a.name.localeCompare(b.name, "zh-CN"))
    .map((record, index) => toCharacterRecord(record, index));
  const sceneRecords = [...scenes.values()]
    .sort((a, b) => b.appearanceCount - a.appearanceCount || a.name.localeCompare(b.name, "zh-CN"))
    .map(toSceneRecord);
  const propRecords = [...props.values()]
    .filter((record) => record.appearanceSceneKeys.size > 0 || record.designNotes.size > 0)
    .sort((a, b) => b.appearanceSceneKeys.size - a.appearanceSceneKeys.size || a.name.localeCompare(b.name, "zh-CN"))
    .map(toPropRecord);

  return { characterNameLanguage: overseas ? "en" : "zh", characters: characterRecords, scenes: sceneRecords, props: propRecords };
}

export function formatEpisodeRanges(values: number[]): string {
  const numbers = [...new Set(values)].sort((a, b) => a - b);
  const ranges: string[] = [];
  for (let index = 0; index < numbers.length; index += 1) {
    const start = numbers[index];
    let end = start;
    while (numbers[index + 1] === end + 1) {
      index += 1;
      end = numbers[index];
    }
    ranges.push(start === end ? String(start) : `${start}-${end}`);
  }
  return ranges.join("、");
}

export function frequencySummary(index: ProductionIndex): Array<{
  type: "人物" | "场景" | "道具";
  total: number;
  high: string;
  medium: string;
  low: string;
}> {
  return [
    frequencyRow("人物", index.characters.map((item) => ({ name: index.characterNameLanguage === "en" ? item.englishName || item.name : item.chineseName || item.name, count: item.appearanceCount }))),
    frequencyRow("场景", index.scenes.map((item) => ({ name: item.chineseName || item.name, count: item.appearanceCount }))),
    frequencyRow("道具", index.props.map((item) => ({ name: item.chineseName || item.name, count: item.appearanceCount }))),
  ];
}

function toCharacterRecord(record: MutableCharacter, index: number): ProductionCharacterRecord {
  const character = record.character;
  const dynamic = character?.dynamicState;
  const appearance = character?.appearance?.trim() || "按正文首次出场描述保持统一";
  const personality = dynamic?.personalityDevelopment
    || topValues(record.descriptions, 1)[0]
    || character?.motivation
    || "按人物在正文中的行为与选择保持一致";
  return {
    name: record.name,
    actingProfile: record.actingProfile,
    code: characterCode(character, index),
    englishName: record.englishName || (containsHan(record.name) ? "" : record.name),
    chineseName: record.chineseName || (containsHan(record.name) ? record.name : ""),
    role: character?.role || topValues(record.roles, 1)[0] || "角色",
    identity: character?.background || topValues(record.roles, 2).join(" / ") || "正文角色",
    coreTraits: compactJoin([
      ...topValues(record.descriptions, 1),
      ...topValues(record.motivations, 1),
      dynamic?.currentGoal,
    ], 120),
    relationships: topValues(record.relationships, 8),
    appearanceCount: record.episodeNumbers.size,
    episodeNumbers: [...record.episodeNumbers].sort((a, b) => a - b),
    designNotes: compactJoin([
      appearance,
      ...(dynamic?.lastingMarks ?? []),
      ...(dynamic?.healthConditions ?? []),
    ], 120),
    personality: truncate(personality, 120),
    description: truncate(character?.description || topValues(record.descriptions, 1)[0] || "依据正文出场与行动整理。", 180),
  };
}

function toSceneRecord(record: MutableScene): ProductionSceneRecord {
  return {
    name: record.name,
    englishName: containsHan(record.name) ? "" : record.name,
    chineseName: containsHan(record.name) ? record.name : "",
    episodeNumbers: [...record.episodeNumbers].sort((a, b) => a - b),
    appearanceCount: record.appearanceCount,
    functions: topValues(record.functions, 3).map((value) => truncate(value, 48)),
    designKeywords: topValues(record.designKeywords, 6),
  };
}

function toPropRecord(record: MutableProp): ProductionPropRecord {
  return {
    name: record.name,
    englishName: containsHan(record.name) ? "" : record.name,
    chineseName: containsHan(record.name) ? record.name : "",
    functions: topValues(record.functions, 3).map((value) => truncate(value, 48)),
    relatedScenes: topValues(record.scenes, 4),
    relatedCharacters: topValues(record.characters, 6),
    appearanceCount: record.appearanceSceneKeys.size,
    episodeNumbers: [...new Set([...record.appearanceSceneKeys].map(key => Number(key.split(":")[0])))].sort((a, b) => a - b),
    designNotes: topValues(record.designNotes, 3).map((value) => truncate(value, 60)),
    owners: topValues(record.owners, 4),
    directUsers: topValues(record.directUsers, 10),
    secondaryContacts: topValues(record.secondaryContacts, 10),
  };
}

function ensureCharacter(map: Map<string, MutableCharacter>, rawName: string): MutableCharacter {
  const name = cleanSpeakerName(rawName) || rawName.trim() || "未命名角色";
  const key = normalizeName(name);
  const existing = map.get(key);
  if (existing) return existing;
  const created: MutableCharacter = {
    name,
    englishName: containsHan(name) ? "" : name,
    chineseName: containsHan(name) ? name : "",
    roles: new Set<string>(),
    descriptions: new Set<string>(),
    motivations: new Set<string>(),
    episodeNumbers: new Set<number>(),
    relationships: new Map<string, number>(),
  };
  map.set(key, created);
  return created;
}

function sceneBodyText(scene: GeneratedDraft["scenes"][number]): string {
  return [...(scene.character_actions ?? []), ...(scene.dialogues ?? []).map(line => line.text)].join(" ");
}

function ensureProp(map: Map<string, MutableProp>, rawName: string): MutableProp {
  const name = rawName.trim() || "未命名道具";
  const key = normalizeName(name);
  const existing = map.get(key);
  if (existing) {
    existing.aliases.add(name);
    return existing;
  }
  const created: MutableProp = {
    name,
    aliases: new Set([name]),
    functions: new Map<string, number>(),
    scenes: new Map<string, number>(),
    characters: new Map<string, number>(),
    appearanceSceneKeys: new Set<string>(),
    designNotes: new Map<string, number>(),
    owners: new Map<string, number>(),
    directUsers: new Map<string, number>(),
    secondaryContacts: new Map<string, number>(),
  };
  map.set(key, created);
  return created;
}

function extractLocationName(value: string): string {
  const heading = clientSceneHeading(value || "未标注场景");
  return heading
    .replace(/^(?:INT\.|EXT\.)\s*/i, "")
    .replace(/\s+(?:日|夜|黄昏|黎明|清晨|傍晚|连续|稍后|DAY|NIGHT|DAWN|DUSK|MORNING|EVENING)(?:\s*-\s*(?:CONTINUOUS|LATER))?$/i, "")
    .trim();
}

function bilingualCharacterNames(view?: BilingualScriptView): Map<string, string> {
  const result = new Map<string, string>();
  for (const item of view?.items ?? []) {
    if (!/^characters\.\d+\.name$/.test(item.path)) continue;
    if (!item.source_text?.trim() || !item.translated_text?.trim()) continue;
    result.set(normalizeName(item.source_text), item.translated_text.trim());
  }
  return result;
}

function applyTranslatedName(record: MutableCharacter, translated?: string): void {
  if (!translated) return;
  if (containsHan(translated)) record.chineseName ||= translated;
  else record.englishName ||= translated;
}

function cleanSpeakerName(value: string): string {
  return value
    .replace(/[（(](?:O\.S\.|V\.O\.|continued|beat|pre[- ]?lap|画外音|旁白|接续)[^）)]*[）)]/gi, "")
    .trim();
}

function containsName(text: string, name: string): boolean {
  const normalizedText = normalizeName(text);
  const normalizedName = normalizeName(name);
  return Boolean(normalizedName) && normalizedText.includes(normalizedName);
}

function containsTerm(text: string, term: string): boolean {
  if (!term.trim()) return false;
  if (containsHan(term)) return text.includes(term);
  return new RegExp(`\\b${escapeRegExp(term)}s?\\b`, "i").test(text);
}

function normalizeName(value: string): string {
  return cleanSpeakerName(value)
    .toLocaleLowerCase()
    .replace(/[\s·•._'’\-—:：,，。!?！？/\\]+/g, "");
}

function containsHan(value: string): boolean {
  return /[\u3400-\u9fff]/.test(value);
}

function addRanked(map: Map<string, number>, rawValue: string | null | undefined, weight = 1): void {
  const value = rawValue?.replace(/\s+/g, " ").trim();
  if (!value) return;
  map.set(value, (map.get(value) ?? 0) + weight);
}

function topValues(source: Map<string, number> | Set<string>, limit: number): string[] {
  if (source instanceof Set) return [...source].filter(Boolean).slice(0, limit);
  return [...source.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-CN"))
    .slice(0, limit)
    .map(([value]) => value);
}

function compactJoin(values: Array<string | null | undefined>, limit: number): string {
  return truncate([...new Set(values.map((value) => value?.trim()).filter(Boolean) as string[])].join("；"), limit);
}

function truncate(value: string, limit: number): string {
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned.length <= limit ? cleaned : `${cleaned.slice(0, Math.max(0, limit - 1))}…`;
}

function characterCode(character: CharacterDraft | undefined, index: number): string {
  const gender = character?.gender?.toLocaleLowerCase() ?? "";
  const prefix = /女|female|woman/.test(gender) ? "F" : /男|male|man/.test(gender) ? "M" : "C";
  return `${prefix}${index + 1}`;
}

function frequencyRow(
  type: "人物" | "场景" | "道具",
  values: Array<{ name: string; count: number }>,
) {
  const sorted = values.slice().sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh-CN"));
  const format = (items: typeof sorted) => items.map((item) => `${item.name}（${item.count}）`).join("、");
  return {
    type,
    total: sorted.length,
    high: format(sorted.filter((item) => item.count >= 10)),
    medium: format(sorted.filter((item) => item.count >= 5 && item.count <= 9)),
    low: format(sorted.filter((item) => item.count >= 1 && item.count <= 4)),
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function reduceNestedCandidates(values: Set<string>): string[] {
  const candidates = [...values];
  return candidates.filter((candidate) => {
    const normalizedCandidate = normalizeName(candidate);
    if (normalizedCandidate.length < 2) return true;
    return !candidates.some((other) => {
      if (candidate === other) return false;
      const normalizedOther = normalizeName(other);
      return normalizedOther.length > normalizedCandidate.length
        && normalizedOther.includes(normalizedCandidate);
    });
  });
}
