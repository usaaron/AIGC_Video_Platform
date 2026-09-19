import type { GenerationRecoveryTask, ScriptProject } from "./types";

/** The saved delivery choice and original batch survive retries and page reloads. */
export function storyboardHandoffHref(
  project: Pick<ScriptProject, "id" | "productionOutputMode">,
  batch: Pick<GenerationRecoveryTask, "startEpisode" | "endEpisode">,
): string | null {
  if (project.productionOutputMode !== "script_and_storyboard") return null;
  return `/projects/${project.id}/storyboard?episode=${batch.startEpisode}&end=${batch.endEpisode}&autostart=1`;
}
