import type { StoryInspirationBrief, StoryInspirationSession } from "./types.ts";

export type CreationSettingStep = "idea" | "questions" | "review";

export const CONTINUE_CREATION_REFINEMENT_MESSAGE = "请继续深入一轮，找出当前创作设定中仍可能影响总纲质量、连续性或人物选择、但尚未明确的关键取舍；不要重复已经回答的问题。";

export function initialCreationSettingStep(session: StoryInspirationSession, useImportedStructure: boolean, hasRoundDraft = false): CreationSettingStep {
  if (useImportedStructure || session.readyToGenerate) return "review";
  return hasRoundDraft || session.messages.some((message) => message.role === "user") ? "questions" : "idea";
}

export function creationBriefWithInput(brief: StoryInspirationBrief, input: string, originalPrompt: string): StoryInspirationBrief {
  const value = input.trim();
  if (!value || value === originalPrompt.trim() || brief.additional_notes.includes(value)) return brief;
  return { ...brief, additional_notes: [...brief.additional_notes, value].slice(-20) };
}
