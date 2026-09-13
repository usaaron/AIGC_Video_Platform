import { apiRequest } from "@/lib/api-client";
import { nextProjectUpdatedAt } from "@/lib/project-store";
import { storyPlanningInputSignature } from "@/lib/story-planning-signature";
import type { StoryBible } from "@/lib/story-planning-client";
import type { EpisodeWorkspace, GeneratedDraft, ScriptProject } from "./types";

export function authorConflictSourceLabel(sourceRef: string): string {
  if (/character|motivation|人物|动机/i.test(sourceRef)) return "人物设定";
  if (/episode[_-]?plan|roadmap|scene_execution_plan|单集规划/i.test(sourceRef)) return "单集规划";
  if (/story[_-]?(?:plan[_-]?)?node|剧情部分/i.test(sourceRef)) return "剧情部分规划";
  if (/story[_-]?bible|canon|总纲/i.test(sourceRef)) return "总纲设定";
  if (/continuity|checkpoint|memory|前文/i.test(sourceRef)) return "前文连续性";
  if (/draft|screenplay|scene|正文/i.test(sourceRef)) {
    const scene = /scenes(?:\[(\d+)\]|\.(\d+))/.exec(sourceRef);
    return scene ? `本集正文 · 第 ${Number(scene[1] ?? scene[2]) + 1} 场` : "本集正文";
  }
  return /[\u3400-\u9fff]/.test(sourceRef) && !/[.[\]{}]/.test(sourceRef)
    ? sourceRef.slice(0, 80)
    : "已有剧情依据";
}

export function authorConflictSourceSnapshot(
  project: ScriptProject,
  episode: EpisodeWorkspace,
  draft: GeneratedDraft,
): string {
  // Pending decisions and view state must not invalidate their own source.
  const source = JSON.stringify({
    draft,
    generationContext: episode.generationRun.episode_context,
    storyBibleVersion: project.storyBibleVersion,
    storyBibleAuthorInstruction: project.storyBibleAuthorInstruction,
    creativePrompt: project.creativePrompt,
    generationSettings: project.generationSettings,
    episodeRoadmaps: project.episodeRoadmaps,
    characters: project.characters,
    storyLines: project.storyLines,
    characterRelationships: project.characterRelationships,
    continuityStates: project.continuityStates,
    continuationHooks: project.continuationHooks,
    setupPayoffs: project.setupPayoffs,
  });
  // A compact local stale-result marker; the server validates its own fingerprint.
  let hash = BigInt("0xcbf29ce484222325");
  const prime = BigInt("0x100000001b3");
  for (let index = 0; index < source.length; index += 1) {
    hash = BigInt.asUintN(64, (hash ^ BigInt(source.charCodeAt(index))) * prime);
  }
  return `author-source.v1:${source.length}:${hash.toString(16)}`;
}

export function customConflictInstruction(instruction: string, direction: string): string {
  const custom = direction.trim();
  if (!custom) throw new Error("请填写希望采用的处理方向。");
  const combined = `${instruction.trim()}\n用户补充的处理方向：${custom}`;
  if (combined.length > 500) {
    throw new Error("原要求与补充方向合计不能超过 500 字，请精简补充方向后重试。");
  }
  return combined;
}

export interface AuthorRevisionResult {
  project_id: string;
  story_bible: StoryBible;
  workspace_payload: ScriptProject;
  revision: number;
}

export function authorRevisionWorkspace(result: AuthorRevisionResult): ScriptProject {
  const project = result.workspace_payload;
  if (result.revision !== 1 || result.story_bible.version !== 1 || result.story_bible.status !== "draft") {
    return project;
  }
  return {
    ...project,
    storyBibleInputSignature: storyPlanningInputSignature(project),
    updatedAt: nextProjectUpdatedAt(project.updatedAt),
  };
}

export async function createAuthorRevision(
  projectId: string,
  request: {
    source_story_bible_version: number;
    expected_workspace_revision: number;
    instruction: string;
    resolution_plan: string;
    request_id: string;
    review_id: string;
    option_id: string;
  },
): Promise<AuthorRevisionResult> {
  const response = await apiRequest<{ data: AuthorRevisionResult }>(
    `/story-projects/${projectId}/author-revisions`,
    { method: "POST", body: JSON.stringify(request) },
  );
  return response.data;
}
