import type { BilingualScriptView } from "./types.ts";
import { clientDialogueSpeaker } from "./client-screenplay-format.ts";

export function englishDialogueTranslations(
  view?: BilingualScriptView,
): Map<string, string> | undefined {
  if (!view?.target_language?.toLocaleLowerCase().startsWith("en-us")) return undefined;
  if (view.view_version !== "bilingual_script_view.v2") return undefined;
  return new Map(view.items.map((item) => [item.path, item.translated_text]));
}

export function mergeOverseasCharacterNames(
  names: Map<string, string>,
  view: BilingualScriptView | undefined,
): Map<string, string> {
  if (
    view?.view_version !== "bilingual_script_view.v2"
    || !view.target_language?.toLocaleLowerCase().startsWith("en-us")
  ) return names;
  for (const item of view.items) {
    if (
      !item.path.endsWith(".character_name")
      && !/^characters\.\d+\.name$/.test(item.path)
    ) continue;
    if (typeof item.source_text !== "string" || typeof item.translated_text !== "string") {
      continue;
    }
    const sourceName = clientDialogueSpeaker(item.source_text, item.source_text).speaker;
    const englishName = clientDialogueSpeaker(
      item.translated_text,
      item.source_text,
    ).speaker.toLocaleUpperCase();
    if (sourceName && englishName && !names.has(sourceName)) {
      names.set(sourceName, englishName);
    }
  }
  return names;
}

export function applyOverseasCharacterNames(
  text: string,
  names: ReadonlyMap<string, string>,
): string {
  return [...names.entries()]
    .filter(([sourceName, englishName]) => sourceName && englishName)
    .sort(([left], [right]) => right.length - left.length)
    .reduce(
      (current, [sourceName, englishName]) => current.split(sourceName).join(englishName),
      text,
    );
}
