import type { EpisodeRoadmapItem, ProjectDraft, ScriptProject } from "@/lib/types";
import type { StoryBible, StoryPlanNode } from "@/lib/story-planning-client";
import { withoutEpisodeCharacterState } from "./character-reference.ts";

interface GeneratedStoryBibleState {
  status: "draft" | "approved" | "superseded";
  version: number;
  project_title?: string | null;
}

/** Reuse only an unchanged, contiguous authored prefix after a leaf edit. */
export function unchangedRoadmapPrefixAfterNodeRevision(
  items: EpisodeRoadmapItem[], previous: StoryPlanNode, next: StoryPlanNode,
): EpisodeRoadmapItem[] {
  const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
  const boundaryFields = [
    "node_id", "story_project_id", "story_bible_id", "story_bible_version",
    "parent_node_id", "parent_node_version", "predecessor_node_id", "predecessor_node_version",
    "planned_start_episode", "planned_end_episode", "entry_state",
    "character_refs", "story_line_refs", "setup_refs", "payoff_refs",
  ] as const;
  if (next.version <= previous.version || boundaryFields.some((field) => !same(previous[field], next[field]))) return [];
  const before = previous.episode_developments ?? [];
  const after = next.episode_developments ?? [];
  const start = previous.planned_start_episode;
  const end = previous.planned_end_episode;
  if (start == null || end == null || before.length !== end - start + 1 || after.length !== before.length) return [];
  const candidates = items.filter((item) => item.source_node_id === previous.node_id
    && item.source_node_version === previous.version && item.story_bible_version === previous.story_bible_version);
  const retained: EpisodeRoadmapItem[] = [];
  const eventFields = ["episode_number", "synopsis", "entry_state", "exit_state", "source_turning_points", "source_unit_story_beats"] as const;
  for (let index = 0; index < before.length; index += 1) {
    const oldEvent = before[index];
    const newEvent = after[index];
    const matches = candidates.filter((item) => item.episode_number === start + index);
    if (oldEvent.episode_number !== start + index || newEvent.episode_number !== start + index
      || eventFields.some((field) => !same(oldEvent[field], newEvent[field])) || matches.length !== 1) break;
    const item = matches[0];
    // A matching upper plan cannot legitimize an already stale lower source/state.
    if ((["entry_state", "exit_state", "source_turning_points", "source_unit_story_beats"] as const)
      .some((field) => !same(item[field], oldEvent[field]))) break;
    retained.push({ ...item, source_node_version: next.version, status: "draft" });
  }
  return retained;
}

export function canRegenerateStoryBible(project: ScriptProject): boolean {
  return project.episodes.length === 0;
}

/** Restart downstream planning from the reviewed canon, without discarding it. */
export function storyPlanningRevisionSeed(project: ScriptProject): {
  draft: ProjectDraft;
  patch: Partial<ScriptProject>;
} {
  return structuredClone({
    draft: {
      title: `${project.title.trim()} · 剧情修订`,
      titleSource: "user" as const,
      creativePrompt: project.creativePrompt,
      referenceMaterials: project.referenceMaterials ?? [],
      selectedTagIds: project.selectedTagIds,
      customTags: project.customTags,
      characters: (project.characters ?? []).map(withoutEpisodeCharacterState),
      generationSettings: project.generationSettings,
      inputReadiness: project.inputReadiness,
    },
    patch: {
      sourceProjectId: project.id,
      canonicalCharacterNames: project.canonicalCharacterNames,
      selectedCreativeDirection: project.selectedCreativeDirection,
      storyBibleAuthorInstruction: project.storyBibleAuthorInstruction,
      storySynopsis: project.storySynopsis,
      contentSpecId: project.contentSpecId,
      resolvedCreativeContext: project.resolvedCreativeContext,
      generationStrategyId: project.generationStrategyId,
      productionOutputMode: project.productionOutputMode,
    },
  });
}

/** saveStoryBibleDraft will persist this seed as the new project's first draft. */
export function storyBibleRevisionSeed(
  source: StoryBible,
  projectId: string,
  bibleId: string,
  createdAt: string,
): StoryBible {
  if (source.status !== "approved" || projectId === source.story_project_id) {
    throw new Error("剧情修订副本需要已确认总纲和独立项目。");
  }
  return {
    ...structuredClone(source),
    story_project_id: projectId,
    story_bible_id: bibleId,
    version: 0,
    status: "draft",
    created_at: createdAt,
    approved_at: null,
  };
}

export function storyBibleRewriteVersionSeed(
  project: ScriptProject,
  versionSuffix: string,
): {
  draft: ProjectDraft;
  patch: Partial<ScriptProject>;
} {
  return {
    draft: {
      title: `${project.title.trim()} - ${versionSuffix}`,
      titleSource: "user",
      creativePrompt: project.creativePrompt,
      referenceMaterials: (project.referenceMaterials ?? []).map((item) => ({ ...item })),
      selectedTagIds: [...project.selectedTagIds],
      customTags: project.customTags.map((item) => ({ ...item })),
      characters: (project.characters ?? [])
        .filter((item) => item.source !== "generated")
        .map((item) => ({ ...item })),
      inputReadiness: project.inputReadiness
        ? {
            ...project.inputReadiness,
            coverage: { ...project.inputReadiness.coverage },
            missingItems: [...project.inputReadiness.missingItems],
            evidence: [...project.inputReadiness.evidence],
            sourceKinds: project.inputReadiness.sourceKinds
              ? [...project.inputReadiness.sourceKinds]
              : undefined,
            supplementQuestions: project.inputReadiness.supplementQuestions
              ? [...project.inputReadiness.supplementQuestions]
              : undefined,
          }
        : undefined,
      generationSettings: { ...project.generationSettings },
    },
    patch: {
      sourceProjectId: project.id,
      creativeDirectionCandidates: project.creativeDirectionCandidates?.map((item) => ({ ...item })),
      creativeDirectionInputSignature: project.creativeDirectionInputSignature,
      selectedCreativeDirection: project.selectedCreativeDirection
        ? { ...project.selectedCreativeDirection }
        : undefined,
      planningSession: project.planningSession
        ? { ...project.planningSession, turns: project.planningSession.turns.map((turn) => ({ ...turn })) }
        : undefined,
      storyTreeQualityAudit: undefined,
    },
  };
}

export function storyBibleRegenerationPatch(
  project: ScriptProject,
  generated: GeneratedStoryBibleState,
): Partial<ScriptProject> {
  if (!canRegenerateStoryBible(project)) {
    throw new Error("Cannot regenerate the Story Bible after episode generation has started.");
  }
  return {
    ...(project.titleSource === "user" || !generated.project_title?.trim()
      ? {}
      : {
          title: generated.project_title.trim(),
          titleSource: "generated" as const,
        }),
    contentSpecId: project.contentSpecId,
    resolvedCreativeContext: project.resolvedCreativeContext,
    generationStrategyId: project.generationStrategyId,
    storyBibleInputSignature: project.storyBibleInputSignature,
    storyBibleSynopsisOutdated: false,
    storyBibleStatus: generated.status,
    storyBibleVersion: generated.version,
    // Episode-plan source audits are lineage-bound to the prior Story Bible;
    // a new draft/version must be inspected again instead of being reused.
    episodePlanImportDraft: undefined,
    episodePlanMaterializations: [],
    episodePlansReadyThrough: undefined,
    episodeRoadmaps: [],
    storyTreeQualityAudit: undefined,
    continuationHooks: [],
    setupPayoffs: [],
    continuityStates: [],
    episodes: [],
    generationBatches: [],
    activeGenerationTask: undefined,
    activeEpisodeNumber: 1,
    characters: (project.characters ?? []).filter((item) => item.source !== "generated"),
    storyLines: [],
    characterRelationships: [],
    generationRun: undefined,
    revisionRun: undefined,
    finalizationResult: undefined,
    workingDraftJson: undefined,
    hasLocalDraftEdits: false,
    status: "idea",
  };
}
