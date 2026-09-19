import type { PriorAuthorInstruction } from "./author-modification-instructions";
import { ApiError, apiEventStream, apiRequest } from "@/lib/api-client";
import { buildContinuityGenerationSummary } from "@/lib/continuity";
import { generateWithAutomaticTransientRetry } from "@/lib/generation-retry";
import {
  normalizeEpisodeDurationSeconds,
  targetScriptBodyCharacters,
} from "@/lib/generation-planning";
import type {
  EpisodeExecutionPlan,
  StoryNodeExecutionContext,
} from "@/lib/episode-generation-planning";
import { buildStorylineDuties, storyBibleEpisodeContext } from "@/lib/episode-generation-planning";
import { buildProvisionalContinuityCheckpoint } from "@/lib/continuity-checkpoint";
import {
  buildEpisodeMemoryRecall,
  buildEpisodeModificationMemoryRecall,
  projectBeforeEpisodeModification,
  type MemoryRecall,
} from "@/lib/memory-recall";
import { loadConfirmedContinuityCheckpoint } from "@/lib/project-sync";
import {
  buildEpisodeReferenceMaterialContext,
  hasUsableCreativeSource,
  referenceMaterialFallbackPrompt,
} from "@/lib/reference-materials";
import { resolveProjectTagSelection } from "@/lib/tag-catalog";
import type {
  AuthorConflictResolution,
  BilingualScriptView,
  CreativeDecisionRecord,
  CreativeDeepeningRun,
  EndingMode,
  GeneratedDraft,
  ScriptDraftModificationResult,
  ScriptGenerationRun,
  ScriptProject,
  StorylineDuty,
} from "@/lib/types";
import { enrichDraftWithActingProfiles } from "@/lib/character-acting-profile";
import {
  marketProfileForReleaseRegion,
} from "@/lib/types";
import {
  canonicalCharacterNameEntries,
  canonicalCharacterNameMap,
} from "@/lib/canonical-character-names";
import { clientDialogueSpeaker } from "@/lib/client-screenplay-format";
import { buildEpisodeHandoff } from "@/lib/episode-handoff";
import { parseGeneratedDraft } from "@/lib/generated-draft-parser";
export { buildEpisodeHandoff } from "@/lib/episode-handoff";
import type { StoryBibleSelectionContext } from "@/lib/story-planning-client";
import { compileAmendedEpisodeSource } from "@/lib/amended-episode-context";
import { loadActiveStoryPlanNodes, loadStoryBible } from "@/lib/story-planning-client";

interface ApiList<T> { data: T[] }
interface OntologyNode { id: string; label: string; category: string; is_active: boolean }
interface PlatformProfile {
  id: string;
  platform_name: string;
  metadata?: {
    market_profile?: string;
    runtime_status?: string;
  };
}
interface GenerationStrategy {
  id: string;
  status: string;
  target_platform: string;
  applicable_tags: string[];
  draft_knowledge_bundle_id?: string | null;
  model_tier?: "strong_planner" | "fast_executor";
}
interface ResolutionResponse { data: { content_spec: { id: string }; resolved_creative_context: unknown } }
interface GenerationResponse { data: ScriptGenerationRun }
interface ModificationResponse { data: ScriptDraftModificationResult }
interface DeepeningResponse { data: CreativeDeepeningRun }

export interface EpisodeGenerationRuntime {
  nodesResponse: ApiList<OntologyNode>;
  profilesResponse: ApiList<PlatformProfile>;
  strategiesResponse: ApiList<GenerationStrategy>;
  confirmedCheckpoint: string | null;
}

let generationCatalogCache: {
  expiresAt: number;
  value: Promise<Pick<EpisodeGenerationRuntime, "nodesResponse" | "profilesResponse" | "strategiesResponse">>;
} | null = null;

async function loadGenerationCatalog(): Promise<Pick<EpisodeGenerationRuntime, "nodesResponse" | "profilesResponse" | "strategiesResponse">> {
  const now = Date.now();
  if (!generationCatalogCache || generationCatalogCache.expiresAt <= now) {
    const value = Promise.all([
      apiRequest<ApiList<OntologyNode>>("/ontology-nodes"),
      apiRequest<ApiList<PlatformProfile>>("/platform-profiles"),
      apiRequest<ApiList<GenerationStrategy>>("/generation-strategies"),
    ]).then(([nodesResponse, profilesResponse, strategiesResponse]) => ({
      nodesResponse,
      profilesResponse,
      strategiesResponse,
    }));
    generationCatalogCache = {
      expiresAt: now + 5 * 60 * 1000,
      value,
    };
    void value.catch(() => {
      if (generationCatalogCache?.value === value) generationCatalogCache = null;
    });
  }
  return generationCatalogCache.value;
}

export async function prepareEpisodeGenerationRuntime(
  project: ScriptProject,
): Promise<EpisodeGenerationRuntime> {
  if (project.planningRevision?.status === "active") throw new Error("后续规划正在修订，请完成审校和逐集批准后再生成正文。");
  return generateWithAutomaticTransientRetry({
    generate: async () => {
      const [catalog, confirmedCheckpoint] = await Promise.all([
        loadGenerationCatalog(),
        loadConfirmedContinuityCheckpoint(project),
      ]);
      return { ...catalog, confirmedCheckpoint };
    },
  });
}

export interface EpisodeGenerationContext {
  generationMode: "sequential" | "full";
  memoryLayer?: "provisional";
  episodeNumber: number;
  totalEpisodes: number;
  endingMode?: EndingMode;
  agentRequestId?: string;
  targetScriptBodyCharacters?: number;
  targetDurationSeconds?: number;
  adaptiveSceneCount?: number;
  plannedShotCount?: number;
  previousEpisode?: GeneratedDraft;
  previousEpisodeSummary?: string;
  previousEpisodeHandoff?: string;
  previousEpisodeQuestion?: string;
  episodeInstruction?: string;
  moduleHandoff?: string;
  longRangeAnchor?: string;
  relevantCharacterRefs?: string[];
  plannedStoryLineRefs?: string[];
  storylineDuties?: StorylineDuty[];
  creativeDecisions?: CreativeDecisionRecord[];
  plannedSetupRefs?: string[];
  plannedPayoffRefs?: string[];
  plannedStoryBeat?: string;
  approvedStoryNode?: StoryNodeExecutionContext;
  approvedEpisodePlan?: EpisodeExecutionPlan;
  storyBibleContext?: string;
  memoryRecall?: MemoryRecall;
  batch?: {
    batchNumber: number;
    startEpisode: number;
    endEpisode: number;
    instruction?: string;
  };
}

export type ScriptGenerationStage =
  | "preparing"
  | "generating"
  | "retrying_generation"
  | "recovering_model_regeneration"
  | "repairing_json"
  | "validating_structure"
  | "repairing_structure"
  | "repairing_structure_fallback"
  | "checking_language"
  | "repairing_language"
  | "checking_acceptance"
  | "repairing_acceptance"
  | "repairing_continuity"
  | "checking_gpt_edit"
  | "gpt_edit_not_needed"
  | "editing_with_gpt"
  | "validating_gpt_edit"
  | "checking_length"
  | "expanding_body"
  | "checking_screenplay_style"
  | "repairing_screenplay_style"
  | "assembling"
  | "quality_checking"
  | "completed";

export type ScriptGenerationStreamEvent =
  | {
      type: "stage";
      episode_number?: number;
      timestamp: string;
      stage: ScriptGenerationStage;
      actual_characters?: number;
      target_characters?: number;
      preferred_min_characters?: number;
      preferred_max_characters?: number;
    }
  | {
      type: "draft_delta";
      episode_number?: number;
      timestamp: string;
      phase: "draft" | "model_regeneration" | "json_repair" | "structure_repair" | "language_repair" | "body_expansion" | "screenplay_style_repair" | "acceptance_repair" | "continuity_repair";
      delta: string;
      reset: boolean;
    }
  | {
      type: "result";
      episode_number?: number;
      timestamp: string;
      data: ScriptGenerationRun;
    }
  | {
      type: "error";
      episode_number?: number;
      timestamp: string;
      error_type: string;
      message: string;
      status?: number;
      recoverable?: boolean;
    };

export async function generateSingleEpisode(
  project: ScriptProject,
  episode?: EpisodeGenerationContext,
  onStreamEvent?: (event: ScriptGenerationStreamEvent) => void,
  runtime?: EpisodeGenerationRuntime,
  signal?: AbortSignal,
): Promise<ScriptGenerationRun> {
  if (project.planningRevision?.status === "active") throw new Error("后续规划正在修订，请完成审校和逐集批准后再生成正文。");
  const isOverseasRelease = project.generationSettings.releaseRegion === "overseas";
  const isMainlandChina = !isOverseasRelease;
  const projectMarketProfile = marketProfileForReleaseRegion(
    project.generationSettings.releaseRegion,
  );
  const targetDurationSeconds = normalizeEpisodeDurationSeconds(
    episode?.targetDurationSeconds
      ?? project.generationSettings.preferredEpisodeDurationMinutes * 60,
  );
  const preparedRuntime = runtime ?? await prepareEpisodeGenerationRuntime(project);
  const {
    nodesResponse,
    profilesResponse,
    strategiesResponse,
    confirmedCheckpoint,
  } = preparedRuntime;
  const activeNodes = new Map(nodesResponse.data.filter((node) => node.is_active).map((node) => [node.id, node]));
  const { systemTagIds, creativeTagLabels: selectedCustomTagLabels } = resolveProjectTagSelection(project, nodesResponse.data);
  if (!hasUsableCreativeSource(project.creativePrompt, project.referenceMaterials) && systemTagIds.length === 0) {
    throw new Error("仅使用“我的标签”时需要补充创作描述或选择至少一个系统标签。");
  }
  const platform = profilesResponse.data.find(
    (item) => item.metadata?.runtime_status === "active"
      && item.metadata?.market_profile === projectMarketProfile,
  );
  if (!platform) {
    throw new Error(
      isMainlandChina
        ? "当前中国大陆市场配置不可用，请重新初始化运行资源。"
        : "当前海外市场配置不可用，请重新初始化运行资源。",
    );
  }
  const platformName = platform.platform_name.trim().toLowerCase();
  const selectedTagIds = new Set(systemTagIds);
  const platformStrategies = strategiesResponse.data.filter((item) => (
    item.status === "active" && item.target_platform.trim().toLowerCase() === platformName
  ));
  const strategy = strategiesResponse.data.find((item) => (
    item.id === project.generationStrategyId
      && item.status === "active"
      && item.target_platform.trim().toLowerCase() === platformName
  )) ?? platformStrategies
    .filter((item) => item.applicable_tags.every((tagId) => selectedTagIds.has(tagId)))
    .sort((left, right) => (
      Number(Boolean(right.draft_knowledge_bundle_id)) - Number(Boolean(left.draft_knowledge_bundle_id))
      || right.applicable_tags.length - left.applicable_tags.length
    ))[0]
    ?? platformStrategies[0];
  if (!strategy) {
    throw new Error("后端缺少生成策略，请先初始化提示词和策略资源。");
  }

  const safeTitle = (project.title.trim().length >= 3
    ? project.title.trim()
    : `${project.title.trim() || "未命名"}剧本`).slice(0, 120);
  const effectiveCreativePrompt = project.creativePrompt.trim()
    || referenceMaterialFallbackPrompt(project.referenceMaterials);
  const emotionTag = systemTagIds
    .map((tagId) => activeNodes.get(tagId))
    .find((node) => node?.category === "Emotion");
  const resolution = project.contentSpecId && project.resolvedCreativeContext
    ? {
        data: {
          content_spec: { id: project.contentSpecId },
          resolved_creative_context: project.resolvedCreativeContext,
        },
      }
    : await apiRequest<ResolutionResponse>("/content-specs/resolve-creative-intent", {
      method: "POST",
      body: JSON.stringify({
      schema_version: "v1",
      title: safeTitle,
      audience_goal: isMainlandChina
        ? { summary: "中国大陆连载漫剧与网络故事受众", priority: "primary", success_metric: "持续阅读与分集追更意愿" }
        : { summary: "英语母语的海外/国际连载漫剧与网络故事受众", priority: "primary", success_metric: "完成观看与持续追更意愿" },
      commercial_goal: isMainlandChina
        ? { summary: "建立可持续展开和后续漫剧改编的长篇故事基础", priority: "primary", success_metric: "连续性、人物稳定性与阶段性追读动力" }
        : { summary: "建立可持续展开和后续漫剧改编的长篇故事基础", priority: "primary", success_metric: "连续性、人物稳定性与阶段性追读动力" },
      platform_goal: isMainlandChina
        ? { platform_profile_id: platform.id, objective: "生成适合中国大陆漫剧制作的单集正式剧本正文，包含可视动作与实际对白", target_duration_seconds: targetDurationSeconds, target_aspect_ratio: "9:16" }
        : { platform_profile_id: platform.id, objective: "生成适合海外英语文化语境漫剧制作的单集正式剧本正文，包含中文可视动作与英文实际对白", target_duration_seconds: targetDurationSeconds, target_aspect_ratio: "9:16" },
      free_creative_prompt: effectiveCreativePrompt.slice(0, 240),
      quality_level: "high",
      budget_level: "medium",
      selected_tag_ids: systemTagIds,
      added_tag_ids: [], excluded_tag_ids: [], excluded_patterns: [],
      creative_brief: {
        hook: isMainlandChina
          ? "开篇建立明确矛盾或人物目标，并服务于长线故事发展。"
          : "开篇建立未解决的明确矛盾或人物目标，并服务于长线故事发展。",
        tone: resolveScriptTone(emotionTag?.id),
        pacing: "快节奏短剧，冲突迅速展开，保留必要因果和有效攻防",
        target_emotion: "持续期待",
        asset_constraints: [],
        generation_notes: [
          project.generationSettings.customInstructions.trim(),
          selectedCustomTagLabels.length
            ? isMainlandChina
              ? `用户自定义创作标签：${selectedCustomTagLabels.join("、")}。`
              : `用户自定义创作标签：${selectedCustomTagLabels.join("、")}。`
            : "",
          project.referenceMaterials?.length
            ? isMainlandChina
              ? `用户上传了${project.referenceMaterials.length}份创作参考资料；按文件用途约束生成。`
              : `用户上传了${project.referenceMaterials.length}份创作参考资料；按文件用途约束生成。`
            : "",
        ].filter(Boolean),
      },
      character_contexts: [],
      request_metadata: {
        frontend_project_id: project.id,
        generation_planning: {
          episode_count_mode: project.generationSettings.episodeCountMode,
          total_episodes: project.generationSettings.episodeCount,
          target_total_characters: project.generationSettings.targetTotalCharacters,
          preferred_episode_duration_minutes: project.generationSettings.preferredEpisodeDurationMinutes,
          story_density: project.generationSettings.storyDensity,
          batch_size: project.generationSettings.batchSize,
        },
      },
      }),
      signal,
      });
  // Later episodes have a current structured ledger. Sending that ledger plus
  // the older confirmed checkpoint and the prose summary duplicates most of
  // the same state and makes model latency grow with every episode.
  const provisionalContinuityCheckpoint = episode
    ? buildProvisionalContinuityCheckpoint(project, {
        episodeNumber: episode.episodeNumber,
        characterRefs: episode.relevantCharacterRefs,
        storyLineRefs: episode.plannedStoryLineRefs,
        setupPayoffRefs: [
          ...(episode.plannedSetupRefs ?? []),
          ...(episode.plannedPayoffRefs ?? []),
        ],
      })
    : null;
  const memoryRecall = episode
    ? buildEpisodeMemoryRecall(project, {
        episodeNumber: episode.episodeNumber,
        storyBibleVersion: project.storyBibleVersion,
        relevantCharacterRefs: episode.relevantCharacterRefs,
        plannedStoryLineRefs: episode.plannedStoryLineRefs,
        plannedSetupRefs: episode.plannedSetupRefs,
        plannedPayoffRefs: episode.plannedPayoffRefs,
    })
    : null;
  const storylineDuties = episode
    ? buildStorylineDuties(
        project,
        episode.episodeNumber,
        episode.plannedStoryLineRefs ?? [],
        episode.approvedEpisodePlan?.scene_execution_plan?.length
          ?? episode.adaptiveSceneCount
          ?? 3,
        memoryRecall,
        episode.approvedEpisodePlan?.scene_execution_plan?.map(scene => scene.scene_number),
      )
    : [];
  const projectContinuitySummary = episode
    ? buildContinuityGenerationSummary(
        project.storyLines,
        project.characterRelationships,
        project.characters,
        project.continuationHooks,
        project.continuityStates,
        project.setupPayoffs,
      ) || null
    : null;
  const generationRequest = {
      planning_revision_epoch: project.planningRevisionEpoch ?? 0,
      story_project_id: project.id,
      agent_request_id: episode?.agentRequestId ?? `agent-request.${crypto.randomUUID()}`,
      content_spec_id: resolution.data.content_spec.id,
      generation_strategy_id: strategy.id,
      release_region: project.generationSettings.releaseRegion,
      output_language: isOverseasRelease ? "en" : "zh",
      desired_scene_count: episode?.adaptiveSceneCount
        ?? project.generationSettings.sceneCount,
      target_episode_duration_seconds: targetDurationSeconds,
      target_script_body_characters: episode?.targetScriptBodyCharacters
        ?? targetScriptBodyCharacters(project.generationSettings),
      resolved_creative_context: resolution.data.resolved_creative_context,
      episode_context: episode ? {
        generation_mode: episode.generationMode,
        memory_layer: "provisional",
        episode_number: episode.episodeNumber,
        total_episodes: episode.totalEpisodes,
        ending_mode: episode.endingMode
          ?? episode.approvedEpisodePlan?.ending_mode
          // Legacy callers may still pass the final episode without an
          // explicit closing contract. Keep the wire default serial_hook;
          // authors can opt into a finale through the approved roadmap.
          ?? "serial_hook",
        previous_episode_summary: episode.previousEpisodeSummary?.trim()
          || (episode.previousEpisode
            ? buildEpisodeContinuitySummary(episode.previousEpisode)
            : null),
        previous_episode_handoff: episode.previousEpisodeHandoff?.trim()
          || (episode.previousEpisode ? buildEpisodeHandoff(episode.previousEpisode) : null),
        previous_episode_question: episode.previousEpisodeQuestion?.trim()
          || episode.previousEpisode?.next_episode_question
          || null,
        episode_instruction: episode.episodeInstruction?.trim() || null,
        module_handoff: episode.approvedStoryNode
          ? null
          : episode.moduleHandoff?.trim() || null,
        long_range_anchor: episode.storyBibleContext
          ? null
          : episode.longRangeAnchor?.trim() || null,
        relevant_character_refs: episode.relevantCharacterRefs ?? [],
        planned_story_line_refs: episode.plannedStoryLineRefs ?? [],
        storyline_duties: storylineDuties,
        creative_decisions: episode.creativeDecisions ?? [],
        planned_setup_refs: episode.plannedSetupRefs ?? [],
        planned_payoff_refs: episode.plannedPayoffRefs ?? [],
        planned_story_beat: episode.plannedStoryBeat?.trim() || null,
        approved_story_node: episode.approvedStoryNode ?? null,
        approved_episode_plan: episode.approvedEpisodePlan ?? null,
        story_bible_context: episode.storyBibleContext?.trim() || null,
        reference_material_context: buildEpisodeReferenceMaterialContext(
          project.referenceMaterials,
        ) || null,
        canonical_character_names: Object.fromEntries(
          new Map([
            ...Object.entries(project.canonicalCharacterNames ?? {}),
            ...canonicalCharacterNameMap(project.referenceMaterials),
          ]),
        ),
        canonical_character_name_sources: canonicalCharacterNameEntries(
          project.referenceMaterials,
        ),
        project_continuity_summary: provisionalContinuityCheckpoint
          ? null
          : projectContinuitySummary,
        confirmed_continuity_checkpoint: provisionalContinuityCheckpoint
          ? null
          : confirmedCheckpoint,
        provisional_continuity_checkpoint: provisionalContinuityCheckpoint,
        memory_recall: memoryRecall,
        batch_context: episode.batch ? {
          batch_number: episode.batch.batchNumber,
          start_episode: episode.batch.startEpisode,
          end_episode: episode.batch.endEpisode,
          batch_instruction: episode.batch.instruction?.trim() || null,
        } : null,
      } : null,
  };
  if (onStreamEvent) {
    let result: ScriptGenerationRun | undefined;
    let streamError: Error | undefined;
    await apiEventStream<ScriptGenerationStreamEvent>(
      "/script-generation/generate-draft/stream",
      {
        method: "POST",
        body: JSON.stringify(generationRequest),
        signal,
      },
      (event) => {
        onStreamEvent(event);
        if (event.type === "result") result = event.data;
        if (event.type === "error") {
          const isTransientUpstream = event.error_type === "upstream_unavailable";
          const isGatewayDeadline = event.error_type === "provider_gateway_deadline";
          const isAgentStillRunning = event.error_type === "agent_run_in_progress";
          const isEpisodeOccupied = event.error_type === "episode_generation_in_progress";
          const isCheckpointRecoverable = event.error_type === "post_edit_incomplete";
          streamError = new ApiError(
            event.message,
            event.status ?? (event.error_type === "upstream_unavailable" ? 503 : 422),
            {
              retryable: (
                isTransientUpstream
                || isGatewayDeadline
                || isAgentStillRunning
                || isCheckpointRecoverable
              )
                && event.recoverable !== false,
              failureClass: isAgentStillRunning
                ? "agent_in_progress"
                : isCheckpointRecoverable || isGatewayDeadline
                ? "checkpoint_recoverable"
                : isTransientUpstream || isAgentStillRunning
                ? "transient_upstream"
                : isEpisodeOccupied
                  ? "business"
                : event.error_type === "configuration_unavailable"
                  ? "configuration"
                  : "contract",
              errorType: event.error_type,
            },
          );
        }
      },
    );
    if (streamError) throw streamError;
    if (!result) {
      throw new ApiError(
        "The generation stream ended without a completed episode.",
        503,
        { retryable: true, failureClass: "stream_incomplete", errorType: "stream_incomplete" },
      );
    }
    return {
      ...result,
      ...(result.draft_master_script
        ? { draft_master_script: enrichDraftWithActingProfiles(project, result.draft_master_script) }
        : {}),
      content_spec_id: resolution.data.content_spec.id,
    };
  }

  const generated = await apiRequest<GenerationResponse>("/script-generation/generate-draft", {
    method: "POST",
    body: JSON.stringify(generationRequest),
    signal,
  });
  return {
    ...generated.data,
    ...(generated.data.draft_master_script
      ? { draft_master_script: enrichDraftWithActingProfiles(project, generated.data.draft_master_script) }
      : {}),
    content_spec_id: resolution.data.content_spec.id,
  };
}

export async function reviewEpisodeDraft(
  sourceGenerationRun: ScriptGenerationRun,
  draft: GeneratedDraft,
  planningRevisionEpoch = 0,
): Promise<ScriptGenerationRun> {
  const response = await apiRequest<GenerationResponse>("/script-generation/review-draft", {
    method: "POST",
    body: JSON.stringify({
      source_generation_run: sourceGenerationRun,
      draft_master_script: draft,
      planning_revision_epoch: planningRevisionEpoch,
    }),
  });
  return response.data;
}

export async function refreshEpisodeSourceForModification(
  sourceGenerationRun: ScriptGenerationRun,
  currentProject?: ScriptProject,
): Promise<ScriptGenerationRun> {
  let effectiveSource = sourceGenerationRun;
  let sourceEpisodeContext = effectiveSource.episode_context;
  // Legacy runs contain the old truncated bible summary. Refresh the exact
  // version already supplied for the author-conflict check, never the latest
  // unapproved draft, before compiling an edit or a clean reexecution.
  const approvedBible = currentProject?.storyBibleVersion && sourceEpisodeContext
    ? await loadStoryBible(currentProject.id, currentProject.storyBibleVersion)
    : null;
  if (currentProject && sourceEpisodeContext && currentProject.episodes.some(episode => (
    episode.episodeNumber === sourceEpisodeContext!.episode_number && episode.sourceAmendment
  ))) {
    const nodes = approvedBible ? await loadActiveStoryPlanNodes(
      currentProject.id, approvedBible.story_bible_id, approvedBible.version,
    ) : [];
    effectiveSource = await compileAmendedEpisodeSource(currentProject, sourceGenerationRun, approvedBible, nodes);
    sourceEpisodeContext = effectiveSource.episode_context;
  }
  const memoryProject = currentProject && sourceEpisodeContext
    ? projectBeforeEpisodeModification(currentProject, sourceEpisodeContext.episode_number)
    : currentProject;
  const previous = memoryProject?.episodes.find((episode) => (
    episode.episodeNumber === (sourceEpisodeContext?.episode_number ?? 0) - 1
  ));
  const previousDraft = previous && (previous.finalizationResult?.master_script
    ?? parseGeneratedDraft(previous.workingDraftJson)
    ?? parseGeneratedDraft(previous.confirmedDraftJson)
    ?? previous.generationRun.draft_master_script);
  const refreshedSourceGenerationRun = currentProject && sourceEpisodeContext
    ? {
        ...effectiveSource,
        episode_context: {
          ...sourceEpisodeContext,
          ...(approvedBible?.status === "approved" ? {
            story_bible_context: storyBibleEpisodeContext(
              approvedBible, undefined, {
                character_refs: sourceEpisodeContext.relevant_character_refs,
                story_line_refs: sourceEpisodeContext.planned_story_line_refs,
                setup_refs: sourceEpisodeContext.planned_setup_refs,
                payoff_refs: sourceEpisodeContext.planned_payoff_refs,
              },
            ),
          } : {}),
          project_continuity_summary: null,
          confirmed_continuity_checkpoint: null,
          provisional_continuity_checkpoint: null,
          previous_episode_summary: null,
          previous_episode_handoff: null,
          previous_episode_question: null,
          memory_recall: buildEpisodeModificationMemoryRecall(
            memoryProject ?? currentProject,
            sourceEpisodeContext.memory_recall,
            {
              episodeNumber: sourceEpisodeContext.episode_number,
              storyBibleVersion: currentProject.storyBibleVersion,
              relevantCharacterRefs: sourceEpisodeContext.relevant_character_refs,
              plannedStoryLineRefs: sourceEpisodeContext.planned_story_line_refs,
              plannedSetupRefs: sourceEpisodeContext.planned_setup_refs,
              plannedPayoffRefs: sourceEpisodeContext.planned_payoff_refs,
            },
            new Set((memoryProject?.episodes ?? []).filter((episode) => (
              episode.episodeNumber < sourceEpisodeContext.episode_number
            )).map((episode) => episode.episodeNumber)),
          ),
          ...(currentProject.episodes.some(episode => episode.episodeNumber === sourceEpisodeContext.episode_number && episode.sourceAmendment) ? {
            storyline_duties: buildStorylineDuties(
              memoryProject ?? currentProject, sourceEpisodeContext.episode_number,
              sourceEpisodeContext.planned_story_line_refs ?? [],
              sourceEpisodeContext.approved_episode_plan?.scene_execution_plan?.length ?? 1,
              null,
              sourceEpisodeContext.approved_episode_plan?.scene_execution_plan?.map(scene => scene.scene_number),
            ),
          } : {}),
          ...(previousDraft && memoryProject ? {
            previous_episode_summary: buildEpisodeContinuitySummary(previousDraft),
            previous_episode_handoff: buildEpisodeHandoff(previousDraft),
            previous_episode_question: previousDraft.next_episode_question?.trim() || null,
            provisional_continuity_checkpoint: buildProvisionalContinuityCheckpoint(memoryProject, {
              episodeNumber: sourceEpisodeContext.episode_number,
              characterRefs: sourceEpisodeContext.relevant_character_refs,
              storyLineRefs: sourceEpisodeContext.planned_story_line_refs,
              setupPayoffRefs: [...(sourceEpisodeContext.planned_setup_refs ?? []), ...(sourceEpisodeContext.planned_payoff_refs ?? [])],
            }),
            project_continuity_summary: null,
            confirmed_continuity_checkpoint: null,
          } : {}),
        },
      }
    : effectiveSource;
  return refreshedSourceGenerationRun;
}

export async function modifyEpisodeDraft(
  sourceGenerationRun: ScriptGenerationRun,
  draft: GeneratedDraft,
  instruction: string,
  signal?: AbortSignal,
  selectionContext?: StoryBibleSelectionContext | null,
  currentProject?: ScriptProject,
  resolution?: AuthorConflictResolution,
  priorAuthorInstructions: PriorAuthorInstruction[] = [],
): Promise<ScriptDraftModificationResult> {
  const refreshedSourceGenerationRun = await refreshEpisodeSourceForModification(sourceGenerationRun, currentProject);
  const response = await apiRequest<ModificationResponse>("/script-generation/modify-draft", {
    method: "POST",
    body: JSON.stringify({
      source_generation_run: {
        ...refreshedSourceGenerationRun,
        ...(currentProject && !refreshedSourceGenerationRun.story_project_id
          ? { story_project_id: currentProject.id }
          : {}),
      },
      source_draft_master_script: draft,
      source_story_bible_version: currentProject?.storyBibleVersion ?? null,
      planning_revision_epoch: currentProject?.planningRevisionEpoch ?? 0,
      instruction,
      selection_context: selectionContext ?? null,
      ...(resolution ? { resolution } : {}),
      ...(priorAuthorInstructions.length ? { prior_author_instructions: priorAuthorInstructions } : {}),
    }),
    signal,
  });
  return response.data;
}

export async function deepenEpisodeDraft(
  sourceGenerationRun: ScriptGenerationRun,
  draft: GeneratedDraft,
): Promise<CreativeDeepeningRun> {
  const response = await apiRequest<DeepeningResponse>("/script-generation/deepen-draft", {
    method: "POST",
    body: JSON.stringify({
      source_generation_run: sourceGenerationRun,
      source_draft_master_script: draft,
    }),
  });
  return response.data;
}

const CHINESE_CHARACTER = /[\u3400-\u9fff]/;

/**
 * Build the overseas display view from the canonical episode itself.
 * New episodes already contain Chinese narrative and paired dialogue, so
 * sending the complete screenplay through another translation task would be
 * both slower and less faithful to the approved draft.
 */
export function buildEmbeddedOverseasDialogueView(
  draft: GeneratedDraft,
  targetLanguage = "zh-CN-short-drama",
  characterNameMap: Record<string, string> = {},
): BilingualScriptView | undefined {
  if (
    !draft.language.toLocaleLowerCase().startsWith("en")
    || !targetLanguage.toLocaleLowerCase().startsWith("zh-cn-short-drama")
  ) return undefined;

  const chineseNameFor = (sourceName: string): string | undefined => {
    const speaker = clientDialogueSpeaker(sourceName, sourceName).speaker;
    if (CHINESE_CHARACTER.test(speaker)) return speaker;
    const match = Object.entries(characterNameMap).find(([, englishName]) => (
      clientDialogueSpeaker(englishName, englishName).speaker.toLocaleLowerCase()
      === speaker.toLocaleLowerCase()
    ));
    return match?.[0];
  };
  const items: BilingualScriptView["items"] = [];
  const embeddedNames = new Map<string, string>();
  for (const scene of draft.scenes) {
    for (const dialogue of scene.dialogues) {
      const englishName = clientDialogueSpeaker(
        dialogue.character_name,
        dialogue.character_name,
      ).speaker.toLocaleLowerCase();
      const chineseName = dialogue.chinese_character_name?.trim();
      if (chineseName && CHINESE_CHARACTER.test(chineseName)) {
        embeddedNames.set(englishName, chineseName);
      }
    }
  }
  const resolvedChineseName = (sourceName: string): string | undefined => {
    const speaker = clientDialogueSpeaker(sourceName, sourceName).speaker;
    return embeddedNames.get(speaker.toLocaleLowerCase())
      ?? chineseNameFor(sourceName);
  };
  for (const [characterIndex, character] of draft.characters.entries()) {
    const translatedName = resolvedChineseName(character.name);
    items.push({
      path: `characters.${characterIndex}.name`,
      source_text: character.name.trim(),
      translated_text: translatedName ?? character.name.trim(),
    });
  }
  for (const [sceneIndex, scene] of draft.scenes.entries()) {
    for (const [dialogueIndex, dialogue] of scene.dialogues.entries()) {
      const translation = dialogue.chinese_translation?.trim();
      const translatedName = dialogue.chinese_character_name?.trim()
        || resolvedChineseName(dialogue.character_name);
      if (!translation || !CHINESE_CHARACTER.test(translation)) {
        return undefined;
      }
      const prefix = `scenes.${sceneIndex}.dialogues.${dialogueIndex}`;
      items.push(
        {
          path: `${prefix}.character_name`,
          source_text: dialogue.character_name.trim(),
          translated_text: translatedName ?? dialogue.character_name.trim(),
        },
        {
          path: `${prefix}.text`,
          source_text: dialogue.text.trim(),
          translated_text: translation,
        },
      );
    }
  }
  if (!items.length) return undefined;
  return {
    view_version: "bilingual_script_view.v3",
    source_draft_master_script_id: draft.id,
    source_language: draft.language,
    target_language: "zh-CN-short-drama",
    items,
    warnings: [],
  };
}

function buildEpisodeContinuitySummary(draft: GeneratedDraft): string {
  const finalScene = draft.scenes[draft.scenes.length - 1];
  return [
    `本集标题：${draft.title}`,
    `剧情梗概：${draft.synopsis}`,
    finalScene?.scene_causality?.outcome ? `结尾状态变化：${finalScene.scene_causality.outcome}` : "",
    finalScene?.turning_point ? `结尾关键转折：${finalScene.turning_point}` : "",
  ].filter(Boolean).join("\n").slice(0, 2000);
}

function resolveScriptTone(emotionTagId?: string): "intense" | "melodramatic" | "suspenseful" | "emotional" {
  if (emotionTagId === "emotion.suspense") return "suspenseful";
  if (emotionTagId === "emotion.tragic" || emotionTagId === "emotion.oppressive") return "melodramatic";
  if (emotionTagId === "emotion.sweet" || emotionTagId === "emotion.healing") return "emotional";
  return "intense";
}
