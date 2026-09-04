import type { GeneratedDraft } from "./types.ts";

/**
 * Keep handoff and document exports aligned with the episode's closing mode.
 * Serial output preserves the legacy "尾钩" wording; finale output describes
 * closure and never promotes a stale compatibility field to a new hook.
 */
export function episodeEndingLabel(draft: GeneratedDraft): string {
  if (draft.ending_mode === "series_finale") return "剧终收束";
  if (draft.ending_mode === "season_finale") return "本季收束";
  return "尾钩";
}

export function episodeEndingText(draft: GeneratedDraft): string {
  const finalScene = draft.scenes[draft.scenes.length - 1];
  if (draft.ending_mode === "series_finale") {
    return finalScene?.scene_causality?.outcome?.trim()
      || finalScene?.turning_point?.trim()
      || "本集完成正式收束。";
  }
  if (draft.ending_mode === "season_finale") {
    return draft.continuation_hook?.ending_hook_summary?.trim()
      || finalScene?.scene_causality?.outcome?.trim()
      || finalScene?.turning_point?.trim()
      || draft.next_episode_question?.trim()
      || "本季完成正式收束。";
  }
  return draft.continuation_hook?.ending_hook_summary?.trim()
    || draft.next_episode_question?.trim()
    || draft.hook;
}
