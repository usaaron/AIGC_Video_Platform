import { quickInitialInputs } from "./quick-script-project";
import type { QuickScriptState } from "./quick-script-types";
import type { ScriptProject } from "./types";

/** A source-page edit stays explicit until the author asks to redraft synopsis. */
export function pendingQuickSourceInputs(project: ScriptProject, state: QuickScriptState | null) {
  if (project.creationMode !== "quick" || !state || state.synopsis_confirmed || state.plan_confirmed
    || state.active_operation || state.episodes.length || project.quickSourceInputsRevision !== state.revision) return null;
  const inputs = quickInitialInputs(project);
  return inputs.idea !== state.idea || inputs.material !== state.source_material
    || Object.entries(inputs.settings).some(([key, value]) => state.settings[key as keyof typeof state.settings] !== value) ? inputs : null;
}
