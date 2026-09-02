export type StoryPlanNodePrimaryAction =
  | "decompose"
  | "generate-roadmap"
  | "continue-roadmap"
  | null;

export type StoryPlanNodeWorkflowStatus =
  | "none"
  | "roadmap-blocked"
  | "roadmap-pending";

export interface StoryPlanNodeActionContext {
  status: "draft" | "approved" | "superseded";
  isEditing: boolean;
  canDecompose: boolean;
  directScriptReady: boolean;
  roadmapRequired: boolean;
  roadmapComplete: boolean;
  roadmapItemCount: number;
  roadmapPredecessorReady: boolean;
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
  // Draft nodes are review checkpoints. The full-tree coordinator confirms
  // them only when the creator continues to the next layer; nodes never expose
  // a separate confirmation or intermediate-save workflow.
  if (context.status === "draft") return { action: null, status: "none" };
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
  return { action: null, status: "none" };
}
