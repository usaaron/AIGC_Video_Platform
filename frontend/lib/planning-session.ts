import type {
  PlanningSession,
  PlanningTurn,
  ScriptProject,
} from "./types";

export function planningSessionForProject(project: Pick<ScriptProject, "id" | "updatedAt" | "storyBibleAuthorInstruction" | "planningSession">): PlanningSession {
  if (project.planningSession) return project.planningSession;
  return {
    schemaVersion: "v1",
    sessionId: `planning.${project.id}`,
    phase: "creative_intent",
    status: "idle",
    storyBibleAuthorInstruction: project.storyBibleAuthorInstruction ?? "",
    treeAuthorInstruction: "",
    storyBibleStep: "premise",
    storyBibleSections: {},
    reviewedNodeIds: [],
    turns: [],
    updatedAt: project.updatedAt,
  };
}

export function updatePlanningSession(
  project: Pick<ScriptProject, "id" | "updatedAt" | "storyBibleAuthorInstruction" | "planningSession">,
  patch: Partial<PlanningSession>,
): PlanningSession {
  return {
    ...planningSessionForProject(project),
    ...patch,
    updatedAt: new Date().toISOString(),
  };
}

export function appendPlanningTurn(
  project: Pick<ScriptProject, "id" | "updatedAt" | "storyBibleAuthorInstruction" | "planningSession">,
  turn: Omit<PlanningTurn, "turnId" | "createdAt">,
): PlanningSession {
  const current = planningSessionForProject(project);
  const nextTurn: PlanningTurn = {
    ...turn,
    turnId: `turn.${crypto.randomUUID()}`,
    createdAt: new Date().toISOString(),
  };
  return updatePlanningSession(project, {
    turns: [...current.turns, nextTurn],
  });
}
