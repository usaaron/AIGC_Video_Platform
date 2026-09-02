import type {
  InputReadinessAnalysis,
  ScriptProject,
} from "./types.ts";

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
  "请以用户上传资料为第一事实来源，将其规范化为当前故事总纲结构，忠实保留原有的人物身份与关系、事件因果、核心冲突、结局方向和明确创作约束。",
  "不得擅自替换题材、主角、关键选择或结局，也不得把已有内容重新构思成另一版故事；只补齐当前结构契约必需但原资料确实缺失的字段，并明确保持与原资料一致。",
  "本次结果仍是可保存、可继续修改且等待用户确认的总纲草稿，不得绕过保存、确认或后续规划门禁。",
].join("\n");

const PLANNING_IMPORT_INSTRUCTION = [
  "这是用户上传的高完成度分集规划导入任务。",
  "请以用户上传资料为第一事实来源，忠实保留原有的人物身份与关系、事件因果、结局方向，以及每集的编号、顺序、目标、冲突、结果、钩子和跨集承接。",
  "不得重新发明一套分集结构，不得交换、合并或删除已有分集；仅为适配当前剧情树、8至12集执行单元和分集路线图契约，补齐原资料缺失的结构字段与执行约束。",
  "完整规划生成后仍必须经过保存和用户确认；不得直接标记为已确认、不得绕过正文门禁，也不得在确认前自动进入正文。",
].join("\n");

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
    prepareCompletePlanning: analysis.detectedLevel === "episode_plan"
      || analysis.detectedLevel === "script",
  };
}

export function shouldAutoNormalizeImportedStoryBible(
  source: InputReadinessWorkflowSource,
): boolean {
  return inputReadinessWorkflowIntent(source).normalizeStoryBible;
}

export function shouldAutoPrepareImportedPlanning(
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
