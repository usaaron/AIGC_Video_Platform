import { pathToFileURL } from "node:url";

import {
  storyBibleProjectCharacters,
  storyBibleProjectRelationships,
  storyBibleProjectStoryLines,
  synchronizeContinuity,
} from "../lib/continuity.ts";
import { buildProvisionalContinuityCheckpoint } from "../lib/continuity-checkpoint.ts";
import { buildEpisodeMemoryRecall } from "../lib/memory-recall.ts";
import { parseGeneratedDraft } from "../lib/generated-draft-parser.ts";
import { buildEpisodeHandoff } from "../lib/episode-handoff.ts";

const MAX_INPUT_BYTES = 16 * 1024 * 1024;

export function projectProbeContinuity(input) {
  const { workspace, storyBible, focus = {} } = structuredClone(input);
  validateInput(workspace, storyBible, focus);
  const characters = storyBibleProjectCharacters(storyBible, workspace.characters);
  const storyLines = storyBibleProjectStoryLines(storyBible, characters, workspace.storyLines ?? []);
  const relationships = storyBibleProjectRelationships(
    storyBible,
    characters,
    workspace.characterRelationships ?? [],
  );
  const projection = synchronizeContinuity(
    workspace.creativePrompt,
    characters,
    workspace.episodes,
    storyLines,
    relationships,
    workspace.continuityStates ?? [],
  );
  const projectedWorkspace = { ...workspace, ...projection };
  return {
    workspace: projectedWorkspace,
    previousEpisodeHandoff: workspace.episodes.length
      ? buildEpisodeHandoff(workspace.episodes.at(-1).finalizationResult?.master_script
        ?? parseGeneratedDraft(workspace.episodes.at(-1).workingDraftJson)
        ?? parseGeneratedDraft(workspace.episodes.at(-1).confirmedDraftJson)
        ?? workspace.episodes.at(-1).generationRun.draft_master_script)
      : null,
    checkpoint: buildProvisionalContinuityCheckpoint(projectedWorkspace, focus),
    memoryRecall: buildEpisodeMemoryRecall(projectedWorkspace, {
      episodeNumber: workspace.episodes.length + 1,
      storyBibleVersion: storyBible.version,
      relevantCharacterRefs: focus.characterRefs,
      plannedStoryLineRefs: focus.storyLineRefs,
      plannedSetupRefs: focus.setupPayoffRefs,
    }),
  };
}

function object(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be an object.`);
  }
}

function string(value, path, allowEmpty = false) {
  if (typeof value !== "string" || (!allowEmpty && !value.trim())) {
    throw new Error(`${path} must be ${allowEmpty ? "a string" : "a non-empty string"}.`);
  }
}

function array(value, path) {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array.`);
}

function stringArray(value, path) {
  array(value, path);
  value.forEach((item, index) => string(item, `${path}[${index}]`));
}

function unique(values, path) {
  if (new Set(values).size !== values.length) throw new Error(`${path} must be unique.`);
}

function validateInput(workspace, bible, focus) {
  object(workspace, "workspace");
  object(bible, "storyBible");
  object(focus, "focus");
  string(workspace.id, "workspace.id");
  string(workspace.creativePrompt, "workspace.creativePrompt", true);
  if (bible.story_project_id !== workspace.id) {
    throw new Error("Story Bible must belong to the workspace project.");
  }
  if (bible.status !== "approved" || !Number.isInteger(bible.version) || bible.version < 1) {
    throw new Error("An approved Story Bible with a positive version is required.");
  }
  if (workspace.storyBibleVersion !== bible.version || workspace.storyBibleStatus !== "approved") {
    throw new Error("Workspace must reference the supplied approved Story Bible version.");
  }
  for (const field of ["characterRefs", "storyLineRefs", "setupPayoffRefs"]) {
    if (focus[field] !== undefined) stringArray(focus[field], `focus.${field}`);
  }
  for (const field of ["character_registry", "character_arc_targets", "story_lines", "relationships"]) {
    array(bible[field], `storyBible.${field}`);
    bible[field].forEach((item, index) => object(item, `storyBible.${field}[${index}]`));
  }
  for (const registry of bible.character_registry) {
    for (const field of ["character_ref", "name", "role"]) string(registry[field], `character_registry.${field}`);
  }
  unique(bible.character_registry.map((item) => item.character_ref), "Story Bible character refs");
  for (const line of bible.story_lines) {
    for (const field of ["story_line_id", "title", "story_line_type", "premise", "planned_resolution"]) {
      string(line[field], `story_lines.${field}`);
    }
    stringArray(line.character_refs, "story_lines.character_refs");
  }
  for (const relationship of bible.relationships) {
    for (const field of ["source_character_ref", "target_character_ref", "relationship_type", "initial_state"]) {
      string(relationship[field], `relationships.${field}`);
    }
  }
  array(workspace.characters, "workspace.characters");
  for (const character of workspace.characters) {
    object(character, "workspace.characters[]");
    string(character.id, "character.id");
    string(character.name, "character.name");
    for (const field of ["age", "gender", "role", "background", "appearance", "description"]) {
      string(character[field], `character.${field}`, true);
    }
  }
  unique(workspace.characters.map((item) => item.id), "Workspace character IDs");
  for (const field of ["storyLines", "characterRelationships", "continuationHooks", "setupPayoffs", "continuityStates"]) {
    if (workspace[field] !== undefined) array(workspace[field], `workspace.${field}`);
  }
  array(workspace.episodes, "workspace.episodes");
  unique(workspace.episodes.map((episode) => episode?.id), "Workspace episode IDs");
  workspace.episodes.forEach((episode, index) => {
    object(episode, `workspace.episodes[${index}]`);
    string(episode.id, "episode.id");
    if (episode.episodeNumber !== index + 1) {
      throw new Error("Probe episodes must be unique and in contiguous ascending order starting at episode 1.");
    }
    object(episode.generationRun, "episode.generationRun");
    const contextNumber = episode.generationRun.episode_context?.episode_number;
    if (contextNumber !== undefined && contextNumber !== episode.episodeNumber) {
      throw new Error("Generation run episode number does not match its workspace episode.");
    }
    // The product prefers finalized, working, then confirmed drafts. Validate every
    // supplied source so a malformed working draft cannot silently fall back.
    for (const field of ["workingDraftJson", "confirmedDraftJson"]) {
      if (episode[field] !== undefined && episode[field] !== "") {
        string(episode[field], `episode.${field}`);
        validateDraft(episode[field], `episode.${field}`);
      }
    }
    validateDraft(JSON.stringify(episode.generationRun.draft_master_script), "generationRun.draft_master_script");
    if (episode.finalizationResult) {
      validateDraft(JSON.stringify(episode.finalizationResult.master_script), "finalizationResult.master_script");
    }
  });
}

function validateDraft(serialized, path) {
  const draft = parseGeneratedDraft(serialized, {
    requireTitle: true,
    requireNonEmptyScenes: true,
    requireCompleteScenes: true,
  });
  if (!draft) throw new Error(`${path} must contain a complete parseable draft.`);
  for (const field of ["id", "title", "synopsis"]) string(draft[field], `${path}.${field}`);
  array(draft.characters, `${path}.characters`);
  for (const character of draft.characters) {
    object(character, `${path}.characters[]`);
    for (const field of ["name", "role", "description", "motivation"]) {
      string(character[field], `${path}.characters[].${field}`, field !== "name");
    }
  }
  draft.scenes.forEach((scene, index) => {
    if (!Number.isInteger(scene.scene_number) || scene.scene_number < 1) {
      throw new Error(`${path}.scenes[${index}] requires a positive scene number.`);
    }
    stringArray(scene.character_actions, `${path}.scenes[${index}].character_actions`);
    scene.dialogues.forEach((dialogue) => {
      object(dialogue, `${path}.dialogues[]`);
      string(dialogue.character_name, `${path}.dialogues[].character_name`);
      string(dialogue.text, `${path}.dialogues[].text`);
    });
  });
  unique(draft.scenes.map((scene) => scene.scene_number), `${path} scene numbers`);
  for (const field of ["character_state_updates", "relationship_state_updates", "continuity_state_updates", "story_line_updates", "setup_payoff_updates"]) {
    if (draft[field] !== undefined) array(draft[field], `${path}.${field}`);
  }
}

async function main() {
  try {
    const chunks = [];
    let bytes = 0;
    for await (const chunk of process.stdin) {
      bytes += chunk.length;
      if (bytes > MAX_INPUT_BYTES) throw new Error("Probe projection input exceeds 16 MiB.");
      chunks.push(chunk);
    }
    const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    object(input, "input");
    process.stdout.write(`${JSON.stringify(projectProbeContinuity(input))}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ error: error instanceof Error ? error.message : "Projection failed." })}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
