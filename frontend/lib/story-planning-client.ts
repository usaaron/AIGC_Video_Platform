import { planningRevisionEpoch, isPlanningRevisionActive } from "@/lib/planning-revision";
import { ApiError, apiRequest } from "@/lib/api-client";
import { copilotRequest, type CopilotProgressObserver } from "@/lib/copilot-client";
import {
  type AutomaticRetryEvent,
  generateWithAutomaticTransientRetry,
  generateWithFailurePolicy,
  isTransientGenerationFailure,
  MAX_EPISODE_ROADMAP_API_ATTEMPTS,
  roadmapRetryDelayMs,
} from "@/lib/generation-retry";
import {
  MAX_EPISODE_READY_SPAN,
  MIN_EPISODE_READY_SPAN,
  storyPlanNodeEpisodeSpan,
} from "@/lib/episode-generation-planning";
import { hasCompleteStoryPlanChildCoverage as hasCompleteCoverage } from "@/lib/story-plan-coverage";
import {
  buildEpisodePlanningMemory,
  buildDraftPlanningHandoffs,
} from "@/lib/episode-planning-memory";
export { buildEpisodePlanningMemory } from "@/lib/episode-planning-memory";
import {
  getClientInstanceId,
  recordProjectServerRevisions,
  planningSessionFromRemote as planningSessionFromApi,
  type PlanningSessionResponse as SharedPlanningSessionResponse,
} from "@/lib/project-sync";
import { normalizeEpisodeDurationSeconds } from "@/lib/generation-planning";
import type { EpisodePlanMaterializationDraft } from "@/lib/episode-plan-materializer";
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
  storyPlanningInputSignature,
} from "@/lib/story-planning-signature";
import { projectTagLabels, resolveProjectTagSelection } from "@/lib/tag-catalog";
import { CreatorNarrativeLanguageError, mainlandTextIsEnglishDominant } from "@/lib/mainland-language";
import { ACTING_PROFILE_FIELDS, ACTING_PROFILE_LABELS } from "@/lib/character-acting-profile";
import {
  boundStoryBibleAuthorInstruction,
  seedInspirationBriefFromInput,
  importedPlanningInstruction,
  shouldApplyImportedPlanningConstraints,
  shouldApplyImportedStoryBibleConstraints,
} from "@/lib/input-readiness-workflow";
import { isApprovedEpisodeRoadmap } from "@/lib/planning-coverage";
import { requireCompleteSynopsisText, synopsisHasPendingChanges } from "@/lib/story-synopsis-context";
import { synopsisNotesForRequest } from "@/lib/story-synopsis-notes";
import { synopsisSourceProject } from "@/lib/story-synopsis-source";
import { creativePromptWithOverseasProfile, overseasStoryProfileForApi, overseasStoryProfilePrompt } from "@/lib/overseas-story-profile";
import { OverseasVoiceSampleError, overseasVoiceValidationText } from "@/lib/overseas-voice-samples";
import {
  marketProfileForReleaseRegion,
  type CreativeDirectionCandidate,
  type EndingMode,
  type EpisodeRoadmapItem,
  type FutureRoadmapRebuildReceipt,
  type EpisodePlanMaterializationReceipt,
  type EpisodeDramaticUnit,
  type PlanningSession,
  type ScriptProject,
  type StoryBibleInteractiveCandidate,
  type StoryBibleInteractiveStep,
  type CreativeDecisionRecord,
  type StoryInspirationBrief,
  type StoryInspirationFrontierQuestion,
  type StoryInspirationMessage,
  type StorySynopsisReview,
  type StoryTreeQualityAudit,
  type StoryPlanExecutionHandoff,
} from "@/lib/types";

type PlanningSessionApi = SharedPlanningSessionResponse["data"] & {
  client_instance_id: string;
  payload_checksum: string;
  payload_size_bytes: number;
};

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
interface StoryPlanningCatalog {
  nodes: OntologyNode[];
  profiles: PlatformProfile[];
  strategies: GenerationStrategySummary[];
}
interface StoryBibleResponse { data: StoryBible }
interface StoryBibleInteractiveStepResponse {
  data: {
    step: StoryBibleInteractiveStep;
    question: string;
    candidates: StoryBibleInteractiveCandidate[];
  };
}

function planningAuthorInstruction(
  project: ScriptProject,
  authorInstruction = "",
): string {
  return [
    authorInstruction.trim(),
    shouldApplyImportedPlanningConstraints(project) ? importedPlanningInstruction() : "",
  ].filter(Boolean).join("\n");
}

function storyPlanningSourcePayload(
  project: ScriptProject,
  maxPromptCharacters: number,
) {
  return {
    creative_prompt: creativePromptWithOverseasProfile(
      project.creativePrompt || referenceMaterialFallbackPrompt(project.referenceMaterials),
      project.generationSettings, maxPromptCharacters,
    ),
    reference_materials: referenceMaterialsForApi(project.referenceMaterials),
    selected_tag_labels: projectTagLabels(project),
  };
}
interface StoryInspirationChatResponse {
  data: {
    assistant_message: string;
    questions: StoryInspirationFrontierQuestion[];
    brief: StoryInspirationBrief;
    ready_to_generate: boolean;
  };
}

interface StorySynopsisDraftResponse {
  data: { text: string; review: StorySynopsisReview };
}

const interactiveStoryBibleRequests = new Map<
  string,
  Promise<StoryBibleInteractiveStepResponse["data"]>
>();
interface CreativeDirectionResponse {
  data: { directions: CreativeDirectionCandidate[] };
}
interface StoryBibleDraftResponse extends StoryBibleResponse {
  project_revision: number;
  workspace_revision: number | null;
}

interface StoryPlanNodeResponse { data: StoryPlanNode }

interface PlanningSessionResponse { data: PlanningSessionApi }
type PlanningSessionPayload = Omit<
  PlanningSessionApi,
  "client_instance_id" | "payload_checksum" | "payload_size_bytes"
>;

function planningSessionToApi(session: PlanningSession, projectId: string): PlanningSessionPayload {
  return {
    schema_version: session.schemaVersion,
    session_id: session.sessionId,
    story_project_id: session.storyProjectId ?? projectId,
    revision: session.revision ?? 1,
    phase: session.phase,
    status: session.status,
    story_bible_author_instruction: session.storyBibleAuthorInstruction,
    tree_author_instruction: session.treeAuthorInstruction,
    story_bible_step: session.storyBibleStep,
    story_bible_sections: session.storyBibleSections ?? {},
    active_node_id: session.activeNodeId ?? null,
    reviewed_node_ids: [...session.reviewedNodeIds],
    turns: session.turns.map((turn) => ({
      turn_id: turn.turnId,
      scope: turn.scope,
      node_id: turn.nodeId ?? null,
      instruction: turn.instruction,
      selected_candidate_titles: [...(turn.selectedCandidateTitles ?? [])],
      outcome: turn.outcome,
      created_at: turn.createdAt,
    })),
    started_at: session.startedAt ?? null,
    updated_at: session.updatedAt,
  };
}

const planningSessionSaveQueues = new Map<string, Promise<PlanningSession>>();
const planningSessionSnapshots = new Map<string, PlanningSession | null>();
const pendingPlanningSessionReads = new Map<string, Promise<PlanningSession | null>>();

export async function loadPlanningSession(projectId: string): Promise<PlanningSession | null> {
  const pending = pendingPlanningSessionReads.get(projectId);
  if (pending) return pending;
  let request!: Promise<PlanningSession | null>;
  request = apiRequest<PlanningSessionResponse>(
    `/story-projects/${projectId}/planning-session`,
  )
    .then((response) => planningSessionFromApi(response.data))
    .catch((error) => {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    })
    .then((session) => {
      planningSessionSnapshots.set(projectId, session);
      return session;
    })
    .finally(() => {
      if (pendingPlanningSessionReads.get(projectId) === request) {
        pendingPlanningSessionReads.delete(projectId);
      }
    });
  pendingPlanningSessionReads.set(projectId, request);
  return request;
}

function mergePlanningSessionForRetry(
  local: PlanningSession,
  remote: PlanningSession,
): PlanningSession {
  const turns = new Map(remote.turns.map((turn) => [turn.turnId, turn]));
  local.turns.forEach((turn) => turns.set(turn.turnId, turn));
  return {
    ...remote,
    ...local,
    revision: remote.revision ? remote.revision + 1 : 1,
    storyBibleSections: {
      ...(remote.storyBibleSections ?? {}),
      ...(local.storyBibleSections ?? {}),
    },
    turns: [...turns.values()],
    updatedAt: new Date().toISOString(),
  };
}

async function putPlanningSession(
  projectId: string,
  session: PlanningSession,
  epoch = 0,
): Promise<PlanningSession> {
  const response = await apiRequest<PlanningSessionResponse>(
    `/story-projects/${projectId}/planning-session`,
    {
      method: "PUT",
      body: JSON.stringify({
        schema_version: "v1",
        project_id: projectId,
        client_instance_id: getClientInstanceId(),
        planning_revision_epoch: epoch,
        session: planningSessionToApi(session, projectId),
      }),
    },
  );
  const saved = planningSessionFromApi(response.data);
  planningSessionSnapshots.set(projectId, saved);
  return saved;
}

export async function savePlanningSession(
  project: Pick<ScriptProject, "id" | "planningRevisionEpoch" | "planningRevision">,
  session: PlanningSession,
): Promise<PlanningSession> {
  if (isPlanningRevisionActive(project)) throw new Error("后续规划修订期间保留原会话，请保存修订草稿。");
  const epoch = planningRevisionEpoch(project);
  const previous = planningSessionSaveQueues.get(project.id);
  const queued = (previous ?? Promise.resolve(null))
    .catch(() => null)
    .then(async (latest) => {
      // Reuse the last acknowledged revision. A stale tab is still safe: its
      // direct PUT receives 409 and rebases against the authoritative row.
      const hasSnapshot = planningSessionSnapshots.has(project.id);
      const snapshot = latest
        ?? (hasSnapshot ? planningSessionSnapshots.get(project.id) : undefined)
        ?? (session.revision ? session : undefined);
      const remote = snapshot === undefined
        ? await loadPlanningSession(project.id)
        : snapshot;
      let nextSession = remote
        ? mergePlanningSessionForRetry(session, remote)
        : { ...session, revision: 1 };
      try {
        return await putPlanningSession(project.id, nextSession, epoch);
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 409) throw error;
        // Epoch/transition conflicts are not ordinary session revision races.
        const workspace = await apiRequest<{ data: { workspace_payload: ScriptProject } }>(`/story-projects/${project.id}/workspace`);
        if (planningRevisionEpoch(workspace.data.workspace_payload) !== epoch
          || isPlanningRevisionActive(workspace.data.workspace_payload)) throw error;
        // Another tab or an older in-flight request may have won the race
        // between the GET and PUT. Rebase once against the authoritative row.
        const fresh = await loadPlanningSession(project.id);
        if (!fresh) throw error;
        nextSession = mergePlanningSessionForRetry(session, fresh);
        return putPlanningSession(project.id, nextSession, epoch);
      }
    });
  planningSessionSaveQueues.set(project.id, queued);
  return queued.finally(() => {
    if (planningSessionSaveQueues.get(project.id) === queued) {
      planningSessionSaveQueues.delete(project.id);
    }
  });
}

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
  character_registry: Array<{ character_ref: string; name: string; role: string; acting_profile?: import("./types").CharacterActingProfile | null }>;
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
  creative_decisions: CreativeDecisionRecord[];
  imported_source_document?: string | null;
  created_at: string;
  approved_at: string | null;
}

export interface StoryBibleSelectionContext {
  source_field: string;
  selected_text: string;
  before_text: string;
  after_text: string;
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
  parent_event_bindings?: {
    parent_event_index: number;
    child_event_indices: number[];
  }[];
  episode_developments?: {
    episode_number: number;
    synopsis: string;
    entry_state: string;
    exit_state: string;
    source_turning_points: string[];
    source_unit_story_beats: string[];
  }[];
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
  ending_mode?: EndingMode;
  episode_title?: string | null;
  synopsis?: string | null;
  locations?: string[];
  episode_goal: string;
  entry_state: string;
  central_conflict: string;
  protagonist_decision: string;
  reveal: string | null;
  emotional_movement: string;
  dramatic_units?: EpisodeDramaticUnit[];
  protagonist_cost?: string | null;
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

  const catalog = await loadStoryPlanningCatalog();
  const activeNodes = catalog.nodes.filter((node) => node.is_active);
  const { systemTagIds, creativeTagLabels: customTagLabels } = resolveProjectTagSelection(project, catalog.nodes);
  if (!hasUsableCreativeSource(project.creativePrompt, project.referenceMaterials) && systemTagIds.length === 0) {
    throw new Error("仅使用“我的标签”时，需要补充创作描述或选择至少一个系统标签。");
  }
  const projectMarketProfile = marketProfileForReleaseRegion(
    project.generationSettings.releaseRegion,
  );
  const platform = catalog.profiles.find(
    (item) => item.metadata?.runtime_status === "active"
      && item.metadata?.market_profile === projectMarketProfile,
  );
  const isMainlandMarket = projectMarketProfile === "cn_mainland";
  if (!platform) {
    throw new Error(
      isMainlandMarket
        ? "当前中国大陆市场配置不可用，请重新初始化运行资源。"
        : "当前海外市场配置不可用，请重新初始化运行资源。",
    );
  }
  const platformName = platform.platform_name.trim().toLowerCase();
  const selectedTagIds = new Set(systemTagIds);
  const strategy = catalog.strategies
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
    ?? catalog.strategies.find((item) => (
      item.status === "active"
      && item.target_platform.trim().toLowerCase() === platformName
    ));
  if (!strategy) {
    throw new Error(
      isMainlandMarket
        ? "后端没有可用的中国大陆生成策略。"
        : "后端没有可用的海外生成策略。",
    );
  }

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
          summary: isMainlandMarket
            ? "中国大陆连载漫剧与网络故事受众"
            : "英语母语的海外/国际连载漫剧与网络故事受众",
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
          objective: isMainlandMarket
            ? "生成可递归规划的中国大陆中文长篇故事母本"
            : "生成可递归规划的海外英语文化语境长篇故事母本",
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
            overseasStoryProfilePrompt(project.generationSettings),
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
          ...(overseasStoryProfileForApi(project.generationSettings)
            ? { overseas_story_profile: overseasStoryProfileForApi(project.generationSettings) } : {}),
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

const STORY_PLANNING_CATALOG_TTL_MS = 5 * 60_000;
let storyPlanningCatalogCache: {
  expiresAt: number;
  value: StoryPlanningCatalog;
} | null = null;
let pendingStoryPlanningCatalog: Promise<StoryPlanningCatalog> | null = null;

async function loadStoryPlanningCatalog(): Promise<StoryPlanningCatalog> {
  if (storyPlanningCatalogCache && storyPlanningCatalogCache.expiresAt > Date.now()) {
    return storyPlanningCatalogCache.value;
  }
  if (pendingStoryPlanningCatalog) return pendingStoryPlanningCatalog;
  const request = Promise.all([
    apiRequest<ApiList<OntologyNode>>("/ontology-nodes"),
    apiRequest<ApiList<PlatformProfile>>("/platform-profiles"),
    apiRequest<ApiList<GenerationStrategySummary>>("/generation-strategies"),
  ]).then(([nodes, profiles, strategies]) => {
    const value = {
      nodes: nodes.data,
      profiles: profiles.data,
      strategies: strategies.data,
    };
    storyPlanningCatalogCache = {
      expiresAt: Date.now() + STORY_PLANNING_CATALOG_TTL_MS,
      value,
    };
    return value;
  });
  pendingStoryPlanningCatalog = request;
  try {
    return await request;
  } finally {
    if (pendingStoryPlanningCatalog === request) pendingStoryPlanningCatalog = null;
  }
}

export async function generateCreativeDirections(
  project: ScriptProject,
  onAutomaticRetry?: (event: AutomaticRetryEvent) => void,
): Promise<CreativeDirectionCandidate[]> {
  if (!project.contentSpecId || !project.generationStrategyId) {
    throw new Error("当前项目尚未形成创作规格，无法生成创作方向候选。");
  }
  const response = await generateWithAutomaticTransientRetry({
    generate: () => apiRequest<CreativeDirectionResponse>(
      `/story-projects/${project.id}/creative-directions/draft`,
      {
        method: "POST",
        body: JSON.stringify({
          story_project_id: project.id,
          content_spec_id: project.contentSpecId,
          generation_strategy_id: project.generationStrategyId,
          ...storyPlanningSourcePayload(project, 2_000),
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
  authorInstruction = "",
  signal?: AbortSignal,
  creativeDecisions: CreativeDecisionRecord[] = [],
): Promise<StoryBible> {
  return requestStoryBibleDraft(
    project,
    onAutomaticRetry,
    authorInstruction,
    signal,
    creativeDecisions,
    false,
  );
}

/**
 * Normalize an author-supplied high-completion outline into the existing
 * editable Story Bible contract.  The server keeps the raw source and always
 * returns a draft; this adapter never marks a planning artifact approved.
 */
export async function importStoryBibleDraft(
  project: ScriptProject,
  onAutomaticRetry?: (event: AutomaticRetryEvent) => void,
  signal?: AbortSignal,
  creativeDecisions: CreativeDecisionRecord[] = [],
  authorInstruction = "",
): Promise<StoryBible> {
  return requestStoryBibleDraft(
    project,
    onAutomaticRetry,
    authorInstruction,
    signal,
    creativeDecisions,
    true,
  );
}

async function requestStoryBibleDraft(
  project: ScriptProject,
  onAutomaticRetry: ((event: AutomaticRetryEvent) => void) | undefined,
  authorInstruction: string,
  signal: AbortSignal | undefined,
  creativeDecisions: CreativeDecisionRecord[],
  importSource: boolean,
): Promise<StoryBible> {
  if (!project.contentSpecId || !project.generationStrategyId) {
    throw new Error("当前项目尚未形成创作规格，无法生成长篇总纲。");
  }

  const confirmedSynopsis = project.storySynopsis?.status === "confirmed"
    && !synopsisHasPendingChanges(project.storySynopsis)
    ? project.storySynopsis : undefined;
  const confirmedSynopsisText = requireCompleteSynopsisText(confirmedSynopsis?.text ?? "");
  const synopsisReviewNotes = confirmedSynopsis ? synopsisNotesForRequest(confirmedSynopsis) : [];

  const knownVersion = project.storyBibleVersion ?? 0;
  const response = await generateWithAutomaticTransientRetry({
    generate: async (): Promise<StoryBibleDraftResponse | { data: StoryBible }> => {
      try {
        return await apiRequest<StoryBibleDraftResponse>(
          `/story-projects/${project.id}/story-bibles/${importSource ? "import-draft" : "draft"}`,
          {
            method: "POST",
            body: JSON.stringify({
              story_project_id: project.id,
              content_spec_id: project.contentSpecId,
              generation_strategy_id: project.generationStrategyId,
              ...storyPlanningSourcePayload(project, 10_000),
              selected_creative_direction: project.selectedCreativeDirection ?? null,
              author_instruction: boundStoryBibleAuthorInstruction(authorInstruction),
              confirmed_synopsis: confirmedSynopsisText,
              synopsis_review_notes: synopsisReviewNotes,
              creative_decisions: creativeDecisions,
              characters: project.characters.map((character) => ({
                character_ref: character.id.startsWith("story-bible-")
                  ? character.id.slice("story-bible-".length)
                  : `character.${character.id.replace(/[^a-zA-Z0-9_.:-]/g, "-")}`,
                name: character.name,
                role: character.role || "配角",
                description: character.description?.slice(0, 500) || null,
                acting_profile: character.actingProfile ?? null,
              })),
              target_episode_count: project.generationSettings.episodeCount,
              preserve_source_document: importSource || shouldApplyImportedStoryBibleConstraints(project),
            }),
            signal,
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
            && (!importSource || Boolean(recovered.imported_source_document?.trim()))
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

export async function generateStoryBibleInteractiveStep(
  project: ScriptProject,
  step: StoryBibleInteractiveStep,
  previousSections: Record<string, unknown>,
  authorInstruction = "",
  onAutomaticRetry?: (event: AutomaticRetryEvent) => void,
): Promise<StoryBibleInteractiveStepResponse["data"]> {
  if (!project.contentSpecId || !project.generationStrategyId) {
    throw new Error("当前项目尚未形成创作规格，无法继续构建故事总纲。");
  }
  const requestBody = {
    story_project_id: project.id,
    content_spec_id: project.contentSpecId,
    generation_strategy_id: project.generationStrategyId,
    ...storyPlanningSourcePayload(project, 10_000),
    selected_creative_direction: project.selectedCreativeDirection ?? null,
    step,
    previous_sections: previousSections,
    author_instruction: authorInstruction.trim(),
    target_episode_count: project.generationSettings.episodeCount,
  };
  const requestKey = JSON.stringify(requestBody);
  const existing = interactiveStoryBibleRequests.get(requestKey);
  if (existing) return existing;
  const request = generateWithAutomaticTransientRetry({
    generate: () => apiRequest<StoryBibleInteractiveStepResponse>(
      `/story-projects/${project.id}/story-bibles/interactive-step`,
      {
        method: "POST",
        body: JSON.stringify(requestBody),
      },
    ),
    onAutomaticRetry,
    wait: waitForSharedPlanningRetry,
  }).then((response) => response.data).finally(() => {
    interactiveStoryBibleRequests.delete(requestKey);
  });
  interactiveStoryBibleRequests.set(requestKey, request);
  return request;
}

export async function generateStoryInspirationTurn(
  project: ScriptProject,
  messages: StoryInspirationMessage[],
  currentBrief: StoryInspirationBrief,
  userMessage = "",
  signal?: AbortSignal,
  candidateDecisionKey?: string,
  onProgress?: CopilotProgressObserver,
): Promise<StoryInspirationChatResponse["data"]> {
  const currentSynopsis = requireCompleteSynopsisText(project.storySynopsis?.text ?? "");
  if (!project.contentSpecId || !project.generationStrategyId) {
    throw new Error("当前项目尚未形成创作规格，无法开始寻找灵感。");
  }
  const response = await copilotRequest<StoryInspirationChatResponse>(
    `/story-projects/${project.id}/story-bibles/inspiration-chat`,
    {
      method: "POST",
      body: JSON.stringify({
        story_project_id: project.id,
        content_spec_id: project.contentSpecId,
        generation_strategy_id: project.generationStrategyId,
        ...storyPlanningSourcePayload(project, 10_000),
        messages: messages.slice(-30).map((message) => ({
          role: message.role,
          content: message.content,
          questions: message.questions,
          ...(message.candidate_history ? { candidate_history: message.candidate_history } : {}),
        })),
        current_synopsis: currentSynopsis,
        current_brief: candidateDecisionKey ? currentBrief : seedInspirationBriefFromInput(project.storySynopsis ? synopsisSourceProject(project) : project, currentBrief),
        user_message: userMessage.trim(),
        ...(candidateDecisionKey ? { candidate_decision_key: candidateDecisionKey } : {}),
        target_episode_count: project.generationSettings.episodeCount,
        readiness_supplement_questions: (project.inputReadiness?.supplementQuestions ?? []).slice(0, 12),
      }),
      signal,
    },
    onProgress,
  );
  return response.data;
}

export async function generateStorySynopsisDraft(
  project: ScriptProject,
  messages: StoryInspirationMessage[],
  currentBrief: StoryInspirationBrief,
  currentText = project.storySynopsis?.text ?? "",
  signal?: AbortSignal,
  onProgress?: CopilotProgressObserver,
): Promise<StorySynopsisDraftResponse["data"]> {
  const completeText = requireCompleteSynopsisText(currentText);
  if (!project.contentSpecId || !project.generationStrategyId) {
    throw new Error("当前项目尚未形成创作规格，无法整理故事梗概。");
  }
  const response = await copilotRequest<StorySynopsisDraftResponse>(
    `/story-projects/${project.id}/story-bibles/synopsis-draft`,
    {
      method: "POST",
      body: JSON.stringify({
        story_project_id: project.id,
        content_spec_id: project.contentSpecId,
        generation_strategy_id: project.generationStrategyId,
        ...storyPlanningSourcePayload(project, 10_000),
        messages: messages.slice(-30).map((message) => ({
          role: message.role,
          content: message.content,
          questions: message.questions,
          ...(message.candidate_history ? { candidate_history: message.candidate_history } : {}),
        })),
        current_brief: currentBrief,
        current_text: completeText,
        target_episode_count: project.generationSettings.episodeCount,
      }),
      signal,
    },
    onProgress,
  );
  if (!response.data?.text?.trim()) throw new Error("这次未能整理出梗概，原稿已保留，请重试。");
  return response.data;
}

export async function completeStoryBibleInteractive(
  project: ScriptProject,
  sections: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<StoryBible> {
  if (!project.contentSpecId) throw new Error("当前项目缺少创作规格。");
  if (!project.generationStrategyId) throw new Error("当前项目缺少生成策略。");
  const response = await apiRequest<StoryBibleResponse>(
    `/story-projects/${project.id}/story-bibles/interactive-complete`,
    {
      method: "POST",
      body: JSON.stringify({
        story_project_id: project.id,
        content_spec_id: project.contentSpecId,
        generation_strategy_id: project.generationStrategyId,
        ...storyPlanningSourcePayload(project, 10_000),
        sections,
        preserve_source_document: shouldApplyImportedStoryBibleConstraints(project),
      }),
      signal,
    },
  );
  return response.data;
}

export async function modifyStoryBibleDraft(
  project: ScriptProject,
  storyBible: StoryBible,
  instruction: string,
  revisionMode: PlanningRevisionMode = "targeted",
  selectionContext?: StoryBibleSelectionContext | null,
  signal?: AbortSignal,
  onProgress?: CopilotProgressObserver,
): Promise<StoryBible> {
  if (!project.generationStrategyId) {
    throw new Error("当前项目尚未形成生成策略，无法使用 AI 修改故事总纲。");
  }
  const response = await generateWithAutomaticTransientRetry({
    generate: () => copilotRequest<StoryBibleResponse>(
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
          selection_context: selectionContext ?? null,
        }),
        signal,
      },
      onProgress,
    ),
    wait: waitForSharedPlanningRetry,
  });
  return response.data;
}

export async function confirmStoryBible(storyBible: StoryBible, project?: ScriptProject): Promise<StoryBible> {
  assertCreatorNarrativeChinese(storyBibleNarrative(storyBible), project, storyBible.character_registry.map((item) => item.name));
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

export async function saveStoryBibleDraft(storyBible: StoryBible, project?: ScriptProject): Promise<StoryBible> {
  assertCreatorNarrativeChinese(storyBibleNarrative(storyBible), project, storyBible.character_registry.map((item) => item.name));
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
  const history = await loadStoryPlanNodeHistory(
    projectId,
    storyBibleId,
    storyBibleVersion,
  );
  return latestPlanningVersions(history, "node_id");
}

async function loadStoryPlanNodeHistory(
  projectId: string,
  storyBibleId: string,
  storyBibleVersion: number,
): Promise<StoryPlanNode[]> {
  const params = new URLSearchParams({
    story_bible_id: storyBibleId,
    story_bible_version: String(storyBibleVersion),
  });
  const response = await apiRequest<{ data: StoryPlanNode[] }>(
    `/story-projects/${projectId}/plan-nodes?${params.toString()}`,
  );
  return response.data;
}

export function activeStoryPlanNodesFromHistory(
  history: StoryPlanNode[],
): StoryPlanNode[] {
  const root = latestPlanningVersions(
    history.filter((node) => node.parent_node_id === null),
    "node_id",
  )[0];
  if (!root) return [];
  const active = [root];
  let frontier = [root];
  while (frontier.length) {
    const children = frontier.flatMap((parent) => latestPlanningVersions(
      history.filter((node) => (
        node.parent_node_id === parent.node_id
        && node.parent_node_version === parent.version
      )),
      "node_id",
    ).sort((left, right) => left.sequence_order - right.sequence_order));
    active.push(...children);
    frontier = children;
  }
  return active;
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
  const history = await loadStoryPlanNodeHistory(
    projectId,
    storyBibleId,
    storyBibleVersion,
  );
  return activeStoryPlanNodesFromHistory(history);
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
  authorInstruction = "",
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
      author_instruction: planningAuthorInstruction(project, authorInstruction),
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

export async function confirmStoryPlanNode(
  node: StoryPlanNode,
  descendantPolicy: DescendantRevisionPolicy = "invalidate",
  targetEpisodeCount?: number,
  project?: ScriptProject,
): Promise<StoryPlanNode> {
  assertCreatorNarrativeChinese(storyPlanNodeNarrative(node), project);
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
      || (node.planned_end_episode !== targetEpisodeCount && !node.handoff_pressure)
    )
  ) {
    throw new Error("最小剧情单元尚未讲完整：至少需要四个因果事件和单位剧情结算；非结尾部分还须交代下一段承接。");
  }
  const confirmed: StoryPlanNode = {
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
    `/story-projects/${node.story_project_id}/plan-nodes/${node.node_id}/versions/${confirmed.version}`
      + `?descendant_policy=${descendantPolicy}&planning_revision_epoch=${project ? planningRevisionEpoch(project) : 0}`,
    { method: "PUT", body: JSON.stringify(confirmed) },
  );
  return response.data;
}

export type DescendantRevisionPolicy = "invalidate" | "rebase";

export async function saveStoryPlanNodeDraft(
  node: StoryPlanNode,
  descendantPolicy: DescendantRevisionPolicy = "invalidate",
  project?: ScriptProject,
): Promise<StoryPlanNode> {
  assertCreatorNarrativeChinese(storyPlanNodeNarrative(node), project);
  const draft: StoryPlanNode = {
    ...node,
    version: node.version + 1,
    status: "draft",
    approved_at: null,
  };
  const response = await apiRequest<StoryPlanNodeResponse>(
    `/story-projects/${node.story_project_id}/plan-nodes/${node.node_id}/versions/${draft.version}`
      + `?descendant_policy=${descendantPolicy}&planning_revision_epoch=${project ? planningRevisionEpoch(project) : 0}`,
    { method: "PUT", body: JSON.stringify(draft) },
  );
  return response.data;
}

export async function modifyStoryPlanNode(
  project: ScriptProject,
  node: StoryPlanNode,
  instruction: string,
  revisionMode: PlanningRevisionMode = "targeted",
  selectionContext?: StoryBibleSelectionContext | null,
  signal?: AbortSignal,
  onProgress?: CopilotProgressObserver,
): Promise<StoryPlanNode> {
  if (!project.generationStrategyId) {
    throw new Error("当前项目尚未形成生成策略，无法使用 AI 修改剧情树节点。");
  }
  const response = await generateWithAutomaticTransientRetry({
    generate: () => copilotRequest<StoryPlanNodeResponse>(
      `/story-projects/${project.id}/plan-nodes/${node.node_id}/modify`,
      {
        method: "POST",
        body: JSON.stringify({
          story_project_id: project.id,
          planning_revision_epoch: planningRevisionEpoch(project),
          node_id: node.node_id,
          node_version: node.version,
          generation_strategy_id: project.generationStrategyId,
          revision_mode: revisionMode,
          selection_context: selectionContext ?? null,
          instruction: instruction.trim() || (
            revisionMode === "rewrite"
              ? "请在固定的剧情树位置、集数范围和连续性边界内整体重写这个剧情部分。"
              : ""
          ),
        }),
        signal,
      },
      onProgress,
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
  options?: {
    regenerate?: boolean;
    baselineChildVersions?: Readonly<Record<string, number>>;
    authorInstruction?: string;
    operationId?: string;
    beforeRequest?: () => Promise<void> | void;
  },
): Promise<StoryPlanNode[]> {
  if (!project.generationStrategyId) {
    throw new Error("当前项目尚未形成生成策略，无法拆分剧情规划。");
  }
  const requestBase = {
    story_project_id: project.id,
    planning_revision_epoch: planningRevisionEpoch(project),
    parent_node_id: node.node_id,
    parent_node_version: node.version,
    generation_strategy_id: project.generationStrategyId,
    ...(requestedChildCount === undefined ? {} : { requested_child_count: requestedChildCount }),
    author_instruction: planningAuthorInstruction(project, options?.authorInstruction),
    max_episode_ready_span: MAX_EPISODE_READY_SPAN,
  };
  // Reconnects and a later continuation of the same input share the server's
  // operation and remaining call budget, including after a page reload.
  const operationId = options?.operationId ?? await stableAgentRequestId("story-decompose-v1", requestBase);
  const requestBody = JSON.stringify({ ...requestBase, operation_id: operationId });
  return generateWithAutomaticTransientRetry({
    generate: async () => {
      // Pause new requests, including retries, without interrupting an in-flight
      // response or the saved-child recovery check below.
      await options?.beforeRequest?.();
      try {
        const response = await apiRequest<{ data: StoryPlanNode[] }>(
          `/story-projects/${project.id}/plan-nodes/${node.node_id}/decompose`,
          {
            method: "POST",
            body: requestBody,
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
          const baselineVersions = options?.baselineChildVersions ?? {};
          const isFreshRegenerationCheckpoint = !options?.regenerate || recovered.every(
            (child) => child.version > (baselineVersions[child.node_id] ?? 0),
          );
          if (
            hasCompleteStoryPlanChildCoverage(node, recovered)
            && isFreshRegenerationCheckpoint
          ) return recovered;
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
  return latestPlanningVersions(response.data, "episode_number").sort(
    (left, right) => left.episode_number - right.episode_number,
  );
}

export async function confirmEpisodePlanMaterialization(
  projectId: string,
  draft: EpisodePlanMaterializationDraft,
  sourceDocument: string,
  authorConfirmedAt = new Date().toISOString(),
): Promise<Omit<EpisodePlanMaterializationReceipt, "roadmapDraftCount">> {
  const response = await apiRequest<{
    data: {
      materialization_id: string;
      source_fingerprint: string;
      story_bible_id: string;
      story_bible_version: number;
      status: "draft";
      mappings: Array<{
        episode_number: number;
        target_node_id: string;
        target_node_version: number;
        target_episode_start: number;
        target_episode_end: number;
      }>;
      unresolved_fields: Array<{ fields: string[] }>;
      preview_created_at: string;
      author_confirmed_at: string;
      created_at: string;
    };
  }>(`/story-projects/${projectId}/episode-plan-materializations`, {
    method: "POST",
    body: JSON.stringify({
      schema_version: draft.schemaVersion,
      draft_schema_version: draft.draftSchemaVersion,
      adapter_version: draft.adapterVersion,
      source_document: sourceDocument,
      source_fingerprint: draft.sourceFingerprint,
      fingerprint_algorithm: draft.fingerprintAlgorithm,
      story_bible_id: draft.storyBibleId,
      story_bible_version: draft.storyBibleVersion,
      mappings: draft.mappings.map((mapping) => ({
        episode_number: mapping.episodeNumber,
        source_row_ordinal: mapping.sourceRowOrdinal,
        source_start: mapping.sourceStart,
        source_end: mapping.sourceEnd,
        source_raw_text: mapping.sourceRawText,
        target_node_id: mapping.targetNodeId,
        target_node_version: mapping.targetNodeVersion,
        target_episode_start: mapping.targetEpisodeRange.start,
        target_episode_end: mapping.targetEpisodeRange.end,
        fields: mapping.fields,
        field_provenance: Object.fromEntries(
          Object.entries(mapping.fieldProvenance).map(([field, provenance]) => [
            field,
            provenance
              ? {
                  source: provenance.source,
                  row_ordinal: provenance.rowOrdinal,
                  episode_number: provenance.episodeNumber,
                  field: provenance.field,
                  value: provenance.value,
                  span: provenance.span,
                }
              : provenance,
          ]),
        ),
        unresolved_fields: mapping.unresolvedFields,
        review_required: true,
      })),
      unresolved_fields: draft.unresolvedFields.map((item) => ({
        episode_number: item.episodeNumber,
        row_ordinal: item.rowOrdinal,
        fields: item.fields,
      })),
      review_required: true,
      preview_status: draft.status,
      preview_created_at: draft.createdAt,
      author_confirmed_at: authorConfirmedAt,
      confirmed_by: "author",
    }),
  });
  const targetNodeRefs = Array.from(new Map(
    response.data.mappings.map((mapping) => [
      `${mapping.target_node_id}:${mapping.target_node_version}`,
      {
        nodeId: mapping.target_node_id,
        nodeVersion: mapping.target_node_version,
        startEpisode: mapping.target_episode_start,
        endEpisode: mapping.target_episode_end,
      },
    ]),
  ).values());
  return {
    schemaVersion: "episode_plan_materialization.v1",
    materializationId: response.data.materialization_id,
    sourceFingerprint: response.data.source_fingerprint,
    storyBibleId: response.data.story_bible_id,
    storyBibleVersion: response.data.story_bible_version,
    status: response.data.status,
    episodeNumbers: response.data.mappings.map((mapping) => mapping.episode_number),
    targetNodeRefs,
    unresolvedFieldCount: response.data.unresolved_fields.reduce(
      (total, item) => total + item.fields.length,
      0,
    ),
    previewCreatedAt: response.data.preview_created_at,
    authorConfirmedAt: response.data.author_confirmed_at,
    createdAt: response.data.created_at,
  };
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

/** Pending scene obligations retain their exact canon and event ownership. */
export function currentStoryPlanExecutionRequirements(
  project: ScriptProject,
  nodes: StoryPlanNode[],
): StoryPlanExecutionHandoff[] {
  const audit = project.storyTreeQualityAudit;
  if (!audit || audit.story_project_id !== project.id) return [];
  return (audit.execution_requirements ?? []).filter((item) => nodes.some((node) => (
    node.node_id === item.node_id && node.version === item.node_version
    && node.story_bible_id === audit.story_bible_id
    && node.story_bible_version === audit.story_bible_version
    && audit.node_refs.some(ref => ref.node_id === node.node_id && ref.node_version === node.version)
  )));
}

function episodeExecutionRequirements(project: ScriptProject, node: StoryPlanNode) {
  return currentStoryPlanExecutionRequirements(project, [node]).map(({ episode_number, source_event_index, instruction }) => (
    { episode_number, source_event_index, instruction }
  ));
}

export async function generateEpisodePlanBatch(
  project: ScriptProject,
  node: StoryPlanNode,
  onCheckpoint?: (plan: EpisodeRoadmapItem) => Promise<void> | void,
  beforeNextEpisode?: () => Promise<void> | void,
  options?: { regenerate?: boolean; activeNodes?: StoryPlanNode[] },
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
  const existing = (options?.regenerate ? [] : (project.episodeRoadmaps ?? []))
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
    // A draft checkpoint is safe as transport context for resuming this same
    // planning batch; it is still marked draft and remains excluded from
    // readiness, execution, and predecessor lookups until the author approves
    // it explicitly.
    accepted.push(saved);
  }

  while (node.planned_start_episode + accepted.length <= node.planned_end_episode) {
    const episodeNumber = node.planned_start_episode + accepted.length;
    await beforeNextEpisode?.();
    const requestPayload = {
      story_project_id: project.id,
      planning_revision_epoch: planningRevisionEpoch(project),
      source_node_id: node.node_id,
      source_node_version: node.version,
      generation_strategy_id: project.generationStrategyId,
      episode_number: episodeNumber,
      predecessor_plan: predecessorPlan
        ? roadmapItemForApi(predecessorPlan)
        : null,
      accepted_plans: accepted.map(roadmapItemForApi),
      planning_memory: buildEpisodePlanningMemory(project, node, options?.activeNodes),
      draft_handoffs: buildDraftPlanningHandoffs(project, node, options?.activeNodes),
      execution_requirements: episodeExecutionRequirements(project, node),
    };
    const agentRequestId = await stableAgentRequestId(
      "episode-roadmap-chunk",
      requestPayload,
    );
    const response = await generateWithFailurePolicy({
      generate: () => apiRequest<{ data: RoadmapApiItem[] }>(
        `/story-projects/${project.id}/plan-nodes/${node.node_id}/episode-plans/chunk`,
        {
          method: "POST",
          body: JSON.stringify({
            ...requestPayload,
            agent_request_id: agentRequestId,
          }),
        },
      ),
      mode: "automatic",
      shouldRetry: isTransientGenerationFailure,
      retryDelay: roadmapRetryDelayMs,
      maxAutomaticAttempts: MAX_EPISODE_ROADMAP_API_ATTEMPTS,
      wait: waitForSharedPlanningRetry,
    });
    const remainingEpisodeCount = node.planned_end_episode - episodeNumber + 1;
    if (
      response.data.length === 0
      || response.data.length > remainingEpisodeCount
    ) {
      throw new Error(
        `分集路线图返回数量异常：本段剩余 ${remainingEpisodeCount} 集，实际返回 ${response.data.length} 集。`,
      );
    }
    for (const [offset, generated] of response.data.entries()) {
      if (generated.episode_number !== episodeNumber + offset) {
        throw new Error("分集路线图返回的集号不连续，已停止保存本轮结果。");
      }
      const checkpoint: EpisodeRoadmapItem = {
        ...generated,
        source_node_id: node.node_id,
        source_node_version: node.version,
        story_bible_version: node.story_bible_version,
        status: "draft",
      };
      accepted.push(checkpoint);
      await onCheckpoint?.(checkpoint);
    }
  }
  return accepted;
}

/** Rebuild one saved future draft through the existing resumable roadmap role. */
export async function rebuildFutureEpisodePlan(
  project: ScriptProject, node: StoryPlanNode, item: EpisodeRoadmapItem,
  acceptedPlans: EpisodeRoadmapItem[], activeNodes?: StoryPlanNode[],
): Promise<{ plan: EpisodeRoadmapItem; receipt: FutureRoadmapRebuildReceipt }> {
  if (!project.generationStrategyId) throw new Error("当前项目尚未形成生成策略。");
  const predecessor = episodeRoadmapPredecessor(project, node);
  const payload = {
    story_project_id: project.id, planning_revision_epoch: planningRevisionEpoch(project),
    source_node_id: node.node_id, source_node_version: node.version,
    generation_strategy_id: project.generationStrategyId, episode_number: item.episode_number,
    future_rebuild: true,
    predecessor_plan: predecessor ? roadmapItemForApi(predecessor) : null,
    accepted_plans: acceptedPlans.map(roadmapItemForApi),
    planning_memory: buildEpisodePlanningMemory(project, node, activeNodes),
    draft_handoffs: buildDraftPlanningHandoffs(project, node, activeNodes),
    execution_requirements: episodeExecutionRequirements(project, node),
  };
  const requestId = await stableAgentRequestId("future-episode-roadmap-rebuild", payload);
  const response = await generateWithFailurePolicy({
    generate: () => apiRequest<{ data: RoadmapApiItem[]; rebuild_receipt?: FutureRoadmapRebuildReceipt | null }>(
      `/story-projects/${project.id}/plan-nodes/${node.node_id}/episode-plans/chunk`,
      { method: "POST", body: JSON.stringify({ ...payload, agent_request_id: requestId }) },
    ),
    mode: "automatic", shouldRetry: isTransientGenerationFailure, retryDelay: roadmapRetryDelayMs,
    maxAutomaticAttempts: MAX_EPISODE_ROADMAP_API_ATTEMPTS, wait: waitForSharedPlanningRetry,
  });
  if (response.data.length !== 1 || response.data[0].episode_number !== item.episode_number || !response.rebuild_receipt) {
    throw new Error("重建返回的单集范围或服务端凭证不完整，原稿已保留。");
  }
  return { plan: { ...response.data[0], source_node_id: node.node_id, source_node_version: node.version,
    story_bible_version: node.story_bible_version, status: "draft" }, receipt: response.rebuild_receipt };
}

type RoadmapApiItem = Omit<EpisodeRoadmapItem,
  | "source_node_id"
  | "source_node_version"
  | "story_bible_version"
  | "status"
  | "source_revision_review">;

function roadmapItemForApi(item: EpisodeRoadmapItem): RoadmapApiItem {
  const {
    source_node_id: _sourceNodeId,
    source_node_version: _sourceNodeVersion,
    story_bible_version: _storyBibleVersion,
    status: _status,
    // Workspace review state is retained locally, never sent as generated prose.
    source_revision_review: _sourceRevisionReview,
    scene_execution_plan: _sceneExecutionPlan,
    layer_contracts: _layerContracts,
    ...apiItem
  } = item;
  return {
    ...apiItem,
    // Keep the complete execution contract in both chunk and revision
    // requests. Undefined legacy fields are omitted by JSON.stringify.
    scene_execution_plan: _sceneExecutionPlan,
    layer_contracts: _layerContracts,
  };
}

async function stableAgentRequestId(
  kind: string,
  payload: object,
): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const fingerprint = Array.from(new Uint8Array(digest), (value) => (
    value.toString(16).padStart(2, "0")
  )).join("");
  return `agent-request.${kind}.${fingerprint}`;
}

export const CURRENT_STORY_REVIEW_CONTRACT_VERSION = 13;

type StoryPlanReviewSourceProject = Pick<ScriptProject,
  "id" | "storyBibleVersion" | "storyBibleSynopsisOutdated" | "storySynopsis"> & Partial<Pick<ScriptProject, "generationSettings">>;

function storyPlanReviewSourceSignature(
  project: StoryPlanReviewSourceProject,
  storyBibleId: string,
  storyBibleVersion: number,
): string {
  const synopsis = project.storySynopsis;
  const profile = project.generationSettings && overseasStoryProfileForApi(project.generationSettings);
  const confirmed = project.storyBibleVersion === storyBibleVersion
    && project.storyBibleSynopsisOutdated !== true
    && synopsis?.status === "confirmed" && synopsis.pendingChanges !== true
    && typeof synopsis.text === "string" && !!synopsis.text.trim();
  return JSON.stringify([project.id, storyBibleId, storyBibleVersion,
    confirmed ? [synopsis.version ?? null, "confirmed", synopsis.text] : null,
    ...(profile ? [profile] : [])]);
}

export function storyPlanQualityEpisodes(
  nodes: StoryPlanNode[],
  roadmaps: EpisodeRoadmapItem[] = [],
) {
  return roadmaps.filter((item) => nodes.some((node) => (
    item.source_node_id === node.node_id && item.source_node_version === node.version
    && item.story_bible_version === node.story_bible_version
    && item.episode_number >= (node.planned_start_episode ?? 1)
    && item.episode_number <= (node.planned_end_episode ?? 2_000)
  ))).sort((left, right) => left.episode_number - right.episode_number).map((item) => ({
    source_node_id: item.source_node_id,
    source_node_version: item.source_node_version,
    episode_number: item.episode_number,
    planned_dialogue_line_count: item.planned_dialogue_line_count ?? null,
    synopsis: item.synopsis ?? "",
    protagonist_decision: item.protagonist_decision ?? "",
    episode_payoff: item.episode_payoff ?? "",
    exit_state: item.exit_state ?? "",
    source_turning_points: item.source_turning_points ?? [],
    source_unit_story_beats: item.source_unit_story_beats ?? [],
    continuity_requirements: item.continuity_requirements ?? [],
    dramatic_units: (item.dramatic_units ?? []).map((unit) => ({
      trigger: unit.trigger, choice: unit.choice, visible_consequence: unit.visible_consequence,
      change_type: unit.change_type, evidence_hint: unit.evidence_hint ?? null,
    })),
    scene_execution_plan: (item.scene_execution_plan ?? []).map((scene) => ({
      scene_number: scene.scene_number,
      visible_action: scene.visible_action,
      evidence_requirements: scene.evidence_requirements ?? [],
      exit_state: scene.exit_state,
      character_refs: scene.character_refs ?? [],
      dialogue_objective: scene.dialogue_objective ?? null,
      dialogue_line_target: scene.dialogue_line_target ?? null,
      forbidden_changes: scene.forbidden_changes ?? [],
    })),
  }));
}

export function storyPlanQualityAuditMatchesNodes(
  audit: StoryTreeQualityAudit | undefined,
  nodes: StoryPlanNode[],
  roadmaps: EpisodeRoadmapItem[] = [],
  options: { allowLegacyFailure?: boolean; project?: StoryPlanReviewSourceProject } = {},
): boolean {
  // Contract 13 checks confirmed event coverage, order, actors and repair boundaries.
  // Legacy failures remain binding for their original evidence until re-review;
  // a prior pass cannot approve constraints that its request never contained.
  const episodes = storyPlanQualityEpisodes(nodes, roadmaps);
  const legacyEpisodes = episodes.map(({ continuity_requirements: _continuity,
    dramatic_units: _units, scene_execution_plan: scenes, ...episode }) => ({
    ...episode, scene_execution_plan: scenes.map(({ forbidden_changes: _forbidden, ...scene }) => scene),
  }));
  const reviewedContent = [10, 11, 12, CURRENT_STORY_REVIEW_CONTRACT_VERSION].includes(audit?.review_contract_version ?? 0) ? episodes
    : [8, 9].includes(audit?.review_contract_version ?? 0) ? legacyEpisodes : legacyEpisodes.map(
      ({ planned_dialogue_line_count: _budget, scene_execution_plan: scenes, ...episode }) => (
        [6, 7].includes(audit?.review_contract_version ?? 0)
          ? { ...episode, scene_execution_plan: scenes.map(({
            character_refs: _characters, dialogue_objective: _purpose, dialogue_line_target: _target, ...scene
          }) => scene) }
          : episode
      ),
    );
  if (!audit || !(audit.review_contract_version === CURRENT_STORY_REVIEW_CONTRACT_VERSION
    || (options.allowLegacyFailure && [3, 4, 5, 6, 7, 8, 9, 10, 11, 12].includes(audit.review_contract_version ?? 0)
      && audit.status === "needs_revision"))
    || audit.reviewed_episode_plans !== JSON.stringify(reviewedContent)
    || audit.story_bible_id !== (nodes[0]?.story_bible_id ?? "")
    || audit.story_bible_version !== nodes[0]?.story_bible_version) return false;
  // Only the server can certify the complete approved source. The local
  // signature detects source edits before any cached PASS can skip a review.
  // Historical failures still describe their unchanged reviewed content.
  if (audit.status === "pass" && (!options.project
    || !/^[a-f0-9]{64}$/i.test(audit.reviewed_source_fingerprint ?? "")
    || audit.reviewed_source_signature !== storyPlanReviewSourceSignature(
      options.project, audit.story_bible_id, audit.story_bible_version,
    ))) return false;
  const expected = [...nodes]
    .sort((left, right) => left.node_id.localeCompare(right.node_id))
    .map((node) => `${node.node_id}:${node.version}`);
  const actual = [...audit.node_refs]
    .sort((left, right) => left.node_id.localeCompare(right.node_id))
    .map((node) => `${node.node_id}:${node.node_version}`);
  return expected.length === actual.length
    && expected.every((identity, index) => identity === actual[index]);
}

/** Continue only the unfinished leaf after an unchanged, reviewed prefix.
 * The pipeline must review the completed leaf before starting its successor.
 * This never certifies the unreviewed tail for approval or screenplay work.
 */
export function canFinishUnreviewedRoadmapLeaf(
  audit: StoryTreeQualityAudit | undefined,
  nodes: StoryPlanNode[],
  roadmaps: EpisodeRoadmapItem[],
  options: { project?: StoryPlanReviewSourceProject } = {},
): boolean {
  if (!audit || audit.status !== "pass" || audit.findings.length) return false;
  let reviewed: { episode_number: number }[];
  try {
    reviewed = JSON.parse(audit.reviewed_episode_plans ?? "");
  } catch {
    return false;
  }
  if (!Array.isArray(reviewed)
    || reviewed.some((item, index) => item?.episode_number !== index + 1)) return false;
  const prefix = roadmaps.filter(item => item.episode_number <= reviewed.length);
  if (!storyPlanQualityAuditMatchesNodes(audit, nodes, prefix, options)) return false;
  const current = storyPlanQualityEpisodes(nodes, roadmaps);
  const tail = current.slice(reviewed.length);
  if (!tail.length) return false;
  const nextEpisode = reviewed.length + 1;
  const leaf = nodes.find(node => (node.planned_start_episode ?? 2_001) <= nextEpisode
    && (node.planned_end_episode ?? 0) >= nextEpisode);
  if (!leaf || leaf.status !== "approved" || leaf.expansion_status !== "episode_ready"
    || leaf.planned_end_episode === null
    || tail[tail.length - 1].episode_number >= leaf.planned_end_episode) return false;
  return tail.every((item, index) => item.episode_number === reviewed.length + index + 1
    && item.source_node_id === leaf.node_id && item.source_node_version === leaf.version);
}

export async function auditStoryPlanQuality(
  project: ScriptProject,
  storyBible: StoryBible,
  leaves: StoryPlanNode[],
  options: { timeoutMs?: number } = {},
): Promise<StoryTreeQualityAudit> {
  if (!project.generationStrategyId) {
    throw new Error("当前项目尚未形成生成策略，无法进行剧情质量审校。");
  }
  const nodeRefs = leaves.map((node) => ({
    node_id: node.node_id,
    node_version: node.version,
  }));
  const requestBase = {
    story_project_id: project.id,
    planning_revision_epoch: planningRevisionEpoch(project),
    story_bible_id: storyBible.story_bible_id,
    story_bible_version: storyBible.version,
    generation_strategy_id: project.generationStrategyId,
    node_refs: nodeRefs,
    episode_plans: storyPlanQualityEpisodes(leaves, project.episodeRoadmaps),
    execution_requirements: currentStoryPlanExecutionRequirements(project, leaves),
  };
  const agentRequestId = await stableAgentRequestId(`story-quality-v${CURRENT_STORY_REVIEW_CONTRACT_VERSION}`, requestBase);
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? 600_000,
  );
  try {
    const response = await apiRequest<{ data: StoryTreeQualityAudit }>(
      `/story-projects/${project.id}/plan-nodes/quality-audit/agent-run`,
      {
        method: "POST",
        body: JSON.stringify({ ...requestBase, agent_request_id: agentRequestId }),
        signal: controller.signal,
      },
    );
    return {
      ...response.data, review_contract_version: CURRENT_STORY_REVIEW_CONTRACT_VERSION,
      reviewed_episode_plans: JSON.stringify(requestBase.episode_plans),
    };
  } catch (error) {
    if (error instanceof ApiError && error.status === 422) {
      throw new ApiError(
        "分集规划已保存，但剧情质量检查未完成。请重试检查；无需重新生成已保存分集。",
        error.status,
        { retryable: error.retryable, failureClass: error.failureClass, errorType: error.errorType },
      );
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

export async function prepareEpisodePlanItem(
  project: ScriptProject,
  node: StoryPlanNode,
  item: EpisodeRoadmapItem,
  acceptedPlans: EpisodeRoadmapItem[],
  signal?: AbortSignal,
  activeNodes?: StoryPlanNode[],
): Promise<EpisodeRoadmapItem> {
  if (!project.generationStrategyId) {
    throw new Error("当前项目尚未形成生成策略，无法整理本集场次。");
  }
  const predecessorPlan = episodeRoadmapPredecessor(project, node);
  const response = await generateWithAutomaticTransientRetry({
    generate: () => apiRequest<{ data: RoadmapApiItem }>(
      `/story-projects/${project.id}/plan-nodes/${node.node_id}`
        + `/episode-plans/${item.episode_number}/prepare`,
      {
        method: "POST",
        body: JSON.stringify({
          story_project_id: project.id,
          planning_revision_epoch: planningRevisionEpoch(project),
          source_node_id: node.node_id,
          source_node_version: node.version,
          generation_strategy_id: project.generationStrategyId,
          episode_number: item.episode_number,
          predecessor_plan: predecessorPlan
            ? roadmapItemForApi(predecessorPlan)
            : null,
          accepted_plans: acceptedPlans.map(roadmapItemForApi),
          current_plan: {
            ...roadmapItemForApi(item),
            scene_execution_plan: item.scene_execution_plan,
            layer_contracts: item.layer_contracts,
          },
          planning_memory: buildEpisodePlanningMemory(project, node, activeNodes),
          draft_handoffs: buildDraftPlanningHandoffs(project, node, activeNodes),
          execution_requirements: episodeExecutionRequirements(project, node),
        }),
        signal,
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

export async function modifyEpisodePlanItem(
  project: ScriptProject,
  node: StoryPlanNode,
  item: EpisodeRoadmapItem,
  acceptedPlans: EpisodeRoadmapItem[],
  instruction: string,
  revisionMode: PlanningRevisionMode = "targeted",
  selectionContext?: StoryBibleSelectionContext | null,
  signal?: AbortSignal,
  activeNodes?: StoryPlanNode[],
  onProgress?: CopilotProgressObserver,
): Promise<EpisodeRoadmapItem> {
  if (!project.generationStrategyId) {
    throw new Error("当前项目尚未形成生成策略，无法使用 AI 修改分集路线图。");
  }
  const predecessorPlan = episodeRoadmapPredecessor(project, node);
  const response = await generateWithAutomaticTransientRetry({
    generate: () => copilotRequest<{ data: RoadmapApiItem }>(
      `/story-projects/${project.id}/plan-nodes/${node.node_id}`
        + `/episode-plans/${item.episode_number}/modify`,
      {
        method: "POST",
        body: JSON.stringify({
          story_project_id: project.id,
          planning_revision_epoch: planningRevisionEpoch(project),
          source_node_id: node.node_id,
          source_node_version: node.version,
          generation_strategy_id: project.generationStrategyId,
          episode_number: item.episode_number,
          predecessor_plan: predecessorPlan
            ? roadmapItemForApi(predecessorPlan)
            : null,
          accepted_plans: acceptedPlans.map(roadmapItemForApi),
          current_plan: {
            ...roadmapItemForApi(item),
            scene_execution_plan: item.scene_execution_plan,
            layer_contracts: item.layer_contracts,
          },
          planning_memory: buildEpisodePlanningMemory(project, node, activeNodes),
          draft_handoffs: buildDraftPlanningHandoffs(project, node, activeNodes),
          execution_requirements: episodeExecutionRequirements(project, node),
          revision_mode: revisionMode,
          selection_context: selectionContext ?? null,
          instruction: instruction.trim() || (
            revisionMode === "rewrite"
              ? "请保持本集位置、连续性引用和因果职责，整体重写这一集的路线图。"
              : ""
          ),
        }),
        signal,
      },
      onProgress,
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
    isApprovedEpisodeRoadmap(item)
    &&
    item.story_bible_version === node.story_bible_version
    && item.episode_number === predecessorEpisode
  ));
  return candidates[candidates.length - 1];
}

export async function approveEpisodePlan(plan: EpisodePlan, project?: ScriptProject): Promise<EpisodePlan> {
  assertCreatorNarrativeChinese(episodePlanNarrative(plan), project);
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

export async function saveEpisodePlanDraft(plan: EpisodePlan, project?: ScriptProject): Promise<EpisodePlan> {
  assertCreatorNarrativeChinese(episodePlanNarrative(plan), project);
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
  permanentVoice?: boolean;
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
    ...storyBible.character_registry.flatMap((character) => ACTING_PROFILE_FIELDS
      .map((field) => ({
        ...narrativeField(`${character.name} · ${ACTING_PROFILE_LABELS[field]}`, character.acting_profile?.[field]),
        ...(field === "permanentVoicePrompt" ? { permanentVoice: true } : {}),
      }))),
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
    ...(node.episode_developments ?? []).flatMap((item) => [
      narrativeField(`第${item.episode_number}集事件`, item.synopsis),
      narrativeField(`第${item.episode_number}集进入`, item.entry_state),
      narrativeField(`第${item.episode_number}集退出`, item.exit_state),
    ]),
    narrativeField("单位剧情结算", node.unit_resolution),
    narrativeField("交接压力", node.handoff_pressure),
    narrativeField("拆分理由", node.decomposition_reason),
  ];
}

function episodePlanNarrative(plan: EpisodePlan): MainlandNarrativeField[] {
  return [
    narrativeField("本集标题", plan.episode_title),
    narrativeField("本集目标", plan.episode_goal),
    narrativeField("进入状态", plan.entry_state),
    narrativeField("核心冲突", plan.central_conflict),
    narrativeField("主角决定", plan.protagonist_decision),
    narrativeField("揭示", plan.reveal),
    narrativeField("情绪变化", plan.emotional_movement),
    narrativeField("人物代价", plan.protagonist_cost),
    ...(plan.dramatic_units ?? []).flatMap((unit, index) => [
      narrativeField(`戏剧单位 ${index + 1} 触发事件`, unit.trigger),
      narrativeField(`戏剧单位 ${index + 1} 人物选择`, unit.choice),
      narrativeField(`戏剧单位 ${index + 1} 可见后果`, unit.visible_consequence),
      narrativeField(`戏剧单位 ${index + 1} 变化类型`, unit.change_type),
      narrativeField(`戏剧单位 ${index + 1} 动作或对白证据`, unit.evidence_hint),
    ]),
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

function assertCreatorNarrativeChinese(
  fields: MainlandNarrativeField[],
  project?: ScriptProject,
  registryNames: string[] = [],
): void {
  // Exempt explicit character identities only. Overseas planning remains Chinese
  // prose, and an unknown English word is never inferred to be somebody's name.
  const allowedNames = project?.generationSettings.releaseRegion === "overseas"
    ? [
        ...Object.values(project.canonicalCharacterNames ?? {}),
        ...project.characters.map((character) => character.name),
        ...registryNames,
      ]
    : [];
  const voiceIssues: MainlandNarrativeField[] = [];
  const issues = fields.filter((field) => {
    if (field.permanentVoice && project?.generationSettings.releaseRegion === "overseas") {
      const validation = overseasVoiceValidationText(field.value, allowedNames);
      if (!validation.valid || mainlandTextIsEnglishDominant(validation.text, allowedNames)) voiceIssues.push(field);
      return false;
    }
    return mainlandTextIsEnglishDominant(field.value, allowedNames);
  });
  if (voiceIssues.length) throw new OverseasVoiceSampleError(voiceIssues.map((field) => field.path));
  if (!issues.length) return;
  throw new CreatorNarrativeLanguageError(issues.map((field) => field.path));
}
