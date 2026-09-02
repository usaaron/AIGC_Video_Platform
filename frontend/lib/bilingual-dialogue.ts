import type { BilingualScriptView } from "./types.ts";
import { clientDialogueSpeaker } from "./client-screenplay-format.ts";

export interface OverseasDialoguePresentation {
  direction: "english-to-chinese";
  translations: Map<string, string>;
}

export interface OverseasDialogueTextPair {
  english: string;
  chinese?: string;
}

export interface OverseasDialogueSpeaker {
  speaker: string;
  marker?: string;
}

export function overseasDialoguePresentation(
  view?: BilingualScriptView,
): OverseasDialoguePresentation | undefined {
  const target = view?.target_language?.toLocaleLowerCase() ?? "";
  if (
    (view?.view_version === "bilingual_script_view.v3"
      && target.startsWith("zh-cn-short-drama"))
  ) {
    return {
      direction: "english-to-chinese",
      translations: new Map(view.items.map((item) => [item.path, item.translated_text])),
    };
  }
  return undefined;
}

export function overseasDialogueTextPair(
  presentation: OverseasDialoguePresentation | undefined,
  path: string,
  source: string,
): OverseasDialogueTextPair {
  if (!presentation) return { english: source };
  const translated = presentation.translations.get(path);
  if (!translated) return { english: source };
  return { english: source, chinese: translated };
}

export function overseasNarrativeText(
  _presentation: OverseasDialoguePresentation | undefined,
  _path: string,
  source: string,
): string {
  return source;
}

export function mergeOverseasCharacterNames(
  names: Map<string, string>,
  view: BilingualScriptView | undefined,
): Map<string, string> {
  const presentation = overseasDialoguePresentation(view);
  if (!presentation || !view) return names;
  for (const item of view.items) {
    if (
      !item.path.endsWith(".character_name")
      && !/^characters\.\d+\.name$/.test(item.path)
    ) continue;
    if (typeof item.source_text !== "string" || typeof item.translated_text !== "string") {
      continue;
    }
    const sourceName = clientDialogueSpeaker(item.source_text, item.source_text).speaker;
    const translatedName = clientDialogueSpeaker(
      item.translated_text,
      item.source_text,
    ).speaker;
    const chineseName = translatedName;
    const englishName = sourceName.toLocaleUpperCase();
    if (!chineseName || !englishName || chineseName.toLocaleLowerCase() === englishName.toLocaleLowerCase()) {
      continue;
    }
    const existing = names.get(chineseName);
    // A presentation layer may temporarily echo the source name while its
    // translation is incomplete. Do not let that placeholder block a real
    // English alias from a later completed view.
    if (!existing || existing.toLocaleLowerCase() === chineseName.toLocaleLowerCase()) {
      names.set(chineseName, englishName);
    }
  }
  return names;
}

export function overseasDialogueSpeaker(
  presentation: OverseasDialoguePresentation | undefined,
  path: string,
  source: string,
  names: ReadonlyMap<string, string> = new Map(),
): OverseasDialogueSpeaker {
  const sourceSpeaker = clientDialogueSpeaker(source, source);
  const translatedText = presentation?.translations.get(path);
  const translatedSpeaker = translatedText
    ? clientDialogueSpeaker(translatedText, source)
    : undefined;
  let chineseName = "";
  let englishName = "";

  if (presentation?.direction === "english-to-chinese" && translatedSpeaker) {
    chineseName = translatedSpeaker.speaker;
    englishName = sourceSpeaker.speaker;
  } else {
    const directEnglishName = names.get(sourceSpeaker.speaker);
    const reverseMatch = [...names.entries()].find(([, candidate]) => (
      candidate.toLocaleLowerCase() === sourceSpeaker.speaker.toLocaleLowerCase()
    ));
    if (directEnglishName) {
      chineseName = sourceSpeaker.speaker;
      englishName = directEnglishName;
    } else if (reverseMatch) {
      [chineseName, englishName] = reverseMatch;
    }
  }

  return {
    speaker: chineseName && englishName
      ? `${chineseName}（${englishName.toLocaleUpperCase()}）`
      : sourceSpeaker.speaker,
    marker: sourceSpeaker.marker ?? translatedSpeaker?.marker,
  };
}

export function applyChineseCharacterNames(
  text: string,
  names: ReadonlyMap<string, string>,
): string {
  return [...names.entries()]
    .filter(([chineseName, englishName]) => chineseName && englishName)
    .sort(([, left], [, right]) => right.length - left.length)
    .reduce(
      (current, [chineseName, englishName]) => current.replace(
        new RegExp(escapeRegExp(englishName), "gi"),
        chineseName,
      ),
      text,
    );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
