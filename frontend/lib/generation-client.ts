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
import { buildProvisionalContinuityCheckpoint } from "@/lib/continuity-checkpoint";
import { loadConfirmedContinuityCheckpoint } from "@/lib/project-sync";
import {
  buildEpisodeReferenceMaterialContext,
  hasUsableCreativeSource,
  referenceMaterialFallbackPrompt,
} from "@/lib/reference-materials";
import { getTag, resolveLegacyTagId } from "@/lib/tag-catalog";
import type {
  BilingualScriptView,
  CreativeDeepeningRun,
  GeneratedDraft,
  ScriptDraftModificationResult,
  ScriptGenerationRun,
  ScriptProject,
} from "@/lib/types";
import { CURRENT_MARKET_PROFILE } from "@/lib/types";

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
}
interface ResolutionResponse { data: { content_spec: { id: string }; resolved_creative_context: unknown } }
interface GenerationResponse { data: ScriptGenerationRun }
interface ModificationResponse { data: ScriptDraftModificationResult }
interface DeepeningResponse { data: CreativeDeepeningRun }
interface BilingualViewResponse { data: BilingualScriptView }

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
  episodeNumber: number;
  totalEpisodes: number;
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
  plannedSetupRefs?: string[];
  plannedPayoffRefs?: string[];
  plannedStoryBeat?: string;
  approvedStoryNode?: StoryNodeExecutionContext;
  approvedEpisodePlan?: EpisodeExecutionPlan;
  storyBibleContext?: string;
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
): Promise<ScriptGenerationRun> {
  const isMainlandChina = CURRENT_MARKET_PROFILE === "cn_mainland";
  const isOverseasRelease = project.generationSettings.releaseRegion === "overseas";
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
  const activeNodeIds = new Set(nodesResponse.data.filter((node) => node.is_active).map((node) => node.id));
  const activeNodes = new Map(nodesResponse.data.filter((node) => node.is_active).map((node) => [node.id, node]));
  const customTags = project.customTags ?? [];
  const customTagMap = new Map(customTags.map((tag) => [tag.id, tag]));
  const systemTagIds = Array.from(new Set(
    project.selectedTagIds
      .filter((tagId) => !customTagMap.has(tagId))
      .map(resolveLegacyTagId),
  ));
  const selectedCustomTagLabels = project.selectedTagIds
    .map((tagId) => customTagMap.get(tagId)?.label)
    .filter((label): label is string => Boolean(label));
  const missingTags = systemTagIds.filter((tagId) => !activeNodeIds.has(tagId));
  if (missingTags.length) {
    throw new Error(isMainlandChina
      ? `后端本体目录缺少已选标签：${missingTags.join("、")}`
      : `Backend Ontology is missing selected tags: ${missingTags.join(", ")}`);
  }
  const platform = profilesResponse.data.find(
    (item) => item.metadata?.runtime_status === "active",
  ) ?? profilesResponse.data[0];
  if (!platform) {
    throw new Error(isMainlandChina
      ? "后端缺少平台配置，请先初始化运行资源。"
      : "Backend has no PlatformProfile. Initialize runtime resources first.");
  }
  if (!hasUsableCreativeSource(project.creativePrompt, project.referenceMaterials) && systemTagIds.length === 0) {
    throw new Error(isMainlandChina
      ? "仅使用“我的标签”时需要补充创作描述或选择至少一个系统标签。"
      : "My Tags require a creative description or at least one controlled system tag.");
  }
  const projectMarketProfile = project.marketProfile ?? "legacy_unknown";
  if (
    projectMarketProfile !== CURRENT_MARKET_PROFILE
    || platform.metadata?.market_profile !== CURRENT_MARKET_PROFILE
  ) {
    throw new Error(isMainlandChina
      ? "这个项目属于其他市场配置，请先复制为当前市场的新版本再继续生成。"
      : "This project belongs to a different market profile. Duplicate it as a new version before generating new episodes.");
  }
  const platformName = platform.platform_name.trim().toLowerCase();
  const selectedTagIds = new Set(systemTagIds);
  const platformStrategies = strategiesResponse.data.filter((item) => (
    item.status === "active" && item.target_platform.trim().toLowerCase() === platformName
  ));
  const strategy = strategiesResponse.data.find((item) => (
    item.id === project.generationStrategyId && item.status === "active"
  )) ?? platformStrategies
    .filter((item) => item.applicable_tags.every((tagId) => selectedTagIds.has(tagId)))
    .sort((left, right) => (
      Number(Boolean(right.draft_knowledge_bundle_id)) - Number(Boolean(left.draft_knowledge_bundle_id))
      || right.applicable_tags.length - left.applicable_tags.length
    ))[0]
    ?? strategiesResponse.data.find((item) => item.status === "active")
    ?? strategiesResponse.data[0];
  if (!strategy) {
    throw new Error(isMainlandChina
      ? "后端缺少生成策略，请先初始化提示词和策略资源。"
      : "Backend has no GenerationStrategy. Initialize Prompt and Strategy resources first.");
  }

  const safeTitle = (project.title.trim().length >= 3
    ? project.title.trim()
    : isMainlandChina
      ? `${project.title.trim() || "未命名"}剧本`
      : `${project.title.trim() || "New"} script`).slice(0, 120);
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
        : { summary: "Short-form serialized drama audience", priority: "primary", success_metric: "episode continuation intent" },
      commercial_goal: isMainlandChina
        ? { summary: "建立可持续展开和后续漫剧改编的长篇故事基础", priority: "primary", success_metric: "连续性、人物稳定性与阶段性追读动力" }
        : { summary: "Build sustained audience interest", priority: "primary", success_metric: "completion and continuation" },
      platform_goal: isMainlandChina
        ? { platform_profile_id: platform.id, objective: "生成适合中国大陆漫剧制作的单集正式剧本正文，包含可视动作与实际对白", target_duration_seconds: targetDurationSeconds, target_aspect_ratio: "9:16" }
        : { platform_profile_id: platform.id, objective: "Create a compelling AI comic episode", target_duration_seconds: targetDurationSeconds, target_aspect_ratio: "9:16" },
      free_creative_prompt: effectiveCreativePrompt.slice(0, 240),
      quality_level: "high",
      budget_level: "medium",
      selected_tag_ids: systemTagIds,
      added_tag_ids: [], excluded_tag_ids: [], excluded_patterns: [],
      creative_brief: {
        hook: isMainlandChina
          ? "开篇建立明确矛盾或人物目标，并服务于长线故事发展。"
          : "Open with immediate unresolved conflict.",
        tone: resolveScriptTone(emotionTag?.id),
        pacing: isMainlandChina ? "有推进但不过度压缩" : "Fast",
        target_emotion: isMainlandChina ? "持续期待" : "Anticipation",
        asset_constraints: [],
        generation_notes: [
          project.generationSettings.customInstructions.trim(),
          selectedCustomTagLabels.length
            ? isMainlandChina
              ? `用户自定义创作标签：${selectedCustomTagLabels.join("、")}。`
              : `User-defined creative tags: ${selectedCustomTagLabels.join(", ")}.`
            : "",
          project.referenceMaterials?.length
            ? isMainlandChina
              ? `用户上传了${project.referenceMaterials.length}份创作参考资料；按文件用途约束生成。`
              : `The user supplied ${project.referenceMaterials.length} creative reference files; use each only for its declared purpose.`
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
      });
  // Later episodes have a current structured ledger. Sending that ledger plus
  // the older confirmed checkpoint and the prose summary duplicates most of
  // the same state and makes model latency grow with every episode.
  const provisionalContinuityCheckpoint = episode
    ? buildProvisionalContinuityCheckpoint(project, {
        characterRefs: episode.relevantCharacterRefs,
        storyLineRefs: episode.plannedStoryLineRefs,
        setupPayoffRefs: [
          ...(episode.plannedSetupRefs ?? []),
          ...(episode.plannedPayoffRefs ?? []),
        ],
      })
    : null;
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
      content_spec_id: resolution.data.content_spec.id,
      generation_strategy_id: strategy.id,
      output_language: isOverseasRelease
        ? "en"
        : isMainlandChina
          ? "zh"
          : project.generationSettings.outputLanguage,
      desired_scene_count: episode?.adaptiveSceneCount
        ?? project.generationSettings.sceneCount,
      target_episode_duration_seconds: targetDurationSeconds,
      target_script_body_characters: isMainlandChina && !isOverseasRelease
        ? episode?.targetScriptBodyCharacters
          ?? targetScriptBodyCharacters(project.generationSettings)
        : null,
      resolved_creative_context: resolution.data.resolved_creative_context,
      episode_context: episode ? {
        generation_mode: episode.generationMode,
        episode_number: episode.episodeNumber,
        total_episodes: episode.totalEpisodes,
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
        planned_setup_refs: episode.plannedSetupRefs ?? [],
        planned_payoff_refs: episode.plannedPayoffRefs ?? [],
        planned_story_beat: episode.plannedStoryBeat?.trim() || null,
        approved_story_node: episode.approvedStoryNode ?? null,
        approved_episode_plan: episode.approvedEpisodePlan ?? null,
        story_bible_context: episode.storyBibleContext?.trim() || null,
        reference_material_context: buildEpisodeReferenceMaterialContext(
          project.referenceMaterials,
        ) || null,
        project_continuity_summary: provisionalContinuityCheckpoint
          ? null
          : projectContinuitySummary,
        confirmed_continuity_checkpoint: provisionalContinuityCheckpoint
          ? null
          : confirmedCheckpoint,
        provisional_continuity_checkpoint: provisionalContinuityCheckpoint,
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
      },
      (event) => {
        onStreamEvent(event);
        if (event.type === "result") result = event.data;
        if (event.type === "error") {
          const isTransientUpstream = event.error_type === "upstream_unavailable";
          streamError = new ApiError(
            event.message,
            event.status ?? (event.error_type === "upstream_unavailable" ? 503 : 422),
            {
              retryable: isTransientUpstream && event.recoverable !== false,
              failureClass: isTransientUpstream
                ? "transient_upstream"
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
      content_spec_id: resolution.data.content_spec.id,
    };
  }

  const generated = await apiRequest<GenerationResponse>("/script-generation/generate-draft", {
    method: "POST",
    body: JSON.stringify(generationRequest),
  });
  return {
    ...generated.data,
    content_spec_id: resolution.data.content_spec.id,
  };
}

export async function reviewEpisodeDraft(
  sourceGenerationRun: ScriptGenerationRun,
  draft: GeneratedDraft,
): Promise<ScriptGenerationRun> {
  const response = await apiRequest<GenerationResponse>("/script-generation/review-draft", {
    method: "POST",
    body: JSON.stringify({
      source_generation_run: sourceGenerationRun,
      draft_master_script: draft,
    }),
  });
  return response.data;
}

export async function modifyEpisodeDraft(
  sourceGenerationRun: ScriptGenerationRun,
  draft: GeneratedDraft,
  instruction: string,
): Promise<ScriptDraftModificationResult> {
  const response = await apiRequest<ModificationResponse>("/script-generation/modify-draft", {
    method: "POST",
    body: JSON.stringify({
      source_generation_run: sourceGenerationRun,
      source_draft_master_script: draft,
      instruction,
    }),
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

export async function buildBilingualScriptView(
  generationStrategyId: string,
  draft: GeneratedDraft,
  targetLanguage = "zh-CN",
  characterNameMap: Record<string, string> = {},
): Promise<BilingualScriptView> {
  const response = await apiRequest<BilingualViewResponse>(
    "/script-generation/build-bilingual-view",
    {
      method: "POST",
      body: JSON.stringify({
        generation_strategy_id: generationStrategyId,
        draft_master_script: draft,
        target_language: targetLanguage,
        character_name_map: characterNameMap,
      }),
    },
  );
  return response.data;
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

export function buildEpisodeHandoff(draft: GeneratedDraft): string {
  const finalScene = draft.scenes[draft.scenes.length - 1];
  const stateUpdates = (draft.character_state_updates ?? []).slice(-8).map((item) => (
    `${item.character_name}：${item.change_summary}（原因：${item.change_cause}）`
  ));
  const openObligations = (draft.setup_payoff_updates ?? [])
    .filter((item) => item.status !== "paid_off")
    .slice(-6)
    .map((item) => `${item.setup_payoff_ref}：${item.next_required_step ?? item.progress_summary}`);
  return [
    `上一集可见结果：${finalScene?.scene_causality?.outcome ?? draft.episode_goal}`,
    finalScene?.turning_point ? `结尾转折：${finalScene.turning_point}` : "",
    finalScene?.cliffhanger ? `结尾钩子：${draft.hook}` : "",
    stateUpdates.length ? `人物状态变化：${stateUpdates.join("；")}` : "",
    openObligations.length ? `未完成义务：${openObligations.join("；")}` : "",
    `下一集问题：${draft.next_episode_question}`,
  ].filter(Boolean).join("\n").slice(0, 3200);
}

function resolveScriptTone(emotionTagId?: string): "intense" | "melodramatic" | "suspenseful" | "emotional" {
  if (emotionTagId === "emotion.suspense") return "suspenseful";
  if (emotionTagId === "emotion.tragic" || emotionTagId === "emotion.oppressive") return "melodramatic";
  if (emotionTagId === "emotion.sweet" || emotionTagId === "emotion.healing") return "emotional";
  return "intense";
}
