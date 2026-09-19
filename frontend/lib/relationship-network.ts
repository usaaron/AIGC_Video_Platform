import type {
  CharacterDraft,
  EpisodeWorkspace,
  GeneratedDraft,
  ScriptProject,
} from "@/lib/types";
import { parseGeneratedDraft } from "@/lib/generated-draft-parser";

export interface RelationshipNodePosition {
  id: string;
  x: number;
  y: number;
}

export interface RelationshipNetworkProgress {
  completedEpisodes: number;
  totalEpisodes: number;
  percentage: number;
  ready: boolean;
}

export interface CoreRelationshipCharacter {
  character: CharacterDraft;
  score: number;
  episodeCount: number;
}

type RelationshipNetworkProject = Pick<
  ScriptProject,
  "characters" | "characterRelationships" | "episodes" | "generationSettings" | "storyLines"
>;

export function relationshipNetworkProgress(
  project: Pick<ScriptProject, "episodes" | "generationSettings">,
): RelationshipNetworkProgress {
  const totalEpisodes = Math.max(0, project.generationSettings.episodeCount);
  const completedEpisodeNumbers = new Set(
    project.episodes
      .filter((episode) => (
        episode.episodeNumber >= 1
        && episode.episodeNumber <= totalEpisodes
        && Boolean(resolveEpisodeDraft(episode))
      ))
      .map((episode) => episode.episodeNumber),
  );
  const completedEpisodes = completedEpisodeNumbers.size;
  return {
    completedEpisodes,
    totalEpisodes,
    percentage: totalEpisodes
      ? Math.min(100, Math.round((completedEpisodes / totalEpisodes) * 100))
      : 0,
    ready: totalEpisodes > 0 && completedEpisodes === totalEpisodes,
  };
}

export function selectCoreRelationshipCharacters(
  project: RelationshipNetworkProject,
  maximumCharacters = 8,
): CoreRelationshipCharacter[] {
  if (!project.characters.length || maximumCharacters <= 0) return [];

  const evidence = new Map(project.characters.map((character) => [character.id, {
    character,
    episodeNumbers: new Set<number>(),
    dialogueAndActionCount: 0,
    plotContributionCount: 0,
    relationshipWeight: 0,
  }]));
  const characterByName = new Map(
    project.characters.map((character) => [normalizeName(character.name), character]),
  );

  for (const episode of project.episodes) {
    const draft = resolveEpisodeDraft(episode);
    if (!draft) continue;
    const touchedThisEpisode = new Set<string>();
    const touchByName = (name: string, weight = 0) => {
      const character = characterByName.get(normalizeName(name));
      if (!character) return;
      touchedThisEpisode.add(character.id);
      const item = evidence.get(character.id);
      if (item) item.dialogueAndActionCount += weight;
    };

    for (const character of draft.characters ?? []) touchByName(character.name);
    for (const update of draft.character_state_updates ?? []) {
      touchByName(update.character_name);
      const character = characterByName.get(normalizeName(update.character_name));
      const item = character ? evidence.get(character.id) : null;
      if (item) item.plotContributionCount += 2;
    }
    for (const update of draft.relationship_state_updates ?? []) {
      touchByName(update.source_character_name);
      touchByName(update.target_character_name);
      const source = characterByName.get(normalizeName(update.source_character_name));
      const target = characterByName.get(normalizeName(update.target_character_name));
      if (source) evidence.get(source.id)!.plotContributionCount += 1;
      if (target) evidence.get(target.id)!.plotContributionCount += 1;
    }
    for (const scene of draft.scenes ?? []) {
      for (const dialogue of scene.dialogues ?? []) touchByName(dialogue.character_name, 2);
      for (const action of scene.character_actions ?? []) {
        const normalizedAction = normalizeName(action);
        for (const character of project.characters) {
          if (normalizedAction.includes(normalizeName(character.name))) {
            touchedThisEpisode.add(character.id);
            evidence.get(character.id)!.dialogueAndActionCount += 1;
          }
        }
      }
    }
    for (const characterId of touchedThisEpisode) {
      evidence.get(characterId)?.episodeNumbers.add(episode.episodeNumber);
    }
  }

  for (const relationship of project.characterRelationships) {
    const changeWeight = 1 + Math.min(4, relationship.episodeChanges.length);
    const source = evidence.get(relationship.sourceCharacterId);
    const target = evidence.get(relationship.targetCharacterId);
    if (source) source.relationshipWeight += changeWeight;
    if (target) target.relationshipWeight += changeWeight;
  }
  for (const line of project.storyLines) {
    if (line.type === "main") continue;
    const weight = 1 + Math.min(4, line.episodeBeats.length);
    for (const characterId of line.characterIds) {
      const item = evidence.get(characterId);
      if (item) item.plotContributionCount += weight;
    }
  }

  const values = [...evidence.values()];
  const maxEpisodeCount = Math.max(1, ...values.map((item) => item.episodeNumbers.size));
  const maxDialogueAndActionCount = Math.max(1, ...values.map((item) => item.dialogueAndActionCount));
  const maxPlotContributionCount = Math.max(1, ...values.map((item) => item.plotContributionCount));
  const maxRelationshipWeight = Math.max(1, ...values.map((item) => item.relationshipWeight));
  const scored = values.map((item, index) => ({
    character: item.character,
    episodeCount: item.episodeNumbers.size,
    score: (
      (item.episodeNumbers.size / maxEpisodeCount) * 35
      + (item.plotContributionCount / maxPlotContributionCount) * 30
      + (item.relationshipWeight / maxRelationshipWeight) * 20
      + (item.dialogueAndActionCount / maxDialogueAndActionCount) * 15
      + rolePriority(item.character.role) * 20
    ),
    originalIndex: index,
  })).sort((left, right) => (
    right.score - left.score
    || right.episodeCount - left.episodeCount
    || left.originalIndex - right.originalIndex
  ));

  const protagonist = scored.find((item) => rolePriority(item.character.role) === 2);
  const antagonist = scored.find((item) => rolePriority(item.character.role) === 1);
  const selected = [protagonist, antagonist, ...scored]
    .filter((item): item is (typeof scored)[number] => Boolean(item))
    .filter((item, index, items) => (
      items.findIndex((candidate) => candidate.character.id === item.character.id) === index
    ))
    .slice(0, Math.min(maximumCharacters, scored.length));

  return selected
    .map(({ character, score, episodeCount }) => ({ character, score, episodeCount }));
}

export function layoutRelationshipNodes(
  ids: string[],
  focalCharacterId = ids[0],
): RelationshipNodePosition[] {
  if (ids.length === 0) return [];
  if (ids.length === 1) return [{ id: ids[0], x: 500, y: 310 }];
  if (ids.length === 2) {
    return [
      { id: ids[0], x: 300, y: 310 },
      { id: ids[1], x: 700, y: 310 },
    ];
  }

  const focalId = ids.includes(focalCharacterId) ? focalCharacterId : ids[0];
  const secondaryIds = ids.filter((id) => id !== focalId);
  const leftIds = secondaryIds.filter((_, index) => index % 2 === 0);
  const rightIds = secondaryIds.filter((_, index) => index % 2 === 1);
  const column = (columnIds: string[], x: number) => columnIds.map((id, index) => ({
    id,
    x,
    // Leave room beneath each avatar for its name and role.
    y: columnIds.length === 1 ? 310 : Math.round(70 + 430 * index / (columnIds.length - 1)),
  }));
  return [
    { id: focalId, x: 500, y: 310 },
    ...column(leftIds, 220),
    ...column(rightIds, 780),
  ];
}

function resolveEpisodeDraft(episode: EpisodeWorkspace): GeneratedDraft | null {
  if (episode.finalizationResult?.master_script) return episode.finalizationResult.master_script;
  const confirmed = parseDraft(episode.confirmedDraftJson);
  if (confirmed) return confirmed;
  const working = parseDraft(episode.workingDraftJson);
  if (working) return working;
  const generated = episode.generationRun?.draft_master_script;
  return generated && Array.isArray(generated.scenes) && generated.scenes.length
    ? generated
    : null;
}

function parseDraft(value?: string): GeneratedDraft | null {
  return parseGeneratedDraft(value, { requireNonEmptyScenes: true });
}

function normalizeName(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/[\s·.\-_]+/g, "");
}

function rolePriority(role: string): number {
  const normalized = role.trim().toLocaleLowerCase();
  if (/(主角|男主|女主|protagonist|lead|hero|heroine)/u.test(normalized)) return 2;
  if (/(反派|主要对手|宿敌|antagonist|villain|nemesis)/u.test(normalized)) return 1;
  return 0;
}
