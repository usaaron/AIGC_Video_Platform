import { toEpisodePlainText } from "./episode-export";
import { buildEmbeddedOverseasDialogueView } from "./generation-client";
import type { BilingualScriptView, GeneratedDraft } from "./types";

/** Use translations already saved beside each line; exporting never starts translation. */
export function quickEpisodePlainText(draft: GeneratedDraft, episodeNumber: number): string {
  let view = buildEmbeddedOverseasDialogueView(draft);
  if (!view && draft.language.toLowerCase().startsWith("en")) {
    // A new unsaved line may not have its translation yet. Preserve every
    // existing pair in recovery text instead of dropping all translations.
    const items: BilingualScriptView["items"] = draft.scenes.flatMap((scene, sceneIndex) => scene.dialogues.flatMap((line, index) =>
      line.chinese_translation?.trim() ? [{ path: `scenes.${sceneIndex}.dialogues.${index}.text`,
        source_text: line.text, translated_text: line.chinese_translation }] : []));
    if (items.length) view = { view_version: "bilingual_script_view.v3", source_draft_master_script_id: draft.id,
      source_language: draft.language, target_language: "zh-CN-short-drama", items, warnings: [] };
  }
  return toEpisodePlainText(draft, episodeNumber, view);
}
