import type { PlanningPhase, ScriptProject } from "./types";

export type WorkspaceSectionId = "story-bible" | "planning" | "script";

export interface WorkspaceSectionAccess {
  phase: PlanningPhase;
  storyBible: true;
  planning: boolean;
  script: boolean;
}

type WorkspaceStageProject = Pick<ScriptProject,
  | "id"
  | "planningSession"
  | "storyBibleStatus"
  | "episodePlansReadyThrough"
  | "generationSettings"
  | "episodes"
>;

function legacyWorkspacePhase(project: WorkspaceStageProject): PlanningPhase {
  const planningCoversSeries = (
    (project.episodePlansReadyThrough ?? 0)
    >= project.generationSettings.episodeCount
  );
  if (project.episodes.length > 0 || planningCoversSeries) return "script";
  if (project.storyBibleStatus === "approved") return "story_tree";
  if (project.storyBibleStatus) return "story_bible";
  return "creative_intent";
}

export function workspaceSectionAccess(
  project: WorkspaceStageProject,
): WorkspaceSectionAccess {
  const session = project.planningSession;
  let phase = session?.phase ?? legacyWorkspacePhase(project);
  // Repair states that can only be produced by an interrupted persistence
  // update. Existing episodes always mean the project has crossed into the
  // script workspace; an approved Story Bible cannot remain in an earlier
  // creative-intent phase. Normal transitions still use the durable session.
  if (session && project.episodes.length > 0 && phase !== "script") {
    phase = "script";
  } else if (
    session
    && project.storyBibleStatus === "approved"
    && (phase === "creative_intent" || phase === "story_bible")
  ) {
    phase = "story_tree";
  }
  const planning = phase === "story_tree"
    || phase === "episode_roadmap"
    || phase === "script";
  const script = phase === "script"
    || (phase === "episode_roadmap" && session?.status === "approved");
  return {
    phase,
    storyBible: true,
    planning,
    script,
  };
}

export function workspaceSectionHref(
  project: WorkspaceStageProject,
  section: WorkspaceSectionId,
): string {
  if (section === "story-bible") return `/projects/${project.id}/planning`;
  if (section === "planning") return `/projects/${project.id}/planning/structure`;
  const generationIntent = project.episodes.length ? "" : "?generate=1";
  return `/projects/${project.id}/workspace${generationIntent}`;
}

export function currentWorkspaceHref(project: WorkspaceStageProject): string {
  const access = workspaceSectionAccess(project);
  if (access.script) return workspaceSectionHref(project, "script");
  if (access.planning) return workspaceSectionHref(project, "planning");
  return workspaceSectionHref(project, "story-bible");
}
