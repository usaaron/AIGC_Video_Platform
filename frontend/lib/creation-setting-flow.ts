import type { ScriptProject, StoryInspirationBrief, StoryInspirationSession } from "./types.ts";

/** The first idea is also the source for resolving an empty host-created project. */
export function inspirationRequestProject(project: ScriptProject, submitted: string, brief: StoryInspirationBrief): ScriptProject {
  if (project.creativePrompt.trim() || project.referenceMaterials?.length) return project;
  const idea = submitted.trim() || [brief.story_promise, brief.protagonist_and_goal, ...brief.additional_notes].filter(Boolean).join("\n");
  return idea ? { ...project, creativePrompt: idea } : project;
}

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
