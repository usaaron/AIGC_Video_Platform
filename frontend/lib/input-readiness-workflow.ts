import type {
  InputReadinessAnalysis,
  ScriptProject,
  StoryInspirationBrief,
} from "./types.ts";
import { verifiedInputFacts } from "./input-readiness.ts";

export function seedInspirationBriefFromInput(
  project: Pick<ScriptProject, "inputReadiness" | "creativePrompt" | "referenceMaterials">,
  brief: StoryInspirationBrief,
): StoryInspirationBrief {
  const grouped = new Map<string, string[]>();
  for (const fact of verifiedInputFacts(project.inputReadiness, project)) {
    if (fact.field === "world_setting" || brief[fact.field].trim()) continue;
    if (brief.creative_decisions.some((decision) => decision.decision_key.split(".")[0] === fact.field
      && (decision.locked || decision.status !== "proposed"))) continue;
    const quotes = grouped.get(fact.field) ?? [];
    if (!quotes.includes(fact.quote)) quotes.push(fact.quote);
    grouped.set(fact.field, quotes);
  }
  const patch = Object.fromEntries([...grouped].map(([field, quotes]) => {
    const budget = Math.max(1, Math.floor((500 - quotes.length + 1) / quotes.length));
    return [field, quotes.map((quote) => [...quote].slice(0, budget).join("")).join("\n")];
  }));
  return grouped.size ? { ...brief, ...patch } : brief;
}

export type InputReadinessWorkflowSource =
  | Pick<ScriptProject, "inputReadiness">
  | InputReadinessAnalysis
  | null
  | undefined;

export interface InputReadinessWorkflowIntent {
  normalizeStoryBible: boolean;
  prepareCompletePlanning: boolean;
}

const STORY_BIBLE_IMPORT_INSTRUCTION = [
  "这是用户上传的高完成度故事总纲导入任务。",
  "用户原文是第一事实来源，必须原样保留供作者核对；结构化故事总纲只是可编辑索引，不得替代或覆盖原文。",
  "请以用户上传资料为第一事实来源，将其整理为当前故事总纲结构，忠实保留原有的人物身份与关系、事件因果、核心冲突、结局方向和明确创作约束。",
  "不得擅自替换题材、主角、关键选择或结局，也不得把已有内容重新构思成另一版故事；只补齐当前结构契约必需但原资料确实缺失的字段，并明确保持与原资料一致。",
  "本次结果仍是可保存、可继续修改且等待用户确认的总纲草稿，不得绕过保存、确认或后续规划门禁。",
].join("\n");

const PLANNING_IMPORT_INSTRUCTION = [
  "这是用户上传的高完成度分集规划导入任务。",
  "原始分集规划必须作为只读来源保留，结构化剧情树和路线图只是可审核的执行索引。",
  "请以用户上传资料为第一事实来源，忠实保留原有的人物身份与关系、事件因果、结局方向，以及每集的编号、顺序、目标、冲突、结果、钩子和跨集承接。",
  "不得重新发明一套分集结构，不得交换、合并或删除已有分集；仅为适配当前剧情树、8至12集执行单元和分集路线图契约，补齐原资料缺失的结构字段与执行约束。",
  "完整规划生成后仍必须经过保存和用户确认；不得直接标记为已确认、不得绕过正文门禁，也不得在确认前自动进入正文。",
].join("\n");

const STORY_BIBLE_AUTHOR_INSTRUCTION_LIMIT = 7_500;

/** Keep planning requests inside StoryBibleDraftRequest.author_instruction. */
export function boundStoryBibleAuthorInstruction(value: string): string {
  return value.trim().slice(0, STORY_BIBLE_AUTHOR_INSTRUCTION_LIMIT);
}

/**
 * Append the source-grounding contract without allowing a long prior session
 * to truncate the contract out of the request body.
 */
export function storyBibleInstructionWithImportConstraints(value: string): string {
  const contract = STORY_BIBLE_IMPORT_INSTRUCTION;
  const prefixBudget = Math.max(
    0,
    STORY_BIBLE_AUTHOR_INSTRUCTION_LIMIT - contract.length - 1,
  );
  const prefix = value.trim().slice(0, prefixBudget);
  return prefix ? `${prefix}\n${contract}` : contract;
}

export function inputReadinessWorkflowIntent(
  source: InputReadinessWorkflowSource,
): InputReadinessWorkflowIntent {
  const analysis = readinessAnalysis(source);
  if (!analysis || analysis.selectedPath !== "recommended") {
    return {
      normalizeStoryBible: false,
      prepareCompletePlanning: false,
    };
  }

  return {
    normalizeStoryBible: analysis.detectedLevel !== "premise",
    // Only a structurally complete episode plan may prepare the planning
    // artifacts in the background. Partial plans remain in the normal review
    // flow so missing episodes cannot be mistaken for an approved roadmap.
    prepareCompletePlanning: analysis.assessmentVersion === 2 && analysis.structurallyComplete === true
      && (analysis.detectedLevel === "script"
        || (analysis.detectedLevel === "episode_plan" && analysis.recommendedStage === "script")),
  };
}

export function shouldApplyImportedStoryBibleConstraints(
  source: InputReadinessWorkflowSource,
): boolean {
  return inputReadinessWorkflowIntent(source).normalizeStoryBible;
}

export function shouldApplyImportedPlanningConstraints(
  source: InputReadinessWorkflowSource,
): boolean {
  return inputReadinessWorkflowIntent(source).prepareCompletePlanning;
}

export function importedStoryBibleInstruction(): string {
  return STORY_BIBLE_IMPORT_INSTRUCTION;
}

export function importedPlanningInstruction(): string {
  return PLANNING_IMPORT_INSTRUCTION;
}

function readinessAnalysis(
  source: InputReadinessWorkflowSource,
): InputReadinessAnalysis | undefined {
  if (!source) return undefined;
  if ("schemaVersion" in source) return source;
  return source.inputReadiness;
}
