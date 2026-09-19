import type { BilingualScriptView } from "./types.ts";
import { clientDialogueSpeaker } from "./client-screenplay-format.ts";

export interface OverseasDialoguePresentation {
  direction: "english-to-chinese";
  translations: Map<string, string>;
  characterNames: Map<string, string>;
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
      characterNames: new Map(view.items.flatMap(item => {
        if (!item.path.endsWith(".character_name") && !/^characters\.\d+\.name$/.test(item.path)) return [];
        const alias = clientDialogueSpeaker(item.translated_text, item.source_text).speaker;
        const english = clientDialogueSpeaker(item.source_text, item.source_text).speaker;
        return /[\u3400-\u9fff]/.test(alias) && /[A-Za-z]/.test(english) && !/[\u3400-\u9fff]/.test(english)
          ? [[alias, english] as const] : [];
      })),
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
  return { english: source, chinese: applyEnglishCharacterNames(translated, presentation.characterNames) };
}

export function overseasNarrativeText(
  presentation: OverseasDialoguePresentation | undefined,
  _path: string,
  source: string,
): string {
  return presentation ? applyEnglishCharacterNames(source, presentation.characterNames) : source;
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
    const englishName = sourceName;
    if (!/[\u3400-\u9fff]/.test(chineseName) || !englishName || chineseName.toLocaleLowerCase() === englishName.toLocaleLowerCase()) {
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
  const directEnglishName = names.get(sourceSpeaker.speaker);
  const englishName = directEnglishName
    ?? (/[A-Za-z]/.test(sourceSpeaker.speaker) && !/[\u3400-\u9fff]/.test(sourceSpeaker.speaker)
      ? sourceSpeaker.speaker
      : undefined);
  return {
    speaker: englishName ?? sourceSpeaker.speaker,
    marker: sourceSpeaker.marker || translatedSpeaker?.marker || "",
  };
}

/** Display explicit legacy aliases in English without translating narrative prose. */
export function applyEnglishCharacterNames(
  text: string,
  names: ReadonlyMap<string, string>,
): string {
  return [...names.entries()]
    .filter(([alias, english]) => alias && english && /[\u3400-\u9fff]/.test(alias))
    .sort(([left], [right]) => right.length - left.length)
    .reduce((current, [alias, english]) => {
      const paired = new RegExp(`${escapeRegExp(alias)}\\s*[（(]\\s*${escapeRegExp(english)}\\s*[）)]`, "gi");
      const withoutPair = current.replace(paired, english);
      // A one-character alias can also be part of an ordinary Chinese word.
      // Legacy prose is not enough evidence to rewrite those substrings.
      const boundary = alias.length === 1 ? "[A-Za-z\\u3400-\\u9fff]" : "[A-Za-z]";
      return withoutPair.replace(
        new RegExp(`(?<!${boundary})${escapeRegExp(alias)}(?!${boundary})`, "g"), english,
      );
    }, text);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
