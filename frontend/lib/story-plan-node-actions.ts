export type StoryPlanNodePrimaryAction =
  | "confirm"
  | "decompose"
  | "generate-roadmap"
  | "continue-roadmap"
  | "generate-script"
  | "continue-script"
  | "view-script"
  | null;

export type StoryPlanNodeWorkflowStatus =
  | "none"
  | "roadmap-blocked"
  | "roadmap-pending"
  | "script-blocked"
  | "script-ready"
  | "script-progress"
  | "script-complete";

export interface StoryPlanNodeActionContext {
  status: "draft" | "approved" | "superseded";
  isEditing: boolean;
  canDecompose: boolean;
  directScriptReady: boolean;
  roadmapRequired: boolean;
  roadmapComplete: boolean;
  roadmapItemCount: number;
  roadmapPredecessorReady: boolean;
  scriptPredecessorReady: boolean;
  generatedEpisodeCount: number;
  expectedEpisodeCount: number;
}

export interface StoryPlanNodeWorkflow {
  action: StoryPlanNodePrimaryAction;
  status: StoryPlanNodeWorkflowStatus;
}

export function resolveStoryPlanNodeWorkflow(
  context: StoryPlanNodeActionContext,
): StoryPlanNodeWorkflow {
  if (context.isEditing || context.status === "superseded") {
    return { action: null, status: "none" };
  }
  if (context.status === "draft") {
    return { action: "confirm", status: "none" };
  }
  if (context.canDecompose) {
    return { action: "decompose", status: "none" };
  }
  if (!context.directScriptReady) {
    return { action: null, status: "none" };
  }
  if (context.roadmapRequired && !context.roadmapComplete) {
    if (!context.roadmapPredecessorReady) {
      return { action: null, status: "roadmap-blocked" };
    }
    return {
      action: context.roadmapItemCount > 0
        ? "continue-roadmap"
        : "generate-roadmap",
      status: "roadmap-pending",
    };
  }
  if (!context.scriptPredecessorReady) {
    return { action: null, status: "script-blocked" };
  }
  if (
    context.expectedEpisodeCount > 0
    && context.generatedEpisodeCount >= context.expectedEpisodeCount
  ) {
    return { action: "view-script", status: "script-complete" };
  }
  if (context.generatedEpisodeCount > 0) {
    return { action: "continue-script", status: "script-progress" };
  }
  return { action: "generate-script", status: "script-ready" };
}
