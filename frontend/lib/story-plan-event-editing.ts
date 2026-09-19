import type { StoryPlanNode } from "./story-planning-client";

/** Manual event edits cannot silently move existing source references. */
export function assertStoryPlanEventEditPreservesSources(
  node: StoryPlanNode,
  candidate: StoryPlanNode,
): void {
  const changed = (field: "turning_points" | "unit_story_beats") => (
    JSON.stringify(candidate[field] ?? []) !== JSON.stringify(node[field] ?? [])
  );
  if (node.parent_event_bindings?.length && changed("unit_story_beats")) {
    throw new Error("这些剧情事件已承接上层安排。请先协调上层与这一部分的事件对应关系，再修改、增删或调整事件顺序；其他内容仍可修改，填写的内容会保留。");
  }
  if (node.episode_developments?.length && (changed("turning_points") || changed("unit_story_beats"))) {
    throw new Error("这一部分已有逐集事件安排。请先在对应分集规划中协调事件及其来源，再修改关键转折或剧情事件；其他修改仍保留在表单中。");
  }
}
