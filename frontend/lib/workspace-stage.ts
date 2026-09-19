import type { PlanningPhase, ScriptProject } from "./types";

export type WorkspaceSectionId = "story-synopsis" | "story-bible" | "planning" | "script" | "storyboard";

export interface WorkspaceSectionAccess {
  phase: PlanningPhase;
  storyBible: boolean;
  storySynopsis: boolean;
  planning: boolean;
  script: boolean;
  storyboard: boolean;
}

type WorkspaceStageProject = Pick<ScriptProject,
  | "id"
  | "storySynopsis"
  | "planningSession"
  | "storyBibleStatus"
  | "episodePlansReadyThrough"
  | "generationSettings"
  | "productionOutputMode"
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
    storyBible: project.storySynopsis?.status === "confirmed"
      // Existing deployed drafts predate the synopsis checkpoint. They must
      // remain reviewable without inventing a confirmed synopsis for them.
      || (!project.storySynopsis && Boolean(project.storyBibleStatus))
      || phase !== "creative_intent",
    storySynopsis: true,
    planning,
    script,
    // Projects created before the choice existed keep the historical behavior.
    storyboard: script && project.productionOutputMode !== "script_only",
  };
}

export function workspaceSectionHref(
  project: WorkspaceStageProject,
  section: WorkspaceSectionId,
): string {
  if (section === "story-synopsis") return `/projects/${project.id}/synopsis`;
  if (section === "story-bible") return `/projects/${project.id}/planning`;
  if (section === "planning") return `/projects/${project.id}/planning/structure`;
  if (section === "storyboard") return `/projects/${project.id}/storyboard`;
  // Entering the script workspace must never start generation implicitly.
  // Generation is launched only by an explicit user action. Legacy callers
  // may still provide `?generate=1` when they intentionally request a batch;
  // this navigation helper never adds that intent itself.
  return `/projects/${project.id}/workspace`;
}

export function currentWorkspaceHref(project: WorkspaceStageProject): string {
  const access = workspaceSectionAccess(project);
  if (access.script) return workspaceSectionHref(project, "script");
  if (access.planning) return workspaceSectionHref(project, "planning");
  return workspaceSectionHref(project, access.storyBible ? "story-bible" : "story-synopsis");
}
