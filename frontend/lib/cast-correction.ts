import { normalizeScreenplayBodyOrder } from "./screenplay-body-order";
import type { GeneratedDraft, GeneratedScene } from "./types";

export interface CastCorrectionSelection {
  sceneIndex: number;
  characterRef: string;
  /** Optional canonical names for drafts whose scene refs use stable IDs. */
  characterNames?: string[];
  actionIndices: number[];
  stateUpdateIndices: number[];
}

function sameIdentity(left: string | undefined, right: string): boolean {
  return Boolean(left && left.trim().toLocaleLowerCase() === right.trim().toLocaleLowerCase());
}

function matchesIdentity(value: string | undefined, identities: string[]): boolean {
  return identities.some((identity) => sameIdentity(value, identity));
}

function sceneContainsCharacter(scene: GeneratedScene, identities: string[]): boolean {
  return Boolean(
    scene.character_refs?.some((value) => matchesIdentity(value, identities))
      || scene.content_manifest?.character_refs.some((value) => matchesIdentity(value, identities))
      || scene.dialogues.some((line) => matchesIdentity(line.character_name, identities)),
  );
}

function removeActions(
  scene: GeneratedScene,
  actionIndices: Set<number>,
): Pick<GeneratedScene, "character_actions" | "body_order"> {
  if (!actionIndices.size) {
    return { character_actions: scene.character_actions, body_order: scene.body_order };
  }
  const bodyOrder = normalizeScreenplayBodyOrder(scene);
  const characterActions = scene.character_actions.filter((_, index) => !actionIndices.has(index));
  const removedBefore = (index: number) => [...actionIndices].filter((removed) => removed < index).length;
  const nextBodyOrder = bodyOrder.flatMap((reference) => {
    const [kind, rawIndex] = reference.split(":", 2) as ["action" | "dialogue", string];
    const index = Number(rawIndex);
    if (kind === "action") {
      if (actionIndices.has(index)) return [];
      return [`action:${index - removedBefore(index)}` as const];
    }
    return [reference];
  });
  return { character_actions: characterActions, body_order: nextBodyOrder };
}

/**
 * Apply an author-selected cast correction without trying to infer entities
 * from prose. Only the listed action/state slots are removed; all other draft
 * fields retain their original values.
 */
export function applyCastCorrection(
  draft: GeneratedDraft,
  selection: CastCorrectionSelection,
): GeneratedDraft {
  const scene = draft.scenes[selection.sceneIndex];
  if (!scene) return draft;
  const characterRef = selection.characterRef.trim();
  if (!characterRef) return draft;
  const identities = [characterRef, ...(selection.characterNames ?? [])].filter(Boolean);
  const actionIndices = new Set(selection.actionIndices.filter((index) => (
    Number.isInteger(index) && index >= 0 && index < scene.character_actions.length
  )));
  const stateIndices = new Set(selection.stateUpdateIndices.filter((index) => (
    Number.isInteger(index) && index >= 0 && index < (draft.character_state_updates?.length ?? 0)
  )));
  const removed = removeActions(scene, actionIndices);
  const correctedScene: GeneratedScene = {
    ...scene,
    ...(actionIndices.size ? removed : { character_actions: scene.character_actions }),
    character_refs: scene.character_refs?.filter((value) => !matchesIdentity(value, identities)),
    ...(scene.content_manifest ? {
      content_manifest: {
        ...scene.content_manifest,
        character_refs: scene.content_manifest.character_refs
          .filter((value) => !matchesIdentity(value, identities)),
      },
    } : {}),
  };
  const correctedScenes = draft.scenes.map((item, index) => (
    index === selection.sceneIndex ? correctedScene : item
  ));
  const appearsElsewhere = correctedScenes.some((item, index) => (
    index !== selection.sceneIndex && sceneContainsCharacter(item, identities)
  ));
  const correctedEpisodeCast = !appearsElsewhere && draft.episode_cast
    ? draft.episode_cast.filter((value) => !matchesIdentity(value, identities))
    : draft.episode_cast;
  const correctedCharacters = !appearsElsewhere
    ? draft.characters.filter((character) => !matchesIdentity(character.name, identities))
    : draft.characters;
  const correctedStateUpdates = (draft.character_state_updates ?? []).filter((update, index) => (
    !(stateIndices.has(index) && matchesIdentity(update.character_name, identities))
  ));
  return {
    ...draft,
    scenes: correctedScenes,
    ...(draft.episode_cast ? { episode_cast: correctedEpisodeCast } : {}),
    characters: correctedCharacters,
    ...(draft.character_state_updates ? { character_state_updates: correctedStateUpdates } : {}),
  };
}
