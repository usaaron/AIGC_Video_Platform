import type { GeneratedDraft } from "@/lib/types";

export interface DraftTextMetrics {
  totalCharacters: number;
  scriptBodyCharacters: number;
  actionCharacters: number;
  dialogueCharacters: number;
}

export interface SeriesTextMetrics extends DraftTextMetrics {
  generatedEpisodes: number;
  plannedEpisodes: number;
  targetCharacters: number;
  remainingCharacters: number;
  progressRatio: number;
  averageCharactersPerEpisode: number;
  requiredAverageCharactersPerEpisode: number;
  projectedCharactersAtPlannedEpisodes: number;
  estimatedEpisodesToTarget: number | null;
}

export function countEffectiveCharacters(text: string): number {
  return Array.from(text.normalize("NFKC").matchAll(/[\p{L}\p{N}]/gu)).length;
}

export function calculateDraftTextMetrics(draft: GeneratedDraft): DraftTextMetrics {
  const actionParts = draft.scenes.flatMap((scene) => scene.character_actions);
  const dialogueParts = draft.scenes.flatMap((scene) => (
    scene.dialogues.map((dialogue) => dialogue.text)
  ));
  const structureParts = [
    draft.title,
    draft.logline,
    draft.synopsis,
    draft.hook,
    draft.episode_goal ?? "",
    ...draft.characters.flatMap((character) => [
      character.name,
      character.role,
      character.description,
      character.motivation,
    ]),
    ...draft.scenes.flatMap((scene) => [
      scene.slug,
      scene.purpose,
      scene.beat_summary,
      scene.setting ?? "",
      scene.setting_hint ?? "",
      scene.emotional_shift ?? "",
      scene.emotional_objective ?? "",
      scene.turning_point ?? "",
      scene.scene_causality?.goal ?? "",
      scene.scene_causality?.conflict ?? "",
      scene.scene_causality?.outcome ?? "",
      scene.scene_causality?.causal_link ?? "",
      ...scene.character_actions,
      ...scene.dialogues.flatMap((dialogue) => [dialogue.intent, dialogue.text]),
    ]),
    draft.next_episode_question ?? "",
  ];
  const actionCharacters = countParts(actionParts);
  const dialogueCharacters = countParts(dialogueParts);

  return {
    totalCharacters: countParts(structureParts),
    scriptBodyCharacters: actionCharacters + dialogueCharacters,
    actionCharacters,
    dialogueCharacters,
  };
}

export function calculateSeriesTextMetrics(
  drafts: GeneratedDraft[],
  targetCharacters: number,
  plannedEpisodes: number,
): SeriesTextMetrics {
  const aggregate = drafts.reduce<DraftTextMetrics>((total, draft) => {
    const metrics = calculateDraftTextMetrics(draft);
    return {
      totalCharacters: total.totalCharacters + metrics.totalCharacters,
      scriptBodyCharacters: total.scriptBodyCharacters + metrics.scriptBodyCharacters,
      actionCharacters: total.actionCharacters + metrics.actionCharacters,
      dialogueCharacters: total.dialogueCharacters + metrics.dialogueCharacters,
    };
  }, {
    totalCharacters: 0,
    scriptBodyCharacters: 0,
    actionCharacters: 0,
    dialogueCharacters: 0,
  });
  const normalizedTarget = Math.max(0, Math.round(targetCharacters));
  const normalizedPlannedEpisodes = Math.max(1, Math.round(plannedEpisodes));
  const averageCharactersPerEpisode = drafts.length
    ? Math.round(aggregate.scriptBodyCharacters / drafts.length)
    : 0;

  return {
    ...aggregate,
    generatedEpisodes: drafts.length,
    plannedEpisodes: normalizedPlannedEpisodes,
    targetCharacters: normalizedTarget,
    remainingCharacters: Math.max(0, normalizedTarget - aggregate.scriptBodyCharacters),
    progressRatio: normalizedTarget > 0
      ? aggregate.scriptBodyCharacters / normalizedTarget
      : 0,
    averageCharactersPerEpisode,
    requiredAverageCharactersPerEpisode: normalizedTarget > 0
      ? Math.ceil(normalizedTarget / normalizedPlannedEpisodes)
      : 0,
    projectedCharactersAtPlannedEpisodes: averageCharactersPerEpisode * normalizedPlannedEpisodes,
    estimatedEpisodesToTarget: normalizedTarget > 0 && averageCharactersPerEpisode > 0
      ? Math.ceil(normalizedTarget / averageCharactersPerEpisode)
      : null,
  };
}

function countParts(parts: string[]): number {
  return parts.reduce((total, part) => total + countEffectiveCharacters(part ?? ""), 0);
}
