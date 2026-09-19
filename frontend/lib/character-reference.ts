import type { CharacterDraft, GeneratedDraft } from "./types";

/** Keep authored identity/initial state when replaying from before episode one. */
export function withoutEpisodeCharacterState(character: CharacterDraft): CharacterDraft {
  const { dynamicState, stateHistory, lastUpdatedEpisode, ...identity } = character;
  const hasEpisodeState = (dynamicState?.lastUpdatedEpisode ?? 0) > 0 || (lastUpdatedEpisode ?? 0) > 0
    || stateHistory?.some((change) => change.episodeNumber > 0);
  return hasEpisodeState ? identity : character;
}

export function characterReferenceAliases(id: string): string[] {
  const stableId = id.replace(/[^a-zA-Z0-9_.:-]/g, "-");
  return [...new Set([
    ...(id.startsWith("story-bible-") ? [id.slice("story-bible-".length)] : []),
    ...(id.startsWith("character.") ? [id] : []),
    `character.${stableId}`,
    id,
  ])];
}

/** Resolve the identities used by the story bible, character cards and scripts. */
export function characterMatchesReference(
  character: Pick<CharacterDraft, "id" | "name">,
  reference: string,
): boolean {
  return character.name === reference || characterReferenceAliases(character.id).includes(reference);
}

export function characterReferenceNames(
  references: string[],
  characters: ReadonlyArray<Pick<CharacterDraft, "id" | "name">>,
): string[] {
  return [...new Set(references.map(reference => (
    characters.find(character => characterMatchesReference(character, reference))?.name ?? reference
  )))];
}

/** Present known IDs as names without changing the stored draft or its body. */
export function resolveDraftCharacterReferences(
  draft: GeneratedDraft,
  characters: ReadonlyArray<Pick<CharacterDraft, "id" | "name">>,
): GeneratedDraft {
  return {
    ...draft,
    episode_cast: draft.episode_cast ? characterReferenceNames(draft.episode_cast, characters) : draft.episode_cast,
    scenes: draft.scenes.map(scene => ({
      ...scene,
      character_refs: scene.character_refs ? characterReferenceNames(scene.character_refs, characters) : scene.character_refs,
      ...(scene.content_manifest ? { content_manifest: {
        ...scene.content_manifest,
        character_refs: characterReferenceNames(scene.content_manifest.character_refs, characters),
      } } : {}),
    })),
  };
}
