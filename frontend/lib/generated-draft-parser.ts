import type { GeneratedDraft } from "./types.ts";

export interface GeneratedDraftParseOptions {
  requireNonEmptyScenes?: boolean;
  requireCompleteScenes?: boolean;
  requireTitle?: boolean;
}

/** Parse persisted drafts while keeping each caller's legacy strictness explicit. */
export function parseGeneratedDraft(
  value: string | undefined | null,
  options: GeneratedDraftParseOptions = {},
): GeneratedDraft | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { scenes?: unknown }).scenes)) {
      return null;
    }
    const draft = parsed as Partial<GeneratedDraft> & { scenes: unknown[] };
    if (options.requireNonEmptyScenes && draft.scenes.length === 0) return null;
    if (options.requireTitle && typeof draft.title !== "string") return null;
    if (options.requireCompleteScenes && draft.scenes.some((scene) => (
      !scene
      || typeof scene !== "object"
      || !Array.isArray((scene as { character_actions?: unknown }).character_actions)
      || !Array.isArray((scene as { dialogues?: unknown }).dialogues)
    ))) {
      return null;
    }
    return draft as GeneratedDraft;
  } catch {
    return null;
  }
}
