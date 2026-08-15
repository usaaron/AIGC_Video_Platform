import { ApiError, apiRequest } from "@/lib/api-client";
import {
  type AutomaticRetryEvent,
  generateWithAutomaticTransientRetry,
  generateWithFailurePolicy,
  isTransientGenerationFailure,
  roadmapRetryDelayMs,
} from "@/lib/generation-retry";
import {
  MAX_EPISODE_READY_SPAN,
  MIN_EPISODE_READY_SPAN,
  storyPlanNodeEpisodeSpan,
} from "@/lib/episode-generation-planning";
import { hasCompleteStoryPlanChildCoverage as hasCompleteCoverage } from "@/lib/story-plan-coverage";
import { recordProjectServerRevisions } from "@/lib/project-sync";
import { normalizeEpisodeDurationSeconds } from "@/lib/generation-planning";
import {
  hasUsableCreativeSource,
  referenceMaterialFallbackPrompt,
  referenceMaterialsForApi,
} from "@/lib/reference-materials";
export {
  creativeDirectionInputSignature,
  storyPlanningInputSignature,
} from "@/lib/story-planning-signature";
import {
  creativeDirectionInputSignature,
  storyPlanningInputSignature,
} from "@/lib/story-planning-signature";
import { getTag, resolveLegacyTagId } from "@/lib/tag-catalog";
import { mainlandTextIsEnglishDominant } from "@/lib/mainland-language";
import {
  CURRENT_MARKET_PROFILE,
  type CreativeDirectionCandidate,
  type EpisodeRoadmapItem,
  type ScriptProject,
} from "@/lib/types";

interface GenerationStrategySummary {
  id: string;
  status: string;
  target_platform: string;
  applicable_tags: string[];
  draft_knowledge_bundle_id?: string | null;
}

interface ApiList<T> { data: T[] }
interface OntologyNode { id: string; label: string; category: string; is_active: boolean }
interface PlatformProfile {
  id: string;
  platform_name: string;
  metadata?: { market_profile?: string; runtime_status?: string };
}
interface ResolutionResponse {
  data: { content_spec: { id: string }; resolved_creative_context: unknown };
}
interface StoryBibleResponse { data: StoryBible }
interface CreativeDirectionResponse {
  data: { directions: CreativeDirectionCandidate[] };
}
interface StoryBibleDraftResponse extends StoryBibleResponse {
  project_revision: number;
  workspace_revision: number | null;
}

interface StoryPlanNodeResponse { data: StoryPlanNode }

let nextPlanningRequestRetryAt = 0;

function waitForSharedPlanningRetry(delayMs: number): Promise<void> {
  const now = Date.now();
  const retryAt = Math.max(now + delayMs, nextPlanningRequestRetryAt);
  // Several branches may be generated concurrently. Space only their retries so
  // a provider cooldown does not end with another simultaneous request burst.
  nextPlanningRequestRetryAt = retryAt + 1_500;
  return new Promise((resolve) => setTimeout(resolve, retryAt - now));
}

export interface StoryBible {
  schema_version: string;
  story_bible_id: string;
  story_project_id: string;
  content_spec_id: string;
  version: number;
  status: "draft" | "approved" | "superseded";
  project_title?: string | null;
  core_premise: string;
  series_goal: string;
  theme: string;
  central_conflict: string;
  ending_direction: string;
  world_rules: string[];
  character_refs: string[];
  character_registry: Array<{ character_ref: string; name: string; role: string }>;
  character_arc_targets: Array<{
    character_ref: string;
    external_goal: string;
    internal_need: string | null;
    starting_state: string;
    target_state: string;
    key_turning_points: string[];
    protected_traits: string[];
  }>;
  relationships: Array<{
    relationship_id: string;
    source_character_ref: string;
    target_character_ref: string;
    relationship_type: string;
    initial_state: string;
    target_direction: string;
    locked: boolean;
  }>;
  story_lines: Array<{
    story_line_id: string;
    title: string;
    story_line_type: string;
    premise: string;
    planned_resolution: string;
    character_refs: string[];
  }>;
  escalation_stages: Array<{
    stage_id: string;
    title: string;
    stage_goal: string;
    stage_opposition: string;
    stage_payoff: string;
    escalation_to_next: string;
  }>;
  major_setup_payoff_refs: string[];
  locked_facts: string[];
  avoid_patterns: string[];
  created_at: string;
  approved_at: string | null;
}

export interface StoryPlanNode {
  schema_version: string;
  node_id: string;
  story_project_id: string;
  story_bible_id: string;
  story_bible_version: number;
  version: number;
  parent_node_id: string | null;
  parent_node_version: number | null;
  predecessor_node_id: string | null;
  predecessor_node_version: number | null;
  sequence_order: number;
  title: string;
  narrative_purpose: string;
  synopsis: string;
  entry_state: string;
  central_conflict: string;
  turning_points: string[];
  emotional_direction: string;
  exit_state: string;
  unit_story_beats: string[];
  unit_resolution: string | null;
  handoff_pressure: string | null;
  character_refs: string[];
  story_line_refs: string[];
  setup_refs: string[];
  payoff_refs: string[];
  estimated_episode_count: number | null;
  estimated_script_body_characters: number | null;
  planned_start_episode: number | null;
  planned_end_episode: number | null;
  expansion_status: "unexpanded" | "expanded" | "episode_ready";
  decomposition_reason: string | null;
  status: "draft" | "approved" | "superseded";
  created_at: string;
  approved_at: string | null;
}

// Recursive panels mount several copies of the same branch during development
// Strict Mode and while a background task finishes. Share in-flight reads so a
// tree refresh does not turn into a request storm or compete with generation.
const pendingStoryPlanNodeReads = new Map<string, Promise<StoryPlanNode[]>>();

function dedupeStoryPlanNodeRead(
  key: string,
  request: () => Promise<StoryPlanNode[]>,
): Promise<StoryPlanNode[]> {
  const pending = pendingStoryPlanNodeReads.get(key);
  if (pending) return pending;
  let next!: Promise<StoryPlanNode[]>;
  next = request().finally(() => {
    if (pendingStoryPlanNodeReads.get(key) === next) {
      pendingStoryPlanNodeReads.delete(key);
    }
  });
  pendingStoryPlanNodeReads.set(key, next);
  return next;
}

export interface EpisodePlan {
  episode_plan_id: string;
  story_project_id: string;
  story_bible_id: string;
  story_bible_version: number;
  version: number;
  stage_id: string;
  stage_version: number;
  episode_number: number;
  episode_goal: string;
  entry_state: string;
  central_conflict: string;
  protagonist_decision: string;
  reveal: string | null;
  emotional_movement: string;
  setup_refs: string[];
  payoff_refs: string[];
  exit_state: string;
  cliffhanger: string;
  character_refs: string[];
  continuity_requirements: string[];
  source_turning_points?: string[];
  source_unit_story_beats?: string[];
  status: "draft" | "approved" | "superseded";
  approved_at: string | null;
}

export async function prepareStoryPlanningProject(
  project: ScriptProject,
): Promise<ScriptProject> {
  const signature = storyPlanningInputSignature(project);
  const hasCurrentCreativeContext = Boolean(
    project.contentSpecId
    && project.resolvedCreativeContext
    && project.generationStrategyId
    && project.storyBibleInputSignature === signature
  );

  const [nodesResponse, profilesResponse, strategiesResponse] = await Promise.all([
    apiRequest<ApiList<OntologyNode>>("/ontology-nodes"),
    apiRequest<ApiList<PlatformProfile>>("/platform-profiles"),
    apiRequest<ApiList<GenerationStrategySummary>>("/generation-strategies"),
  ]);
  const activeNodes = nodesResponse.data.filter((node) => node.is_active);
  const activeNodeIds = new Set(activeNodes.map((node) => node.id));
  const customTagMap = new Map((project.customTags ?? []).map((tag) => [tag.id, tag]));
  const systemTagIds = Array.from(new Set(
    project.selectedTagIds
      .filter((tagId) => !customTagMap.has(tagId))
      .map(resolveLegacyTagId),
  ));
  const missingTags = systemTagIds.filter((tagId) => !activeNodeIds.has(tagId));
  if (missingTags.length) {
    throw new Error(`后端标签库缺少：${missingTags.join("、")}`);
  }
  if (!hasUsableCreativeSource(project.creativePrompt, project.referenceMaterials) && systemTagIds.length === 0) {
    throw new Error("仅使用“我的标签”时，需要补充创作描述或选择至少一个系统标签。");
  }
  const platform = profilesResponse.data.find(
    (item) => item.metadata?.runtime_status === "active",
  ) ?? profilesResponse.data[0];
  if (!platform || platform.metadata?.market_profile !== CURRENT_MARKET_PROFILE) {
    throw new Error("当前中国大陆市场配置不可用，请重新初始化运行资源。");
  }
  const platformName = platform.platform_name.trim().toLowerCase();
  const selectedTagIds = new Set(systemTagIds);
  const strategy = strategiesResponse.data
    .filter((item) => (
      item.status === "active"
      && item.target_platform.trim().toLowerCase() === platformName
      && item.applicable_tags.every((tagId) => selectedTagIds.has(tagId))
    ))
    .sort((left, right) => (
      Number(Boolean(right.draft_knowledge_bundle_id))
      - Number(Boolean(left.draft_knowledge_bundle_id))
      || right.applicable_tags.length - left.applicable_tags.length
    ))[0]
    ?? strategiesResponse.data.find((item) => item.status === "active");
  if (!strategy) throw new Error("后端没有可用的中国大陆生成策略。");

  if (hasCurrentCreativeContext) {
    if (project.generationStrategyId === strategy.id) return project;

    // Migrate projects that have not approved their Story Bible to the current
    // active long-form strategy. Approved planning and generated episodes keep
    // their original strategy for reproducibility.
    if (project.storyBibleStatus !== "approved" && project.episodes.length === 0) {
      return { ...project, generationStrategyId: strategy.id };
    }
    return project;
  }

  const customTagLabels = project.selectedTagIds
    .map((tagId) => customTagMap.get(tagId)?.label)
    .filter((label): label is string => Boolean(label));
  const emotionTag = systemTagIds
    .map((tagId) => activeNodes.find((node) => node.id === tagId))
    .find((node) => node?.category === "Emotion");
  const safeTitle = (project.title.trim().length >= 3
    ? project.title.trim()
    : `${project.title.trim() || "未命名"}剧本`).slice(0, 120);
  const effectiveCreativePrompt = project.creativePrompt.trim()
    || referenceMaterialFallbackPrompt(project.referenceMaterials);
  const resolution = await apiRequest<ResolutionResponse>(
    "/content-specs/resolve-creative-intent",
    {
      method: "POST",
      body: JSON.stringify({
        schema_version: "v1",
        title: safeTitle,
        audience_goal: {
          summary: "中国大陆连载漫剧与网络故事受众",
          priority: "primary",
          success_metric: "持续阅读与分集追更意愿",
        },
        commercial_goal: {
          summary: "建立可持续展开和后续漫剧改编的长篇故事基础",
          priority: "primary",
          success_metric: "连续性、人物稳定性与阶段性追读动力",
        },
        platform_goal: {
          platform_profile_id: platform.id,
          objective: "生成可递归规划的中国大陆中文长篇故事母本",
          target_duration_seconds: normalizeEpisodeDurationSeconds(
            project.generationSettings.preferredEpisodeDurationMinutes * 60,
          ),
          target_aspect_ratio: "9:16",
        },
        free_creative_prompt: effectiveCreativePrompt.slice(0, 240),
        quality_level: "high",
        budget_level: "medium",
        selected_tag_ids: systemTagIds,
        added_tag_ids: [],
        excluded_tag_ids: [],
        excluded_patterns: [],
        creative_brief: {
          hook: "先明确整部故事的核心矛盾和长期追读动力，再进入递归拆分。",
          tone: emotionTag?.label ?? "有张力",
          pacing: "长线递进",
          target_emotion: "持续期待",
          asset_constraints: [],
          generation_notes: [
            project.generationSettings.customInstructions.trim(),
            project.selectedCreativeDirection
              ? `用户已选择创作方向“${project.selectedCreativeDirection.title}”：`
                + `叙事风格：${project.selectedCreativeDirection.style_description}；`
                + `内容侧重：${project.selectedCreativeDirection.content_description}。`
              : "",
            customTagLabels.length
              ? `用户自定义创作标签：${customTagLabels.join("、")}。`
              : "",
            project.referenceMaterials?.length
              ? `用户上传了${project.referenceMaterials.length}份创作参考资料；必须按各文件标注用途使用。`
              : "",
          ].filter(Boolean),
        },
        character_contexts: [],
        request_metadata: {
          frontend_project_id: project.id,
          planning_input_signature: signature,
        },
      }),
    },
  );
  return {
    ...project,
    contentSpecId: resolution.data.content_spec.id,
    resolvedCreativeContext: resolution.data.resolved_creative_context,
    generationStrategyId: strategy.id,
    storyBibleInputSignature: signature,
    storyBibleStatus: undefined,
    storyBibleVersion: undefined,
  };
}

export async function generateCreativeDirections(
  project: ScriptProject,
  onAutomaticRetry?: (event: AutomaticRetryEvent) => void,
): Promise<CreativeDirectionCandidate[]> {
  if (!project.contentSpecId || !project.generationStrategyId) {
    throw new Error("当前项目尚未形成创作规格，无法生成创作方向候选。");
  }
  const customTags = new Map((project.customTags ?? []).map((item) => [item.id, item.label]));
  const selectedTagLabels = project.selectedTagIds.map((tagId) => (
    customTags.get(tagId) ?? getTag(tagId)?.labelZh ?? getTag(tagId)?.label ?? tagId
  ));
  const response = await generateWithAutomaticTransientRetry({
    generate: () => apiRequest<CreativeDirectionResponse>(
      `/story-projects/${project.id}/creative-directions/draft`,
      {
        method: "POST",
        body: JSON.stringify({
          story_project_id: project.id,
          content_spec_id: project.contentSpecId,
          generation_strategy_id: project.generationStrategyId,
          creative_prompt: (project.creativePrompt
            || referenceMaterialFallbackPrompt(project.referenceMaterials)).slice(0, 2_000),
          reference_materials: referenceMaterialsForApi(project.referenceMaterials),
          selected_tag_labels: selectedTagLabels,
          option_count: 4,
          characters: [],
        }),
      },
    ),
    onAutomaticRetry,
    wait: waitForSharedPlanningRetry,
  });
  return response.data.directions;
}

export async function loadStoryBible(
  projectId: string,
  version?: number,
): Promise<StoryBible | null> {
  const storyBibleId = storyBibleIdForProject(projectId);
  try {
    const response = await apiRequest<StoryBibleResponse>(
      `/story-projects/${projectId}/story-bibles/${storyBibleId}${version ? `?version=${version}` : ""}`,
    );
    return response.data;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export async function generateStoryBibleDraft(
  project: ScriptProject,
  onAutomaticRetry?: (event: AutomaticRetryEvent) => void,
): Promise<StoryBible> {
  if (!project.contentSpecId || !project.generationStrategyId) {
    throw new Error("当前项目尚未形成创作规格，无法生成长篇总纲。");
  }

  const customTags = new Map((project.customTags ?? []).map((item) => [item.id, item.label]));
  const selectedTagLabels = project.selectedTagIds.map((tagId) => (
    customTags.get(tagId) ?? getTag(tagId)?.labelZh ?? getTag(tagId)?.label ?? tagId
  ));
  const knownVersion = project.storyBibleVersion ?? 0;
  const response = await generateWithAutomaticTransientRetry({
    generate: async (): Promise<StoryBibleDraftResponse | { data: StoryBible }> => {
      try {
        return await apiRequest<StoryBibleDraftResponse>(
          `/story-projects/${project.id}/story-bibles/draft`,
          {
            method: "POST",
            body: JSON.stringify({
              story_project_id: project.id,
              content_spec_id: project.contentSpecId,
              generation_strategy_id: project.generationStrategyId,
              creative_prompt: (project.creativePrompt
                || referenceMaterialFallbackPrompt(project.referenceMaterials)).slice(0, 2_000),
              reference_materials: referenceMaterialsForApi(project.referenceMaterials),
              selected_tag_labels: selectedTagLabels,
              selected_creative_direction: project.selectedCreativeDirection ?? null,
              characters: [],
              target_episode_count: project.generationSettings.episodeCount,
            }),
          },
        );
      } catch (error) {
        if (!isTransientGenerationFailure(error)) throw error;
        try {
          const recovered = await loadStoryBible(project.id);
          if (
            recovered
            && recovered.status === "draft"
            && recovered.version > knownVersion
          ) return { data: recovered };
        } catch {
          // The request may have failed before commit; the bounded retry below
          // will regenerate only when no newer saved draft can be recovered.
        }
        throw error;
      }
    },
    onAutomaticRetry,
    wait: waitForSharedPlanningRetry,
  });
  if ("project_revision" in response) {
    recordProjectServerRevisions(
      project.id,
      response.project_revision,
      response.workspace_revision,
    );
  }
  return response.data;
}

export async function modifyStoryBibleDraft(
  project: ScriptProject,
  storyBible: StoryBible,
  instruction: string,
  revisionMode: PlanningRevisionMode = "targeted",
): Promise<StoryBible> {
  if (!project.generationStrategyId) {
    throw new Error("当前项目尚未形成生成策略，无法使用 AI 修改故事总纲。");
  }
  const response = await generateWithAutomaticTransientRetry({
    generate: () => apiRequest<StoryBibleResponse>(
      `/story-projects/${project.id}/story-bibles/${storyBible.story_bible_id}/modify`,
      {
        method: "POST",
        body: JSON.stringify({
          story_project_id: project.id,
          story_bible_id: storyBible.story_bible_id,
          story_bible_version: storyBible.version,
          generation_strategy_id: project.generationStrategyId,
          revision_mode: revisionMode,
          instruction: instruction.trim() || (
            revisionMode === "rewrite"
              ? "请在现有项目边界内重新构思并整体重写完整故事总纲。"
              : ""
          ),
        }),
      },
    ),
    wait: waitForSharedPlanningRetry,
  });
  return response.data;
}

export async function approveStoryBible(storyBible: StoryBible): Promise<StoryBible> {
  assertMainlandNarrative(storyBibleNarrative(storyBible));
  const approved: StoryBible = {
    ...storyBible,
    version: storyBible.version + 1,
    status: "approved",
    approved_at: new Date().toISOString(),
  };
  const response = await apiRequest<StoryBibleResponse>(
    `/story-projects/${storyBible.story_project_id}/story-bibles/`
      + `${storyBible.story_bible_id}/versions/${approved.version}`,
    {
      method: "PUT",
      body: JSON.stringify(approved),
    },
  );
  return response.data;
}

export async function saveStoryBibleDraft(storyBible: StoryBible): Promise<StoryBible> {
  assertMainlandNarrative(storyBibleNarrative(storyBible));
  const draft: StoryBible = {
    ...storyBible,
    version: storyBible.version + 1,
    status: "draft",
    approved_at: null,
  };
  const response = await apiRequest<StoryBibleResponse>(
    `/story-projects/${storyBible.story_project_id}/story-bibles/`
      + `${storyBible.story_bible_id}/versions/${draft.version}`,
    { method: "PUT", body: JSON.stringify(draft) },
  );
  return response.data;
}

export async function loadRootStoryPlanNode(
  projectId: string,
  storyBibleId: string,
  storyBibleVersion: number,
): Promise<StoryPlanNode | null> {
  const params = new URLSearchParams({
    roots_only: "true",
    story_bible_id: storyBibleId,
    story_bible_version: String(storyBibleVersion),
  });
  try {
    const response = await apiRequest<{ data: StoryPlanNode[] }>(
      `/story-projects/${projectId}/plan-nodes?${params.toString()}`,
    );
    return latestPlanningVersions(response.data, "node_id")[0] ?? null;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export async function loadChildStoryPlanNodes(
  projectId: string,
  parentNodeId: string,
  storyBibleId: string,
  storyBibleVersion: number,
  parentNodeVersion?: number,
): Promise<StoryPlanNode[]> {
  const params = new URLSearchParams({
    parent_node_id: parentNodeId,
    story_bible_id: storyBibleId,
    story_bible_version: String(storyBibleVersion),
  });
  return dedupeStoryPlanNodeRead(
    `children:${projectId}:${parentNodeId}:${parentNodeVersion ?? "latest"}:${storyBibleId}:${storyBibleVersion}`,
    async () => {
      const response = await apiRequest<{ data: StoryPlanNode[] }>(
        `/story-projects/${projectId}/plan-nodes?${params.toString()}`,
      );
      const matchingParentVersion = parentNodeVersion === undefined
        ? response.data
        : response.data.filter((item) => item.parent_node_version === parentNodeVersion);
      return latestPlanningVersions(matchingParentVersion, "node_id")
        .sort((left, right) => left.sequence_order - right.sequence_order);
    },
  );
}

export async function loadTopLevelStoryPlanNodes(
  projectId: string,
  storyBibleId: string,
  storyBibleVersion: number,
): Promise<StoryPlanNode[]> {
  const root = await loadRootStoryPlanNode(
    projectId,
    storyBibleId,
    storyBibleVersion,
  );
  if (!root) return [];
  return loadChildStoryPlanNodes(
    projectId,
    root.node_id,
    storyBibleId,
    storyBibleVersion,
    root.version,
  );
}

export function hasCompleteStoryPlanChildCoverage(
  parent: StoryPlanNode,
  children: StoryPlanNode[],
): boolean {
  return hasCompleteCoverage(parent, children, MAX_EPISODE_READY_SPAN);
}

export async function loadStoryPlanNodes(
  projectId: string,
  storyBibleId: string,
  storyBibleVersion: number,
): Promise<StoryPlanNode[]> {
  const params = new URLSearchParams({
    story_bible_id: storyBibleId,
    story_bible_version: String(storyBibleVersion),
  });
  return dedupeStoryPlanNodeRead(
    `all:${projectId}:${storyBibleId}:${storyBibleVersion}`,
    async () => {
      const response = await apiRequest<{ data: StoryPlanNode[] }>(
        `/story-projects/${projectId}/plan-nodes?${params.toString()}`,
      );
      return latestPlanningVersions(response.data, "node_id");
    },
  );
}

/**
 * Resolve only the nodes reachable from the latest root through exact parent
 * versions. Historical descendants remain in storage, but must never drive
 * script readiness after an ancestor creates a new version.
 */
export async function loadActiveStoryPlanNodes(
  projectId: string,
  storyBibleId: string,
  storyBibleVersion: number,
): Promise<StoryPlanNode[]> {
  const root = await loadRootStoryPlanNode(projectId, storyBibleId, storyBibleVersion);
  if (!root) return [];
  const active: StoryPlanNode[] = [root];
  let frontier: StoryPlanNode[] = [root];
  while (frontier.length) {
    const levels = await Promise.all(frontier.map((parent) => (
      loadChildStoryPlanNodes(
        projectId,
        parent.node_id,
        storyBibleId,
        storyBibleVersion,
        parent.version,
      )
    )));
    frontier = levels.flat();
    active.push(...frontier);
  }
  return active;
}

export async function generateStoryPlanNodeDraft(
  project: ScriptProject,
  storyBible: StoryBible,
): Promise<StoryPlanNode> {
  if (!project.generationStrategyId) {
    throw new Error("当前项目尚未形成生成策略，无法生成剧情规划。");
  }
  const response = await generateWithAutomaticTransientRetry({
    generate: () => apiRequest<StoryPlanNodeResponse>(
      `/story-projects/${project.id}/plan-nodes/draft`,
      {
        method: "POST",
        body: JSON.stringify({
          story_project_id: project.id,
          story_bible_id: storyBible.story_bible_id,
          story_bible_version: storyBible.version,
          generation_strategy_id: project.generationStrategyId,
          sequence_order: 1,
          target_episode_count: project.generationSettings.episodeCount,
        }),
      },
    ),
    wait: waitForSharedPlanningRetry,
  });
  return response.data;
}

export async function generateTopLevelStoryPlanNodes(
  project: ScriptProject,
  storyBible: StoryBible,
): Promise<StoryPlanNode[]> {
  if (!project.generationStrategyId) {
    throw new Error("当前项目尚未形成生成策略，无法生成剧情规划。");
  }
  const path = `/story-projects/${project.id}/plan-nodes/top-level/draft`;
  const init = {
    method: "POST",
    body: JSON.stringify({
      story_project_id: project.id,
      story_bible_id: storyBible.story_bible_id,
      story_bible_version: storyBible.version,
      generation_strategy_id: project.generationStrategyId,
      sequence_order: 1,
      target_episode_count: project.generationSettings.episodeCount,
    }),
  } satisfies RequestInit;
  const response = await generateWithAutomaticTransientRetry({
    generate: async (): Promise<{ data: StoryPlanNode[] }> => {
      try {
        return await apiRequest<{ data: StoryPlanNode[] }>(path, init);
      } catch (error) {
        if (!isTransientGenerationFailure(error)) throw error;
        try {
          // A response can be lost after the backend has already committed
          // children. Recover a complete checkpoint before regenerating.
          const recovered = await loadTopLevelStoryPlanNodes(
            project.id,
            storyBible.story_bible_id,
            storyBible.version,
          );
          const recoveredRoot = await loadRootStoryPlanNode(
            project.id,
            storyBible.story_bible_id,
            storyBible.version,
          );
          if (
            recoveredRoot
            && hasCompleteStoryPlanChildCoverage(recoveredRoot, recovered)
          ) return { data: recovered };
        } catch {
          // No complete checkpoint exists yet; retry only this top-level unit.
        }
        throw error;
      }
    },
    wait: waitForSharedPlanningRetry,
  });
  const root = await loadRootStoryPlanNode(
    project.id,
    storyBible.story_bible_id,
    storyBible.version,
  );
  if (!root || !hasCompleteStoryPlanChildCoverage(root, response.data)) {
    throw new Error("顶层剧情分支只保存了部分范围，请继续一键拆分以补齐该层。");
  }
  return response.data.sort((left, right) => left.sequence_order - right.sequence_order);
}

export async function approveStoryPlanNode(
  node: StoryPlanNode,
  descendantPolicy: DescendantRevisionPolicy = "invalidate",
): Promise<StoryPlanNode> {
  assertMainlandNarrative(storyPlanNodeNarrative(node));
  const episodeSpan = storyPlanNodeEpisodeSpan(node);
  if (
    episodeSpan !== null
    && (episodeSpan < MIN_EPISODE_READY_SPAN || (episodeSpan >= 13 && episodeSpan <= 15))
  ) {
    throw new Error("该节点处于1至7集或13至15集的不可拆分碎片区间，请返回父层，与相邻分支一起调整完整剧情事件、状态交接和集数边界。");
  }
  if (
    episodeSpan !== null
    && episodeSpan <= MAX_EPISODE_READY_SPAN
    && (
      (node.unit_story_beats ?? []).length < 4
      || !node.unit_resolution
      || !node.handoff_pressure
    )
  ) {
    throw new Error("最小剧情单元尚未讲完整：至少需要四个因果事件、单位剧情结算和下一段交接压力。");
  }
  const approved: StoryPlanNode = {
    ...node,
    version: node.version + 1,
    status: "approved",
    expansion_status: episodeSpan !== null
      && episodeSpan >= MIN_EPISODE_READY_SPAN
      && episodeSpan <= MAX_EPISODE_READY_SPAN
      ? "episode_ready"
      : "expanded",
    approved_at: new Date().toISOString(),
  };
  const response = await apiRequest<StoryPlanNodeResponse>(
    `/story-projects/${node.story_project_id}/plan-nodes/${node.node_id}/versions/${approved.version}`
      + `?descendant_policy=${descendantPolicy}`,
    { method: "PUT", body: JSON.stringify(approved) },
  );
  return response.data;
}

export type DescendantRevisionPolicy = "invalidate" | "rebase";

export async function saveStoryPlanNodeDraft(
  node: StoryPlanNode,
  descendantPolicy: DescendantRevisionPolicy = "invalidate",
): Promise<StoryPlanNode> {
  assertMainlandNarrative(storyPlanNodeNarrative(node));
  const draft: StoryPlanNode = {
    ...node,
    version: node.version + 1,
    status: "draft",
    approved_at: null,
  };
  const response = await apiRequest<StoryPlanNodeResponse>(
    `/story-projects/${node.story_project_id}/plan-nodes/${node.node_id}/versions/${draft.version}`
      + `?descendant_policy=${descendantPolicy}`,
    { method: "PUT", body: JSON.stringify(draft) },
  );
  return response.data;
}

export async function modifyStoryPlanNode(
  project: ScriptProject,
  node: StoryPlanNode,
  instruction: string,
  revisionMode: PlanningRevisionMode = "targeted",
): Promise<StoryPlanNode> {
  if (!project.generationStrategyId) {
    throw new Error("当前项目尚未形成生成策略，无法使用 AI 修改剧情树节点。");
  }
  const response = await generateWithAutomaticTransientRetry({
    generate: () => apiRequest<StoryPlanNodeResponse>(
      `/story-projects/${project.id}/plan-nodes/${node.node_id}/modify`,
      {
        method: "POST",
        body: JSON.stringify({
          story_project_id: project.id,
          node_id: node.node_id,
          node_version: node.version,
          generation_strategy_id: project.generationStrategyId,
          revision_mode: revisionMode,
          instruction: instruction.trim() || (
            revisionMode === "rewrite"
              ? "请在固定的剧情树位置、集数范围和连续性边界内整体重写这个剧情部分。"
              : ""
          ),
        }),
      },
    ),
    wait: waitForSharedPlanningRetry,
  });
  return response.data;
}

export type PlanningRevisionMode = "targeted" | "rewrite";

export async function decomposeStoryPlanNode(
  project: ScriptProject,
  node: StoryPlanNode,
  requestedChildCount?: number,
): Promise<StoryPlanNode[]> {
  if (!project.generationStrategyId) {
    throw new Error("当前项目尚未形成生成策略，无法拆分剧情规划。");
  }
  return generateWithAutomaticTransientRetry({
    generate: async () => {
      try {
        const response = await apiRequest<{ data: StoryPlanNode[] }>(
          `/story-projects/${project.id}/plan-nodes/${node.node_id}/decompose`,
          {
            method: "POST",
            body: JSON.stringify({
              story_project_id: project.id,
              parent_node_id: node.node_id,
              parent_node_version: node.version,
              generation_strategy_id: project.generationStrategyId,
              ...(requestedChildCount === undefined
                ? {}
                : { requested_child_count: requestedChildCount }),
              max_episode_ready_span: MAX_EPISODE_READY_SPAN,
            }),
          },
        );
        if (!hasCompleteStoryPlanChildCoverage(node, response.data)) {
          throw new Error("剧情分支只保存了部分范围，系统未将其视为完成；请继续一键拆分以补齐该层。");
        }
        return response.data;
      } catch (error) {
        if (!isTransientGenerationFailure(error)) throw error;
        try {
          const recovered = await loadChildStoryPlanNodes(
            project.id,
            node.node_id,
            node.story_bible_id,
            node.story_bible_version,
            node.version,
          );
          if (hasCompleteStoryPlanChildCoverage(node, recovered)) return recovered;
        } catch {
          // No complete checkpoint exists yet; retry only this parent node.
        }
        throw error;
      }
    },
    wait: waitForSharedPlanningRetry,
  });
}

export async function loadEpisodePlans(
  projectId: string,
  storyBibleId: string,
  storyBibleVersion: number,
  startEpisode?: number,
  endEpisode?: number,
): Promise<EpisodePlan[]> {
  const params = new URLSearchParams({
    story_bible_id: storyBibleId,
    story_bible_version: String(storyBibleVersion),
  });
  if (startEpisode !== undefined) params.set("start_episode", String(startEpisode));
  if (endEpisode !== undefined) params.set("end_episode", String(endEpisode));
  const query = params.toString();
  const response = await apiRequest<{ data: EpisodePlan[] }>(
    `/story-projects/${projectId}/episode-plans${query ? `?${query}` : ""}`,
  );
  const latestByEpisode = new Map<number, EpisodePlan>();
  for (const plan of response.data) {
    const current = latestByEpisode.get(plan.episode_number);
    if (!current || plan.version > current.version) {
      latestByEpisode.set(plan.episode_number, plan);
    }
  }
  return Array.from(latestByEpisode.values()).sort(
    (left, right) => left.episode_number - right.episode_number,
  );
}

function latestPlanningVersions<T extends { version: number }>(
  items: T[],
  identityField: keyof T,
): T[] {
  const latest = new Map<T[keyof T], T>();
  for (const item of items) {
    const identity = item[identityField];
    const current = latest.get(identity);
    if (!current || item.version > current.version) {
      latest.set(identity, item);
    }
  }
  return Array.from(latest.values());
}

export async function generateEpisodePlanBatch(
  project: ScriptProject,
  node: StoryPlanNode,
  onCheckpoint?: (plan: EpisodeRoadmapItem) => Promise<void> | void,
  beforeNextEpisode?: () => Promise<void> | void,
): Promise<EpisodeRoadmapItem[]> {
  if (!project.generationStrategyId) {
    throw new Error("当前项目尚未形成生成策略，无法生成分集计划。");
  }
  const episodeSpan = storyPlanNodeEpisodeSpan(node);
  if (
    episodeSpan === null
    || episodeSpan < MIN_EPISODE_READY_SPAN
    || episodeSpan > MAX_EPISODE_READY_SPAN
  ) {
    throw new Error("可进入正文的剧情叶节点必须覆盖8至12集；过短节点需返回父层与相邻分支协调整段剧情，过长节点需继续拆分。");
  }
  if (node.planned_start_episode === null || node.planned_end_episode === null) {
    throw new Error("可进入正文的剧情叶节点必须定义完整集数范围。");
  }
  const predecessorPlan = episodeRoadmapPredecessor(project, node);
  const existing = (project.episodeRoadmaps ?? [])
    .filter((item) => (
      item.source_node_id === node.node_id
      && item.source_node_version === node.version
      && item.story_bible_version === node.story_bible_version
    ))
    .sort((left, right) => left.episode_number - right.episode_number);
  const accepted: EpisodeRoadmapItem[] = [];
  for (let episodeNumber = node.planned_start_episode;
    episodeNumber <= node.planned_end_episode;
    episodeNumber += 1) {
    const saved = existing.find((item) => item.episode_number === episodeNumber);
    if (!saved) break;
    accepted.push(saved);
  }

  for (let episodeNumber = node.planned_start_episode + accepted.length;
    episodeNumber <= node.planned_end_episode;
    episodeNumber += 1) {
    await beforeNextEpisode?.();
    const alreadySaved = existing.find((item) => item.episode_number === episodeNumber);
    if (alreadySaved) {
      accepted.push(alreadySaved);
      continue;
    }
    const response = await generateWithFailurePolicy({
      generate: () => apiRequest<{ data: RoadmapApiItem }>(
        `/story-projects/${project.id}/plan-nodes/${node.node_id}/episode-plans/${episodeNumber}/draft`,
        {
          method: "POST",
          body: JSON.stringify({
            story_project_id: project.id,
            source_node_id: node.node_id,
            source_node_version: node.version,
            generation_strategy_id: project.generationStrategyId,
            episode_number: episodeNumber,
            predecessor_plan: predecessorPlan
              ? roadmapItemForApi(predecessorPlan)
              : null,
            accepted_plans: accepted.map(roadmapItemForApi),
          }),
        },
      ),
      mode: "automatic",
      shouldRetry: isTransientGenerationFailure,
      retryDelay: roadmapRetryDelayMs,
      maxAutomaticAttempts: 3,
      wait: waitForSharedPlanningRetry,
    });
    const checkpoint: EpisodeRoadmapItem = {
      ...response.data,
      source_node_id: node.node_id,
      source_node_version: node.version,
      story_bible_version: node.story_bible_version,
      status: "draft",
    };
    accepted.push(checkpoint);
    await onCheckpoint?.(checkpoint);
  }
  return accepted;
}

type RoadmapApiItem = Omit<EpisodeRoadmapItem,
  "source_node_id" | "source_node_version" | "story_bible_version" | "status">;

function roadmapItemForApi(item: EpisodeRoadmapItem): RoadmapApiItem {
  const {
    source_node_id: _sourceNodeId,
    source_node_version: _sourceNodeVersion,
    story_bible_version: _storyBibleVersion,
    status: _status,
    ...apiItem
  } = item;
  return apiItem;
}

export async function modifyEpisodePlanItem(
  project: ScriptProject,
  node: StoryPlanNode,
  item: EpisodeRoadmapItem,
  acceptedPlans: EpisodeRoadmapItem[],
  instruction: string,
  revisionMode: PlanningRevisionMode = "targeted",
): Promise<EpisodeRoadmapItem> {
  if (!project.generationStrategyId) {
    throw new Error("当前项目尚未形成生成策略，无法使用 AI 修改分集路线图。");
  }
  const predecessorPlan = episodeRoadmapPredecessor(project, node);
  const response = await generateWithAutomaticTransientRetry({
    generate: () => apiRequest<{ data: RoadmapApiItem }>(
      `/story-projects/${project.id}/plan-nodes/${node.node_id}`
        + `/episode-plans/${item.episode_number}/modify`,
      {
        method: "POST",
        body: JSON.stringify({
          story_project_id: project.id,
          source_node_id: node.node_id,
          source_node_version: node.version,
          generation_strategy_id: project.generationStrategyId,
          episode_number: item.episode_number,
          predecessor_plan: predecessorPlan
            ? roadmapItemForApi(predecessorPlan)
            : null,
          accepted_plans: acceptedPlans.map(roadmapItemForApi),
          current_plan: roadmapItemForApi(item),
          revision_mode: revisionMode,
          instruction: instruction.trim() || (
            revisionMode === "rewrite"
              ? "请保持本集位置、连续性引用和因果职责，整体重写这一集的路线图。"
              : ""
          ),
        }),
      },
    ),
    wait: waitForSharedPlanningRetry,
  });
  return {
    ...response.data,
    source_node_id: node.node_id,
    source_node_version: node.version,
    story_bible_version: node.story_bible_version,
    status: "draft",
  };
}

function episodeRoadmapPredecessor(
  project: ScriptProject,
  node: StoryPlanNode,
): EpisodeRoadmapItem | undefined {
  if (node.planned_start_episode === null || node.planned_start_episode <= 1) {
    return undefined;
  }
  const predecessorEpisode = node.planned_start_episode - 1;
  const candidates = (project.episodeRoadmaps ?? []).filter((item) => (
    item.story_bible_version === node.story_bible_version
    && item.episode_number === predecessorEpisode
  ));
  return candidates[candidates.length - 1];
}

export async function approveEpisodePlan(plan: EpisodePlan): Promise<EpisodePlan> {
  assertMainlandNarrative(episodePlanNarrative(plan));
  const approved = {
    ...plan,
    version: plan.version + 1,
    status: "approved" as const,
    approved_at: new Date().toISOString(),
  };
  const response = await apiRequest<{ data: EpisodePlan }>(
    `/story-projects/${plan.story_project_id}/episode-plans/${plan.episode_plan_id}/versions/${approved.version}`,
    { method: "PUT", body: JSON.stringify(approved) },
  );
  return response.data;
}

export async function saveEpisodePlanDraft(plan: EpisodePlan): Promise<EpisodePlan> {
  assertMainlandNarrative(episodePlanNarrative(plan));
  const draft: EpisodePlan = {
    ...plan,
    version: plan.version + 1,
    status: "draft",
    approved_at: null,
  };
  const response = await apiRequest<{ data: EpisodePlan }>(
    `/story-projects/${plan.story_project_id}/episode-plans/${plan.episode_plan_id}/versions/${draft.version}`,
    { method: "PUT", body: JSON.stringify(draft) },
  );
  return response.data;
}

export function storyBibleIdForProject(projectId: string): string {
  return `story_bible.${projectId.replace(/[^a-zA-Z0-9_.:-]/g, "-")}.main`;
}

type MainlandNarrativeField = {
  path: string;
  value: string;
};

function narrativeField(path: string, value: string | null | undefined): MainlandNarrativeField {
  return { path, value: value ?? "" };
}

function storyBibleNarrative(storyBible: StoryBible): MainlandNarrativeField[] {
  return [
    narrativeField("剧名", storyBible.project_title),
    narrativeField("核心前提", storyBible.core_premise),
    narrativeField("全剧目标", storyBible.series_goal),
    narrativeField("主题", storyBible.theme),
    narrativeField("核心冲突", storyBible.central_conflict),
    narrativeField("结局方向", storyBible.ending_direction),
    ...storyBible.world_rules.map((value, index) => narrativeField(`世界规则 ${index + 1}`, value)),
    ...storyBible.locked_facts.map((value, index) => narrativeField(`锁定事实 ${index + 1}`, value)),
    ...storyBible.avoid_patterns.map((value, index) => narrativeField(`规避模式 ${index + 1}`, value)),
    ...storyBible.story_lines.flatMap((line, index) => [
      narrativeField(`故事线 ${index + 1} 标题`, line.title),
      narrativeField(`故事线 ${index + 1} 前提`, line.premise),
      narrativeField(`故事线 ${index + 1} 收束方向`, line.planned_resolution),
    ]),
    ...(storyBible.escalation_stages ?? []).flatMap((stage, index) => [
      narrativeField(`升级阶段 ${index + 1} 标题`, stage.title),
      narrativeField(`升级阶段 ${index + 1} 目标`, stage.stage_goal),
      narrativeField(`升级阶段 ${index + 1} 阻力`, stage.stage_opposition),
      narrativeField(`升级阶段 ${index + 1} 回报`, stage.stage_payoff),
      narrativeField(`升级阶段 ${index + 1} 衔接`, stage.escalation_to_next),
    ]),
  ];
}

function storyPlanNodeNarrative(node: StoryPlanNode): MainlandNarrativeField[] {
  return [
    narrativeField("标题", node.title),
    narrativeField("叙事目的", node.narrative_purpose),
    narrativeField("剧情概述", node.synopsis),
    narrativeField("进入状态", node.entry_state),
    narrativeField("核心冲突", node.central_conflict),
    ...node.turning_points.map((value, index) => narrativeField(`转折点 ${index + 1}`, value)),
    narrativeField("情绪方向", node.emotional_direction),
    narrativeField("退出状态", node.exit_state),
    ...(node.unit_story_beats ?? []).map((value, index) => narrativeField(`单位剧情事件 ${index + 1}`, value)),
    narrativeField("单位剧情结算", node.unit_resolution),
    narrativeField("交接压力", node.handoff_pressure),
    narrativeField("拆分理由", node.decomposition_reason),
  ];
}

function episodePlanNarrative(plan: EpisodePlan): MainlandNarrativeField[] {
  return [
    narrativeField("本集目标", plan.episode_goal),
    narrativeField("进入状态", plan.entry_state),
    narrativeField("核心冲突", plan.central_conflict),
    narrativeField("主角决定", plan.protagonist_decision),
    narrativeField("揭示", plan.reveal),
    narrativeField("情绪变化", plan.emotional_movement),
    narrativeField("退出状态", plan.exit_state),
    narrativeField("悬念", plan.cliffhanger),
    ...plan.continuity_requirements.map((value, index) => (
      narrativeField(`连续性要求 ${index + 1}`, value)
    )),
    ...(plan.source_turning_points ?? []).map((value, index) => (
      narrativeField(`来源转折点 ${index + 1}`, value)
    )),
    ...(plan.source_unit_story_beats ?? []).map((value, index) => (
      narrativeField(`来源单位剧情事件 ${index + 1}`, value)
    )),
  ];
}

function assertMainlandNarrative(fields: MainlandNarrativeField[]): void {
  if (CURRENT_MARKET_PROFILE !== "cn_mainland") return;
  const issues = fields.filter((field) => mainlandTextIsEnglishDominant(field.value));
  if (!issues.length) return;
  const issueSummary = issues.slice(0, 5).map((field) => field.path).join("、");
  throw new Error(
    `以下规划字段疑似以英文为主：${issueSummary}。请改为中文主体；AI、DNA、KPI、型号和少量必要专名可以保留。`,
  );
}
