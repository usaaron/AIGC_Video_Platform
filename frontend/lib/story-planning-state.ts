import type { ProjectDraft, ScriptProject } from "@/lib/types";

interface GeneratedStoryBibleState {
  status: "draft" | "approved" | "superseded";
  version: number;
  project_title?: string | null;
}

export function canRegenerateStoryBible(project: ScriptProject): boolean {
  return project.episodes.length === 0;
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
      generationSettings: { ...project.generationSettings },
    },
    patch: {
      sourceProjectId: project.id,
      creativeDirectionCandidates: project.creativeDirectionCandidates?.map((item) => ({ ...item })),
      creativeDirectionInputSignature: project.creativeDirectionInputSignature,
      selectedCreativeDirection: project.selectedCreativeDirection
        ? { ...project.selectedCreativeDirection }
        : undefined,
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
    storyBibleStatus: generated.status,
    storyBibleVersion: generated.version,
    episodePlansReadyThrough: undefined,
    episodeRoadmaps: [],
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
