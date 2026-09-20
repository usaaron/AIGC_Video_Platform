import { canRegenerateStoryBible } from "@/lib/story-planning-state";
import { storyPlanningInputSignature } from "@/lib/story-planning-signature";
import { synopsisHasPendingChanges } from "@/lib/story-synopsis-context";
import type { StoryBible } from "@/lib/story-planning-client";
import type { ScriptProject } from "@/lib/types";

function contentKey(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(contentKey).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${contentKey(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** Clear an obsolete-source flag only for a newer, saved draft of these inputs.
 * Recheck current inside the provider update so intervening edits win.
 */
export function recoveredStoryBibleProgressPatch(
  source: ScriptProject,
  saved: ScriptProject,
  bible: StoryBible | null,
  current: ScriptProject = saved,
): Pick<ScriptProject, "storyBibleSynopsisOutdated"> | null {
  if (!bible || bible.status !== "draft" || !canRegenerateStoryBible(current)
    || saved.storyBibleSynopsisOutdated !== true || current.storyBibleSynopsisOutdated !== true
    || source.id !== saved.id || current.id !== saved.id || bible.story_project_id !== saved.id
    || bible.version <= (source.storyBibleVersion ?? 0)
    || saved.storyBibleVersion !== bible.version || current.storyBibleVersion !== bible.version
    || !saved.contentSpecId || saved.contentSpecId !== bible.content_spec_id
    || current.contentSpecId !== saved.contentSpecId
    || (source.planningRevisionEpoch ?? 0) !== (saved.planningRevisionEpoch ?? 0)
    || (current.planningRevisionEpoch ?? 0) !== (saved.planningRevisionEpoch ?? 0)
    || current.serverSync?.workspaceRevision !== saved.serverSync?.workspaceRevision) return null;

  const signature = storyPlanningInputSignature(source);
  if (saved.storyBibleInputSignature !== signature
    || storyPlanningInputSignature(saved) !== signature
    || storyPlanningInputSignature(current) !== signature) return null;

  // The planning-input signature intentionally excludes the confirmed synopsis.
  // Match it explicitly, including review/author notes and pending changes.
  if (!source.storySynopsis?.text.trim() || source.storySynopsis.status !== "confirmed"
    || synopsisHasPendingChanges(source.storySynopsis)
    || contentKey(source.storySynopsis) !== contentKey(saved.storySynopsis)
    || contentKey(current.storySynopsis) !== contentKey(saved.storySynopsis)) return null;
  return { storyBibleSynopsisOutdated: false };
}
