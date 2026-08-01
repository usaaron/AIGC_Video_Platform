import type {
  CharacterDraft,
  CharacterRelationship,
  EpisodeWorkspace,
  GeneratedDraft,
  ProjectStoryLine,
} from "@/lib/types";

export function synchronizeContinuity(
  creativePrompt: string,
  characters: CharacterDraft[],
  episodes: EpisodeWorkspace[],
  existingStoryLines: ProjectStoryLine[] = [],
  existingRelationships: CharacterRelationship[] = [],
): {
  storyLines: ProjectStoryLine[];
  characterRelationships: CharacterRelationship[];
} {
  const drafts = episodes
    .slice()
    .sort((left, right) => left.episodeNumber - right.episodeNumber)
    .map((episode) => ({
      episodeNumber: episode.episodeNumber,
      draft: resolveEpisodeDraft(episode),
    }));

  const existingMain = existingStoryLines.find((line) => line.id === "storyline.main");
  const mainLine: ProjectStoryLine = {
    id: "storyline.main",
    title: existingMain?.title ?? "Main Story",
    type: existingMain?.type ?? "main",
    summary: existingMain?.userEdited
      ? existingMain.summary
      : creativePrompt.trim() || drafts[0]?.draft.synopsis || "Main story direction",
    status: existingMain?.status ?? "active",
    characterIds: existingMain?.characterIds.length
      ? existingMain.characterIds
      : characters.map((character) => character.id),
    episodeBeats: drafts.map(({ episodeNumber, draft }) => ({
      episodeNumber,
      summary: draft.episode_goal?.trim() || draft.synopsis.trim(),
    })),
    userEdited: existingMain?.userEdited ?? false,
  };

  const automaticCharacterLines = characters.map((character): ProjectStoryLine => {
    const id = `storyline.character.${character.id}`;
    const existing = existingStoryLines.find((line) => line.id === id);
    const episodeBeats = drafts.flatMap(({ episodeNumber, draft }) => {
      const evidence = findCharacterEpisodeEvidence(draft, character.name);
      return evidence ? [{ episodeNumber, summary: evidence }] : [];
    });
    return {
      id,
      title: existing?.title ?? `${character.name} Character Arc`,
      type: existing?.type ?? "character_arc",
      summary: existing?.userEdited
        ? existing.summary
        : character.description.trim()
          || character.background.trim()
          || character.role.trim()
          || `${character.name}'s development across the story.`,
      status: existing?.status ?? "active",
      characterIds: [character.id],
      episodeBeats,
      userEdited: existing?.userEdited ?? false,
    };
  });

  const manualLines = existingStoryLines.filter((line) => (
    line.id !== "storyline.main"
    && !line.id.startsWith("storyline.character.")
  ));

  const automaticRelationships = buildRelationships(
    characters,
    drafts,
    existingRelationships,
  );
  const automaticRelationshipIds = new Set(
    automaticRelationships.map((relationship) => relationship.id),
  );
  const manualRelationships = existingRelationships.filter(
    (relationship) => !automaticRelationshipIds.has(relationship.id),
  );

  return {
    storyLines: [mainLine, ...automaticCharacterLines, ...manualLines],
    characterRelationships: [
      ...automaticRelationships,
      ...manualRelationships,
    ],
  };
}

export function buildContinuityGenerationSummary(
  storyLines: ProjectStoryLine[],
  relationships: CharacterRelationship[],
  characters: CharacterDraft[],
): string {
  const characterNames = new Map(
    characters.map((character) => [character.id, character.name]),
  );
  const storyLineText = storyLines
    .filter((line) => line.status !== "resolved")
    .slice(0, 8)
    .map((line) => [
      `[${line.type}/${line.status}] ${line.title}: ${line.summary}`,
      line.episodeBeats.length
        ? `Latest development: ${line.episodeBeats.at(-1)?.summary}`
        : "",
    ].filter(Boolean).join(" "))
    .join("\n");
  const relationshipText = relationships
    .slice(0, 12)
    .map((relationship) => {
      const source = characterNames.get(relationship.sourceCharacterId)
        ?? relationship.sourceCharacterId;
      const target = characterNames.get(relationship.targetCharacterId)
        ?? relationship.targetCharacterId;
      return `${source} <-> ${target}: ${relationship.relationshipType}. ${relationship.currentState}`;
    })
    .join("\n");

  return [
    storyLineText ? `ACTIVE STORY LINES:\n${storyLineText}` : "",
    relationshipText ? `CURRENT RELATIONSHIPS:\n${relationshipText}` : "",
  ].filter(Boolean).join("\n\n").slice(0, 4000);
}

function buildRelationships(
  characters: CharacterDraft[],
  drafts: Array<{ episodeNumber: number; draft: GeneratedDraft }>,
  existingRelationships: CharacterRelationship[],
): CharacterRelationship[] {
  const relationships: CharacterRelationship[] = [];
  for (let sourceIndex = 0; sourceIndex < characters.length; sourceIndex += 1) {
    for (
      let targetIndex = sourceIndex + 1;
      targetIndex < characters.length;
      targetIndex += 1
    ) {
      const source = characters[sourceIndex];
      const target = characters[targetIndex];
      const id = relationshipId(source.id, target.id);
      const existing = existingRelationships.find(
        (relationship) => relationship.id === id,
      );
      const episodeChanges = drafts.flatMap(({ episodeNumber, draft }) => {
        const evidence = findRelationshipEvidence(
          draft,
          source.name,
          target.name,
        );
        return evidence ? [{ episodeNumber, summary: evidence }] : [];
      });
      relationships.push({
        id,
        sourceCharacterId: source.id,
        targetCharacterId: target.id,
        relationshipType: existing?.userEdited
          ? existing.relationshipType
          : existing?.relationshipType
            || inferRelationshipType(source, target),
        currentState: existing?.userEdited
          ? existing.currentState
          : episodeChanges.at(-1)?.summary
            || existing?.currentState
            || "Relationship not yet established on screen.",
        episodeChanges,
        userEdited: existing?.userEdited ?? false,
      });
    }
  }
  return relationships;
}

function findCharacterEpisodeEvidence(
  draft: GeneratedDraft,
  characterName: string,
): string | null {
  const normalizedName = characterName.trim().toLocaleLowerCase();
  const matchingScene = draft.scenes.find((scene) => {
    const dialogueMatch = scene.dialogues.some(
      (dialogue) => dialogue.character_name.trim().toLocaleLowerCase()
        === normalizedName,
    );
    const actionMatch = scene.character_actions.some(
      (action) => action.toLocaleLowerCase().includes(normalizedName),
    );
    return dialogueMatch || actionMatch;
  });
  if (!matchingScene) return null;
  return matchingScene.scene_causality?.outcome
    || matchingScene.turning_point
    || matchingScene.beat_summary;
}

function findRelationshipEvidence(
  draft: GeneratedDraft,
  sourceName: string,
  targetName: string,
): string | null {
  const source = sourceName.trim().toLocaleLowerCase();
  const target = targetName.trim().toLocaleLowerCase();
  const matchingScene = draft.scenes.find((scene) => {
    const text = [
      scene.beat_summary,
      ...scene.character_actions,
      ...scene.dialogues.flatMap((dialogue) => [
        dialogue.character_name,
        dialogue.text,
      ]),
    ].join(" ").toLocaleLowerCase();
    return text.includes(source) && text.includes(target);
  });
  if (!matchingScene) return null;
  return matchingScene.scene_causality?.outcome
    || matchingScene.turning_point
    || matchingScene.beat_summary;
}

function inferRelationshipType(
  source: CharacterDraft,
  target: CharacterDraft,
): string {
  const roles = `${source.role} ${target.role}`.toLocaleLowerCase();
  if (/romantic|lover|counterpart|love interest/.test(roles)) {
    return "Romantic tension";
  }
  if (/antagonist|enemy|rival/.test(roles)) return "Opposition";
  if (/ally|friend|partner/.test(roles)) return "Alliance";
  return "Developing relationship";
}

function relationshipId(sourceId: string, targetId: string): string {
  return `relationship.${[sourceId, targetId].sort().join(".")}`;
}

function resolveEpisodeDraft(episode: EpisodeWorkspace): GeneratedDraft {
  return episode.finalizationResult?.master_script
    ?? parseDraft(episode.confirmedDraftJson)
    ?? parseDraft(episode.workingDraftJson)
    ?? episode.generationRun.draft_master_script;
}

function parseDraft(value?: string): GeneratedDraft | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as GeneratedDraft;
    return Array.isArray(parsed.scenes) ? parsed : null;
  } catch {
    return null;
  }
}
