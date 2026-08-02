import { apiRequest } from "@/lib/api-client";
import { buildContinuityGenerationSummary } from "@/lib/continuity";
import { targetScriptBodyCharacters } from "@/lib/generation-planning";
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

export interface EpisodeGenerationContext {
  generationMode: "sequential" | "full";
  episodeNumber: number;
  totalEpisodes: number;
  previousEpisode?: GeneratedDraft;
  episodeInstruction?: string;
  batch?: {
    batchNumber: number;
    startEpisode: number;
    endEpisode: number;
    instruction?: string;
  };
}

export async function generateSingleEpisode(
  project: ScriptProject,
  episode?: EpisodeGenerationContext,
): Promise<ScriptGenerationRun> {
  const [nodesResponse, profilesResponse, strategiesResponse] = await Promise.all([
    apiRequest<ApiList<OntologyNode>>("/ontology-nodes"),
    apiRequest<ApiList<PlatformProfile>>("/platform-profiles"),
    apiRequest<ApiList<GenerationStrategy>>("/generation-strategies"),
  ]);
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
  if (missingTags.length) throw new Error(`Backend Ontology is missing selected tags: ${missingTags.join(", ")}`);
  const platform = profilesResponse.data.find(
    (item) => item.metadata?.runtime_status === "active",
  ) ?? profilesResponse.data[0];
  if (!platform) throw new Error("Backend has no PlatformProfile. Initialize runtime resources first.");
  const isMainlandChina = platform.metadata?.market_profile === "cn_mainland";
  const projectMarketProfile = project.marketProfile ?? "legacy_unknown";
  if (
    projectMarketProfile !== CURRENT_MARKET_PROFILE
    || platform.metadata?.market_profile !== CURRENT_MARKET_PROFILE
  ) {
    throw new Error(
      "This project belongs to a different market profile. Duplicate it as a new version before generating new episodes.",
    );
  }
  const platformName = platform.platform_name.trim().toLowerCase();
  const selectedTagIds = new Set(systemTagIds);
  const platformStrategies = strategiesResponse.data.filter((item) => (
    item.status === "active" && item.target_platform.trim().toLowerCase() === platformName
  ));
  const strategy = platformStrategies
    .filter((item) => item.applicable_tags.every((tagId) => selectedTagIds.has(tagId)))
    .sort((left, right) => (
      Number(Boolean(right.draft_knowledge_bundle_id)) - Number(Boolean(left.draft_knowledge_bundle_id))
      || right.applicable_tags.length - left.applicable_tags.length
    ))[0]
    ?? strategiesResponse.data.find((item) => item.status === "active")
    ?? strategiesResponse.data[0];
  if (!strategy) throw new Error("Backend has no GenerationStrategy. Initialize Prompt and Strategy resources first.");

  const safeTitle = project.title.trim().length >= 3 ? project.title.trim() : `${project.title.trim() || "New"} script`;
  const emotionTag = systemTagIds
    .map((tagId) => activeNodes.get(tagId))
    .find((node) => node?.category === "Emotion");
  const resolution = await apiRequest<ResolutionResponse>("/content-specs/resolve-creative-intent", {
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
        ? { platform_profile_id: platform.id, objective: "生成适合中国大陆市场参考的连载故事单集框架", target_duration_seconds: Math.round(project.generationSettings.preferredEpisodeDurationMinutes * 60), target_aspect_ratio: "9:16" }
        : { platform_profile_id: platform.id, objective: "Create a compelling AI comic episode", target_duration_seconds: Math.round(project.generationSettings.preferredEpisodeDurationMinutes * 60), target_aspect_ratio: "9:16" },
      free_creative_prompt: project.creativePrompt.trim().slice(0, 240),
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
        ].filter(Boolean),
      },
      character_contexts: project.characters.map((character, index) => {
        const explicitRole = character.role.trim();
        const role = explicitRole || (index === 0 ? "Protagonist" : "Supporting Character");
        const descriptionParts = [
          character.age.trim() ? `Age: ${character.age.trim()}` : "",
          character.gender.trim() ? `Gender: ${character.gender.trim()}` : "",
          character.background.trim() ? `Background: ${character.background.trim()}` : "",
          character.appearance.trim() ? `Appearance: ${character.appearance.trim()}` : "",
          character.description.trim(),
        ].filter(Boolean);
        const description = descriptionParts.join(". ").slice(0, 500);
        return {
          character_ref: `character.${character.id.replace(/[^a-zA-Z0-9_.-]/g, "-")}`,
          name: character.name.trim(),
          role,
          ...(description ? { description } : {}),
          locked_fields: [
            "name",
            ...(explicitRole ? ["role"] : []),
            ...(description ? ["description"] : []),
          ],
          field_sources: {
            name: "user_provided",
            role: explicitRole ? "user_provided" : "ai_inferred",
            ...(description ? { description: "user_provided" } : {}),
          },
        };
      }),
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
  const generated = await apiRequest<GenerationResponse>("/script-generation/generate-draft", {
    method: "POST",
    body: JSON.stringify({
      content_spec_id: resolution.data.content_spec.id,
      generation_strategy_id: strategy.id,
      output_language: isMainlandChina ? "zh" : project.generationSettings.outputLanguage,
      desired_scene_count: project.generationSettings.sceneCount,
      target_script_body_characters: isMainlandChina
        ? targetScriptBodyCharacters(project.generationSettings)
        : null,
      resolved_creative_context: resolution.data.resolved_creative_context,
      episode_context: episode ? {
        generation_mode: episode.generationMode,
        episode_number: episode.episodeNumber,
        total_episodes: episode.totalEpisodes,
        previous_episode_summary: episode.previousEpisode
          ? buildEpisodeContinuitySummary(episode.previousEpisode)
          : null,
        previous_episode_question: episode.previousEpisode?.next_episode_question ?? null,
        episode_instruction: episode.episodeInstruction?.trim() || null,
        project_continuity_summary: buildContinuityGenerationSummary(
          project.storyLines,
          project.characterRelationships,
          project.characters,
        ) || null,
        batch_context: episode.batch ? {
          batch_number: episode.batch.batchNumber,
          start_episode: episode.batch.startEpisode,
          end_episode: episode.batch.endEpisode,
          batch_instruction: episode.batch.instruction?.trim() || null,
        } : null,
      } : null,
    }),
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
): Promise<BilingualScriptView> {
  const response = await apiRequest<BilingualViewResponse>(
    "/script-generation/build-bilingual-view",
    {
      method: "POST",
      body: JSON.stringify({
        generation_strategy_id: generationStrategyId,
        draft_master_script: draft,
        target_language: "zh-CN",
      }),
    },
  );
  return response.data;
}

function buildEpisodeContinuitySummary(draft: GeneratedDraft): string {
  const finalScene = draft.scenes[draft.scenes.length - 1];
  return [
    `Episode title: ${draft.title}`,
    `Synopsis: ${draft.synopsis}`,
    finalScene?.scene_causality?.outcome ? `Final state change: ${finalScene.scene_causality.outcome}` : "",
    finalScene?.turning_point ? `Final turning point: ${finalScene.turning_point}` : "",
  ].filter(Boolean).join("\n").slice(0, 2000);
}

function resolveScriptTone(emotionTagId?: string): "intense" | "melodramatic" | "suspenseful" | "emotional" {
  if (emotionTagId === "emotion.suspense") return "suspenseful";
  if (emotionTagId === "emotion.tragic" || emotionTagId === "emotion.oppressive") return "melodramatic";
  if (emotionTagId === "emotion.sweet" || emotionTagId === "emotion.healing") return "emotional";
  return "intense";
}
