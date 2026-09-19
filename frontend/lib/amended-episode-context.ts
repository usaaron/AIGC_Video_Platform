import type { ScriptGenerationRun, ScriptProject } from "./types";
import type { StoryBible, StoryPlanNode } from "./story-planning-client";
import {
  episodeGenerationCharacterRefs, episodeGenerationExecutionPlan, episodeGenerationInstruction,
  episodeGenerationLedgerPlan, storyNodeExecutionContext,
} from "./episode-generation-planning";
import { producedPlanHash } from "./produced-plan-content";

/** Compile the adopted execution source; never mutate the archived source run. */
export async function compileAmendedEpisodeSource(
  project: ScriptProject, source: ScriptGenerationRun, bible: StoryBible | null, nodes: StoryPlanNode[],
): Promise<ScriptGenerationRun> {
  const context = source.episode_context;
  const episode = project.episodes.find(item => item.episodeNumber === context?.episode_number);
  if (!context || !episode?.sourceAmendment) return source;
  if (project.planningRevision?.status === "active") throw new Error("请先完成本次规划审校，再修订正文。");
  const earliest = Math.min(...project.episodes.filter(item => item.sourceAmendment).map(item => item.episodeNumber));
  if (earliest !== context.episode_number) throw new Error(`请先处理第${earliest}集的正文修订或依赖复核。`);
  const plans = (project.episodeRoadmaps ?? []).filter(item => item.episode_number === context.episode_number);
  const plan = plans[0];
  if (plans.length !== 1 || plan.status !== "approved" || plan.source_revision_review
    || !bible || bible.status !== "approved" || bible.version !== project.storyBibleVersion
    || plan.story_bible_version !== bible.version) {
    throw new Error("本集采用的执行规划尚未批准，或总纲来源已变化，请先复核规划。");
  }
  if (await producedPlanHash(plan) !== episode.sourceAmendment.sourcePlanHash) {
    throw new Error("执行规划与已采用的修订记录不一致，请重新载入当前版本。");
  }
  const node = nodes.find(item => item.node_id === plan.source_node_id && item.version === plan.source_node_version
    && item.story_bible_id === bible.story_bible_id && item.story_bible_version === bible.version
    && item.status === "approved");
  if (!node) throw new Error("本集上层来源已变化，不能沿用旧规划修改正文。");
  const constraint = { episodeNumber: context.episode_number, episodeRoadmap: plan, storyPlanNode: node };
  const execution = episodeGenerationExecutionPlan(constraint);
  if (!execution) throw new Error("本集执行规划不能编译，请先复核规划。");
  const ledger = episodeGenerationLedgerPlan(constraint);
  return {
    ...source,
    episode_context: {
      ...context,
      approved_episode_plan: execution,
      approved_story_node: storyNodeExecutionContext(constraint) ?? null,
      episode_instruction: episodeGenerationInstruction(constraint, "", { endingMode: context.ending_mode }) ?? null,
      relevant_character_refs: episodeGenerationCharacterRefs(constraint),
      planned_story_line_refs: ledger.plannedStoryLineRefs,
      planned_setup_refs: ledger.plannedSetupRefs,
      planned_payoff_refs: ledger.plannedPayoffRefs,
      planned_story_beat: ledger.plannedStoryBeat ?? null,
    },
  };
}
