import type {
  GeneratedDraft,
  ProjectReferenceMaterial,
  ScriptProject,
} from "./types.ts";
import { clientDialogueSpeaker } from "./client-screenplay-format.ts";
import { parseGeneratedDraft } from "./generated-draft-parser.ts";
import { normalizeScreenplayBodyOrder } from "./screenplay-body-order.ts";

export interface CanonicalCharacterName {
  chinese: string;
  english: string;
  aliases: string[];
}

const CHINESE_FIRST_NAME_PATTERN = /(?:^|[\n。；;、\s])([\u3400-\u9fff]{1,24})\s*[（(]\s*([A-Za-z][A-Za-z .'-]{0,79})\s*[）)]/g;
const REFERENCE_NAME_PATTERN = /\b([A-Za-z][A-Za-z .'-]{0,79})\s*[（(]\s*([\u3400-\u9fff]{1,24})\s*[）)]\s*[:：]/g;

/**
 * Extract only explicit bilingual identity declarations from user references.
 * A model may invent a missing name, but it must never replace an explicit one.
 */
export function extractCanonicalCharacterNames(
  materials: ProjectReferenceMaterial[] | undefined,
): CanonicalCharacterName[] {
  const result: CanonicalCharacterName[] = [];
  const seen = new Set<string>();
  for (const material of materials ?? []) {
    if (!/[\u3400-\u9fff]/.test(material.extractedText)) continue;
    const source = material.extractedText;
    const declarations = [
      ...[...source.matchAll(REFERENCE_NAME_PATTERN)].map(match => [match[1], match[2]]),
      ...[...source.matchAll(CHINESE_FIRST_NAME_PATTERN)].map(match => [match[2], match[1]]),
    ];
    for (const [rawEnglish, rawChinese] of declarations) {
      const english = normalizeEnglishName(rawEnglish);
      const chinese = rawChinese.trim();
      const key = `${chinese}\u0000${english}`.toLocaleLowerCase();
      if (!english || !chinese || seen.has(key)) continue;
      seen.add(key);
      result.push({ chinese, english, aliases: [] });
    }
  }
  return result;
}

export function canonicalCharacterNameMap(
  materials: ProjectReferenceMaterial[] | undefined,
): Map<string, string> {
  return new Map(
    extractCanonicalCharacterNames(materials)
      .map((item) => [item.chinese, item.english] as const),
  );
}

export function canonicalCharacterNameEntries(
  materials: ProjectReferenceMaterial[] | undefined,
): string[] {
  return extractCanonicalCharacterNames(materials)
    .map((item) => `${item.chinese} = ${item.english}`);
}

/** Read-only spelling projection for planning views; never updates approved documents. */
export function planningCharacterNameFormatter(
  project: Pick<ScriptProject, "canonicalCharacterNames" | "generationSettings">,
): (value: string) => string {
  if (project.generationSettings.releaseRegion !== "overseas") return value => value;
  const canonical = Object.entries(project.canonicalCharacterNames ?? {})
    .filter(([chinese, english]) => /[\u3400-\u9fff]/.test(chinese) && /^[A-Za-z][A-Za-z .'-]{0,79}$/.test(english))
    .map(([chinese, english]) => ({ chinese, english, aliases: [] }));
  const aliases = new Map(canonical.map(item => [item.chinese.toLocaleLowerCase(), item]));
  return value => canonicalizeIdentityText(value, canonical, aliases, "english");
}

/**
 * Deterministically upgrades persisted episode drafts. It only changes identity
 * spelling, bilingual presentation fields, and the authored body-order fallback;
 * story beats, actions, dialogue meaning, and continuity facts stay intact.
 */
export function migrateProjectScreenplayFormat(
  project: ScriptProject,
): ScriptProject {
  const byChinese = new Map(extractCanonicalCharacterNames([
    ...(project.referenceMaterials ?? []),
    ...(project.creativePrompt ? [{ id: "creative-prompt", fileName: "创作输入", extractedText: project.creativePrompt } as ProjectReferenceMaterial] : []),
  ]).map(item => [item.chinese, item]));
  for (const [chinese, english] of Object.entries(project.canonicalCharacterNames ?? {})) {
    if (!byChinese.has(chinese)) byChinese.set(chinese, { chinese, english, aliases: [] });
  }
  // Previously saved bilingual pairs are identity aliases, never new translations.
  for (const episode of project.episodes) {
    for (const scene of episode.generationRun.draft_master_script.scenes) {
      for (const line of scene.dialogues) {
        const chinese = line.chinese_character_name?.trim();
        const english = clientDialogueSpeaker(line.character_name, line.character_name).speaker;
        if (chinese && /[\u3400-\u9fff]/.test(chinese) && !/[\u3400-\u9fff]/.test(english)
          && /[A-Za-z]/.test(english) && !byChinese.has(chinese)) {
          byChinese.set(chinese, { chinese, english, aliases: [] });
        }
      }
    }
  }
  const canonical = [...byChinese.values()];
  const explicitIdentityMode = project.generationSettings?.releaseRegion === "overseas"
    ? "english"
    : project.generationSettings?.releaseRegion === "cn_mainland" ? "chinese" : undefined;
  const projectIdentityMode = explicitIdentityMode ?? (
    project.episodes.some(episode => episode.generationRun.draft_master_script.language.toLowerCase().startsWith("en"))
      ? "english" : "chinese"
  );
  if (!canonical.length) return project;
  const aliases = buildAliasMap(project, canonical);
  const episodes = project.episodes.map((episode) => {
    const sourceDraft = episode.generationRun.draft_master_script;
    const generationRun = {
      ...episode.generationRun,
      draft_master_script: canonicalizeDraft(
        sourceDraft,
        canonical,
        aliases,
        explicitIdentityMode,
      ),
    };
    const draft = canonicalizeDraft(
      parseJsonDraft(episode.workingDraftJson) ?? generationRun.draft_master_script,
      canonical,
      aliases,
      explicitIdentityMode,
    );
    return {
      ...episode,
      generationRun,
      workingDraftJson: JSON.stringify(draft, null, 2),
      confirmedDraftJson: episode.confirmedDraftJson
        ? JSON.stringify(
            canonicalizeDraft(
              parseJsonDraft(episode.confirmedDraftJson) ?? draft,
              canonical,
              aliases,
              explicitIdentityMode,
            ),
            null,
            2,
          )
        : episode.confirmedDraftJson,
      modificationCandidate: episode.modificationCandidate?.candidate_generation_run
        ? {
            ...episode.modificationCandidate,
            candidate_generation_run: {
              ...episode.modificationCandidate.candidate_generation_run,
              draft_master_script: canonicalizeDraft(
                episode.modificationCandidate.candidate_generation_run.draft_master_script,
                canonical,
                aliases,
                explicitIdentityMode,
              ),
            },
          }
        : episode.modificationCandidate,
      deepeningRun: episode.deepeningRun
        ? {
            ...episode.deepeningRun,
            candidate_draft_master_script: episode.deepeningRun.candidate_draft_master_script
              ? canonicalizeDraft(
                  episode.deepeningRun.candidate_draft_master_script,
                  canonical,
                  aliases,
                  explicitIdentityMode,
                )
              : episode.deepeningRun.candidate_draft_master_script,
          }
        : episode.deepeningRun,
      revisionRun: episode.revisionRun
        ? {
            ...episode.revisionRun,
            revised_draft_master_script: canonicalizeDraft(
              episode.revisionRun.revised_draft_master_script,
              canonical,
              aliases,
              explicitIdentityMode,
            ),
          }
        : episode.revisionRun,
      finalizationResult: episode.finalizationResult
        ? {
            ...episode.finalizationResult,
            master_script: canonicalizeDraft(
              episode.finalizationResult.master_script,
              canonical,
              aliases,
              explicitIdentityMode,
            ) as typeof episode.finalizationResult.master_script,
          }
        : episode.finalizationResult,
    };
  });
  const characters = project.characters.map((character) => ({
    ...character,
    name: canonicalizeSpeaker(character.name, canonical, aliases, projectIdentityMode),
    description: canonicalizeIdentityText(character.description, canonical, aliases, projectIdentityMode),
    background: canonicalizeIdentityText(character.background, canonical, aliases, projectIdentityMode),
  }));
  return {
    ...project,
    canonicalCharacterNames: Object.fromEntries(
      canonical.map((item) => [item.chinese, item.english]),
    ),
    characters,
    episodes,
  };
}

function buildAliasMap(
  project: ScriptProject,
  canonical: CanonicalCharacterName[],
): Map<string, CanonicalCharacterName> {
  const result = new Map<string, CanonicalCharacterName>();
  for (const item of canonical) {
    for (const alias of [item.chinese, item.english]) {
      result.set(alias.toLocaleLowerCase(), item);
    }
  }
  // The project already has a stable role ledger. Use it only to collapse
  // aliases that appeared in older runs; never use it to invent a new name.
  const protagonist = canonical[0];
  const deuteragonist = canonical[1];
  for (const character of project.characters) {
    const owner = canonicalOwnerForRole(
      `${character.role} ${character.id}`,
      protagonist,
      deuteragonist,
    );
    if (owner) result.set(character.name.trim().toLocaleLowerCase(), owner);
  }
  for (const episode of project.episodes) {
    const drafts = [
      episode.generationRun.draft_master_script,
      parseJsonDraft(episode.workingDraftJson),
      parseJsonDraft(episode.confirmedDraftJson),
      episode.modificationCandidate?.candidate_generation_run?.draft_master_script,
      episode.deepeningRun?.candidate_draft_master_script,
      episode.revisionRun?.revised_draft_master_script,
      episode.finalizationResult?.master_script,
    ];
    for (const draft of drafts) {
      for (const character of draft?.characters ?? []) {
        const owner = canonicalOwnerForRole(
          character.role,
          protagonist,
          deuteragonist,
        );
        if (owner) result.set(character.name.trim().toLocaleLowerCase(), owner);
      }
    }
  }
  return result;
}

function canonicalOwnerForRole(
  value: string,
  protagonist: CanonicalCharacterName | undefined,
  deuteragonist: CanonicalCharacterName | undefined,
): CanonicalCharacterName | undefined {
  const role = value.toLocaleLowerCase();
  if (/deuteragonist|第二主角/.test(role)) return deuteragonist;
  if (/protagonist|主角/.test(role)) return protagonist;
  return undefined;
}

function canonicalizeDraft(
  draft: GeneratedDraft,
  canonical: CanonicalCharacterName[],
  aliases: Map<string, CanonicalCharacterName>,
  explicitIdentityMode?: "chinese" | "english",
): GeneratedDraft {
  const englishSource = draft.language.toLocaleLowerCase().startsWith("en");
  const identityMode = explicitIdentityMode ?? (englishSource ? "english" : "chinese");
  const textFields = <T extends object>(value: T, fields: ReadonlyArray<keyof T>): T => {
    const result = { ...value };
    for (const field of fields) {
      const text = value[field];
      if (typeof text === "string") {
        result[field] = canonicalizeIdentityText(text, canonical, aliases, identityMode) as T[keyof T];
      } else if (Array.isArray(text) && text.every(item => typeof item === "string")) {
        result[field] = text.map(item => canonicalizeIdentityText(item, canonical, aliases, identityMode)) as T[keyof T];
      }
    }
    return result;
  };
  return {
    ...textFields(draft, ["title", "logline", "synopsis", "hook", "episode_goal", "next_episode_question", "locations"]),
    episode_cast: draft.episode_cast?.map(name => canonicalizeSpeaker(name, canonical, aliases, identityMode)),
    characters: draft.characters.map((character) => ({
      ...character,
      name: canonicalizeSpeaker(character.name, canonical, aliases, identityMode),
      role: character.role,
      description: canonicalizeIdentityText(character.description, canonical, aliases, identityMode),
      motivation: canonicalizeIdentityText(character.motivation, canonical, aliases, identityMode),
    })),
    // Identity labels and human-readable text migrate together. Stable entity,
    // knowledge, story-line, payoff and planning references are never rewritten.
    character_state_updates: draft.character_state_updates?.map(update => ({
      ...textFields(update, [
        "current_goal", "emotional_state", "belief_or_attitude", "physical_state", "location",
        "knowledge_changes", "health_conditions", "action_capabilities", "lasting_marks",
        "active_constraints", "personality_change", "change_summary", "change_cause",
      ]),
      character_name: canonicalizeSpeaker(update.character_name, canonical, aliases, identityMode),
      knowledge_states: update.knowledge_states?.map(state => textFields(state, ["statement"])) ?? update.knowledge_states,
    })),
    relationship_state_updates: draft.relationship_state_updates?.map(update => ({
      ...textFields(update, ["relationship_type", "source_to_target", "target_to_source", "current_state", "change_summary", "change_cause"]),
      source_character_name: canonicalizeSpeaker(update.source_character_name, canonical, aliases, identityMode),
      target_character_name: canonicalizeSpeaker(update.target_character_name, canonical, aliases, identityMode),
    })),
    continuity_state_updates: draft.continuity_state_updates?.map(update => ({
      ...textFields(update, ["entity_name", "current_state", "future_constraint", "change_cause"]),
      entity_name: update.entity_type === "character"
        ? canonicalizeSpeaker(update.entity_name, canonical, aliases, identityMode)
        : canonicalizeIdentityText(update.entity_name, canonical, aliases, identityMode),
    })),
    story_line_updates: draft.story_line_updates?.map(update => textFields(update, [
      "progress_summary", "alignment_note", "next_required_step", "change_cause",
    ])),
    setup_payoff_updates: draft.setup_payoff_updates?.map(update => textFields(update, [
      "progress_summary", "next_required_step", "change_cause",
    ])),
    continuation_hook: draft.continuation_hook ? textFields(draft.continuation_hook, [
      "previous_hook_response", "ending_hook_summary", "next_episode_obligation",
    ]) : draft.continuation_hook,
    scenes: draft.scenes.map((scene) => ({
      ...textFields(scene, ["scene_heading", "purpose", "beat_summary", "emotional_shift", "emotional_objective", "turning_point"]),
      character_refs: scene.character_refs?.map(name => canonicalizeSpeaker(name, canonical, aliases, identityMode)),
      content_manifest: scene.content_manifest ? {
        ...textFields(scene.content_manifest, ["location", "objective", "conflict", "turning_point", "outcome", "props", "entry_state", "exit_state"]),
        character_refs: scene.content_manifest.character_refs.map(name => canonicalizeSpeaker(name, canonical, aliases, identityMode)),
      } : scene.content_manifest,
      scene_causality: scene.scene_causality ? textFields(scene.scene_causality, [
        "goal", "conflict", "outcome", "causal_link",
      ]) : scene.scene_causality,
      body_order: normalizeScreenplayBodyOrder(scene),
      slug: canonicalizeIdentityText(scene.slug, canonical, aliases, identityMode),
      setting: scene.setting
        ? canonicalizeIdentityText(scene.setting, canonical, aliases, identityMode)
        : scene.setting,
      setting_hint: scene.setting_hint
        ? canonicalizeIdentityText(scene.setting_hint, canonical, aliases, identityMode)
        : scene.setting_hint,
      character_actions: scene.character_actions.map((value) => (
        canonicalizeIdentityText(value, canonical, aliases, identityMode)
      )),
      dialogues: scene.dialogues.map((dialogue) => ({
        ...dialogue,
        character_name: canonicalizeSpeaker(dialogue.character_name, canonical, aliases, identityMode),
        intent: canonicalizeIdentityText(dialogue.intent, canonical, aliases, identityMode),
        text: canonicalizeIdentityText(dialogue.text, canonical, aliases, identityMode),
        chinese_translation: dialogue.chinese_translation
          ? canonicalizeIdentityText(dialogue.chinese_translation, canonical, aliases, identityMode)
          : dialogue.chinese_translation,
      })),
    })),
  };
}

function canonicalizeSpeaker(
  value: string,
  canonical: CanonicalCharacterName[],
  aliases: Map<string, CanonicalCharacterName>,
  mode: "chinese" | "english",
): string {
  const parsed = clientDialogueSpeaker(value, value);
  const speaker = collapseIdentityPairs(parsed.speaker, canonical, aliases, mode);
  const parenthetical = speaker.match(/^(.+?)(\s*[（(][^（）()]+[）)])$/);
  const identity = parenthetical?.[1].trim() ?? speaker;
  const owner = aliases.get(identity.trim().toLocaleLowerCase())
    ?? canonical.find((item) => item.chinese === identity || item.english === identity);
  if (!owner) return value;
  const name = mode === "english" ? owner.english : owner.chinese;
  return `${name}${parenthetical?.[2] ?? ""}${parsed.marker ? ` (${parsed.marker})` : ""}`;
}

function canonicalizeIdentityText(
  value: string | undefined,
  canonical: CanonicalCharacterName[],
  aliases: Map<string, CanonicalCharacterName>,
  mode: "chinese" | "english",
): string {
  if (!value) return value ?? "";
  let result = collapseIdentityPairs(value, canonical, aliases, mode);
  const matches = [...aliases.entries()]
    .sort(([left], [right]) => right.length - left.length);
  for (const [alias, owner] of matches) {
    const escaped = escapeRegExp(alias);
    const replacement = mode === "english" ? owner.english : owner.chinese;
    const boundary = /[\u3400-\u9fff]/.test(alias) && alias.length === 1
      ? "[A-Za-z\\u3400-\\u9fff]" : "[A-Za-z]";
    result = result.replace(new RegExp(`(?<!${boundary})${escaped}(?!${boundary})`, "gi"), replacement);
  }
  for (const item of canonical) {
    const replacement = mode === "english" ? item.english : item.chinese;
    const boundary = item.chinese.length === 1 ? "[A-Za-z\\u3400-\\u9fff]" : "[A-Za-z]";
    result = result.replace(new RegExp(`(?<!${boundary})${escapeRegExp(item.chinese)}(?!${boundary})`, "gi"), replacement);
    result = result.replace(new RegExp(`(?<![A-Za-z])${escapeRegExp(item.english)}(?![A-Za-z])`, "gi"), replacement);
  }
  return result;
}

function collapseIdentityPairs(
  value: string,
  canonical: CanonicalCharacterName[],
  aliases: Map<string, CanonicalCharacterName>,
  mode: "chinese" | "english",
): string {
  let result = value;
  for (const owner of canonical) {
    const names = [...new Set([
      owner.chinese,
      owner.english,
      ...[...aliases.entries()].filter(([, item]) => item === owner).map(([alias]) => alias),
    ])].filter(Boolean).sort((left, right) => right.length - left.length);
    const options = names.map(escapeRegExp).join("|");
    if (!options) continue;
    // Collapse only two proven spellings of the same identity, in either order.
    // A profession, acting note, or another character in parentheses is content.
    const pair = new RegExp(`(?<![A-Za-z])(?:${options})\\s*[（(]\\s*(?:${options})\\s*[）)]`, "gi");
    result = result.replace(pair, mode === "english" ? owner.english : owner.chinese);
  }
  return result;
}

function parseJsonDraft(value: string | undefined): GeneratedDraft | null {
  return parseGeneratedDraft(value);
}

function normalizeEnglishName(value: string): string {
  // Preserve the source spelling and casing. Screenplay speaker blocks can
  // render names in uppercase when needed, but the canonical identity itself
  // must remain exactly as authored in the reference material.
  return value.trim().replace(/\s+/g, " ");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
