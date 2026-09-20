import type { ScriptProject } from "@/lib/types";
import { overseasStoryProfileForApi } from "./overseas-story-profile";

export function creativeDirectionInputSignature(project: ScriptProject): string {
  const profile = overseasStoryProfileForApi(project.generationSettings);
  return JSON.stringify({
    creativePrompt: project.creativePrompt.trim(),
    referenceMaterials: referenceMaterialSignature(project),
    selectedTagIds: [...project.selectedTagIds].sort(),
    customTags: (project.customTags ?? [])
      .map((item) => [item.id, item.label.trim()])
      .sort(([left], [right]) => left.localeCompare(right)),
    ...(profile ? { overseasStoryProfile: profile } : {}),
  });
}

export function storyPlanningInputSignature(project: ScriptProject): string {
  const profile = overseasStoryProfileForApi(project.generationSettings);
  return JSON.stringify({
    creativePrompt: project.creativePrompt.trim(),
    referenceMaterials: referenceMaterialSignature(project),
    selectedTagIds: [...project.selectedTagIds].sort(),
    customTags: (project.customTags ?? [])
      .map((item) => [item.id, item.label.trim()])
      .sort(([left], [right]) => left.localeCompare(right)),
    selectedCreativeDirection: project.selectedCreativeDirection
      ? {
          title: project.selectedCreativeDirection.title.trim(),
          style: project.selectedCreativeDirection.style_description.trim(),
          content: project.selectedCreativeDirection.content_description.trim(),
        }
      : null,
    authorInstruction: project.storyBibleAuthorInstruction?.trim() ?? "",
    generation: {
      releaseRegion: project.generationSettings.releaseRegion,
      episodeCountMode: project.generationSettings.episodeCountMode,
      episodeCount: project.generationSettings.episodeCount,
      targetTotalCharacters: project.generationSettings.targetTotalCharacters,
      storyDensity: project.generationSettings.storyDensity,
      customInstructions: project.generationSettings.customInstructions.trim(),
      ...(profile ? { overseasStoryProfile: profile } : {}),
    },
  });
}

function referenceMaterialSignature(project: ScriptProject) {
  return (project.referenceMaterials ?? []).map((item) => ({
    id: item.id,
    fileName: item.fileName,
    purpose: item.purpose,
    purposeNote: item.purposeNote.trim(),
    originalCharacterCount: item.originalCharacterCount,
    extractedCharacterCount: item.extractedText.length,
  }));
}
