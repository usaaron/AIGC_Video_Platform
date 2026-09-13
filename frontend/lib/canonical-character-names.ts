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
    for (const match of source.matchAll(REFERENCE_NAME_PATTERN)) {
      const english = normalizeEnglishName(match[1]);
      const chinese = match[2].trim();
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

/**
 * Deterministically upgrades persisted episode drafts. It only changes identity
 * spelling, bilingual presentation fields, and the authored body-order fallback;
 * story beats, actions, dialogue meaning, and continuity facts stay intact.
 */
export function migrateProjectScreenplayFormat(
  project: ScriptProject,
): ScriptProject {
  const canonical = extractCanonicalCharacterNames(project.referenceMaterials);
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
      ),
    };
    const draft = canonicalizeDraft(
      parseJsonDraft(episode.workingDraftJson) ?? generationRun.draft_master_script,
      canonical,
      aliases,
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
            ) as typeof episode.finalizationResult.master_script,
          }
        : episode.finalizationResult,
    };
  });
  const characters = project.characters.map((character) => ({
    ...character,
    name: canonicalizeIdentityText(character.name, canonical, aliases, "chinese"),
    description: canonicalizeIdentityText(character.description, canonical, aliases, "chinese"),
    background: canonicalizeIdentityText(character.background, canonical, aliases, "chinese"),
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
): GeneratedDraft {
  const englishSource = draft.language.toLocaleLowerCase().startsWith("en");
  const identityMode = englishSource ? "english" : "chinese";
  return {
    ...draft,
    characters: draft.characters.map((character) => ({
      ...character,
      name: canonicalizeIdentityText(character.name, canonical, aliases, "chinese"),
      role: character.role,
      description: canonicalizeIdentityText(character.description, canonical, aliases, "chinese"),
      motivation: canonicalizeIdentityText(character.motivation, canonical, aliases, "chinese"),
    })),
    scenes: draft.scenes.map((scene) => ({
      ...scene,
      body_order: normalizeScreenplayBodyOrder(scene),
      slug: canonicalizeIdentityText(scene.slug, canonical, aliases, "chinese"),
      setting: scene.setting
        ? canonicalizeIdentityText(scene.setting, canonical, aliases, "chinese")
        : scene.setting,
      setting_hint: scene.setting_hint
        ? canonicalizeIdentityText(scene.setting_hint, canonical, aliases, "chinese")
        : scene.setting_hint,
      character_actions: scene.character_actions.map((value) => (
        canonicalizeIdentityText(value, canonical, aliases, "chinese")
      )),
      dialogues: scene.dialogues.map((dialogue) => ({
        ...dialogue,
        character_name: canonicalizeSpeaker(dialogue.character_name, canonical, aliases, identityMode),
        intent: canonicalizeIdentityText(dialogue.intent, canonical, aliases, "chinese"),
        text: canonicalizeIdentityText(dialogue.text, canonical, aliases, identityMode),
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
  const owner = aliases.get(parsed.speaker.trim().toLocaleLowerCase())
    ?? canonical.find((item) => item.chinese === parsed.speaker || item.english === parsed.speaker);
  if (!owner) return value;
  const name = mode === "english" ? owner.english : owner.chinese;
  return `${name}${parsed.marker ? ` (${parsed.marker})` : ""}`;
}

function canonicalizeIdentityText(
  value: string | undefined,
  canonical: CanonicalCharacterName[],
  aliases: Map<string, CanonicalCharacterName>,
  mode: "chinese" | "english",
): string {
  if (!value) return value ?? "";
  let result = value;
  const matches = [...aliases.entries()]
    .sort(([left], [right]) => right.length - left.length);
  for (const [alias, owner] of matches) {
    const escaped = escapeRegExp(alias);
    const replacement = mode === "english" ? owner.english : owner.chinese;
    result = result.replace(new RegExp(`(?<![A-Za-z])${escaped}(?![A-Za-z])`, "gi"), replacement);
  }
  for (const item of canonical) {
    const replacement = mode === "english" ? item.english : item.chinese;
    result = result.replace(new RegExp(`(?<![A-Za-z])${escapeRegExp(item.chinese)}(?![A-Za-z])`, "gi"), replacement);
    result = result.replace(new RegExp(`(?<![A-Za-z])${escapeRegExp(item.english)}(?![A-Za-z])`, "gi"), replacement);
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
