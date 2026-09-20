import { characterReferenceAliases } from "./character-reference.ts";
import { productionCardFacts } from "./host-production-cards.ts";
import type { QuickScriptPlan } from "./quick-script-types.ts";
import type { CharacterDraft, GeneratedDraft } from "./types.ts";

export type HostAssetEvidenceKind = "character" | "scene" | "prop";
export interface HostAssetEvidenceItem {
  kind: HostAssetEvidenceKind;
  name: string;
  facts: Record<string, string>;
  sourceSceneIds: string[];
}
export interface HostAssetEvidence {
  version: "script_asset_evidence.v1";
  contentHash: string;
  complete: Record<HostAssetEvidenceKind, boolean>;
  assets: HostAssetEvidenceItem[];
  /** Exact exported headings in body order; IDs retain the original scene numbers. */
  scenes?: Array<{ sourceSceneId: string; heading: string }>;
}
/** Internal preparation only. Never send sourceContent or trust a caller's hash. */
export interface PendingHostAssetEvidence extends Omit<HostAssetEvidence, "contentHash"> {
  sourceContent: string;
}

const KINDS: HostAssetEvidenceKind[] = ["character", "scene", "prop"];
const machineReference = /^(?:story[-_.]bible[-_.]|(?:character|char)[.:/_-]|[a-z]+[-_:]\d+$|[0-9a-f]{8}-[0-9a-f-]{27,}$)/i;
const nameValue = (value: unknown): value is string => typeof value === "string" && !!value.trim();

function visualCharacterReference(reference: string): string | null {
  // Only an explicit voice-only declaration rules out a visual appearance.
  // A named person's VO/OS marker alone describes delivery, not their identity.
  if (/(?:仅(?:有)?声音|仅声|只有声音|只闻其声|voice[-\s]*only|audio[-\s]*only)/iu.test(reference)) return null;
  const name = reference.replace(
    /\s*[（(\[]\s*(?:V\.?\s*O\.?|O\.?\s*S\.?|V\.?\s*O\.?\s*\/\s*O\.?\s*S\.?|画外音|画外声|旁白)\s*[）)\]]\s*$/iu,
    "",
  ).trim();
  if (!name || /^(?:旁白|画外音|画外声|解说|narrator|narration|voice[-\s]*over|V\.?\s*O\.?|O\.?\s*S\.?)$/iu.test(name)) return null;
  return name;
}

function withinLimits(value: Omit<HostAssetEvidence, "contentHash">): boolean {
  const valid = value.version === "script_asset_evidence.v1"
    && KINDS.every(kind => typeof value.complete?.[kind] === "boolean")
    && Array.isArray(value.assets) && value.assets.length <= 2000
    && value.assets.every(item => item && typeof item === "object" && KINDS.includes(item.kind)
      && nameValue(item.name) && item.name.length <= 120
      && item.facts && typeof item.facts === "object" && !Array.isArray(item.facts)
      && Object.entries(item.facts).length <= 20
      && Object.entries(item.facts).every(([key, detail]) => nameValue(key) && key.length <= 40
        && typeof detail === "string" && detail.length <= 2000)
      && Array.isArray(item.sourceSceneIds) && item.sourceSceneIds.length <= 500
      && item.sourceSceneIds.every(id => nameValue(id) && id.length <= 160));
  if (!valid) return false;
  if (value.scenes && (!Array.isArray(value.scenes) || !value.scenes.length || value.scenes.length > 50
    || new Set(value.scenes.map(scene => scene.sourceSceneId)).size !== value.scenes.length
    || value.scenes.some(scene => !nameValue(scene.sourceSceneId) || scene.sourceSceneId.length > 160
      || !nameValue(scene.heading) || scene.heading.length > 500 || /[\r\n]/u.test(scene.heading))
    || value.assets.some(asset => asset.sourceSceneIds.some(id => !value.scenes!.some(scene => scene.sourceSceneId === id))))) return false;
  // Count the wire payload only, including its future fixed-length hash.
  return new TextEncoder().encode(JSON.stringify({ version: value.version, contentHash: "0".repeat(64),
    complete: value.complete, assets: value.assets, ...(value.scenes ? { scenes: value.scenes } : {}) })).byteLength <= 500_000;
}

/** Project explicit appearances, never narrative mentions or the global cast. */
export function projectHostAssetEvidence(
  draft: GeneratedDraft,
  characters: readonly CharacterDraft[],
  sourceEpisodeId: string,
  content: string,
  plan?: QuickScriptPlan | null,
): { evidence?: PendingHostAssetEvidence; warning?: string } {
  const complete = { character: draft.scenes.length > 0, scene: draft.scenes.length > 0, prop: draft.scenes.length > 0 };
  const assets = new Map<string, HostAssetEvidenceItem>();
  const references = new Map<string, Set<string>>();
  const appearances = new Map<string, Set<string>>();
  const addReference = (reference: string, name: string) => {
    const names = references.get(reference) ?? new Set<string>();
    names.add(name);
    references.set(reference, names);
  };
  for (const character of characters) {
    if (!nameValue(character.name)) continue;
    const name = character.name.trim();
    addReference(name, name);
    if (nameValue(character.id)) {
      for (const alias of characterReferenceAliases(character.id)) addReference(alias, name);
    }
    if (nameValue(character.appearance)) {
      const values = appearances.get(name) ?? new Set<string>();
      values.add(character.appearance.trim());
      appearances.set(name, values);
    }
  }
  for (const character of draft.characters ?? []) {
    if (nameValue(character.name)) addReference(character.name.trim(), character.name.trim());
  }
  const addAsset = (kind: HostAssetEvidenceKind, name: string, sourceSceneId: string) => {
    const key = JSON.stringify([kind, name]);
    const previous = assets.get(key);
    if (previous) {
      if (!previous.sourceSceneIds.includes(sourceSceneId)) previous.sourceSceneIds.push(sourceSceneId);
      return;
    }
    // Free-form description/background/motivation are not visual evidence.
    const visual = kind === "character" ? appearances.get(name) : undefined;
    const appearance = visual?.size === 1 ? [...visual][0] : undefined;
    assets.set(key, { kind, name, facts: { ...productionCardFacts(kind, name, characters, plan),
      ...(appearance ? { 外观: appearance } : {}) }, sourceSceneIds: [sourceSceneId] });
  };
  const sceneIds = new Set<string>();
  const invalidated = (draft.llm_metadata as Record<string, unknown> | null | undefined)?.quick_asset_evidence_invalidated_scenes;
  const invalidatedScenes = new Set(Array.isArray(invalidated) ? invalidated.filter(Number.isSafeInteger) : []);
  const undeclared = (draft.llm_metadata as Record<string, unknown> | null | undefined)?.quick_asset_manifest_undeclared_scenes;
  for (const number of Array.isArray(undeclared) ? undeclared.filter(Number.isSafeInteger) : []) invalidatedScenes.add(number);
  let invalidSceneIdentity = false;
  for (const scene of draft.scenes) {
    const sourceSceneId = `${sourceEpisodeId}:${scene.scene_number}`;
    if (!Number.isSafeInteger(scene.scene_number) || scene.scene_number < 1 || sceneIds.has(sourceSceneId)) invalidSceneIdentity = true;
    sceneIds.add(sourceSceneId);
    // A new text hash does not make a manifest from an earlier body trustworthy.
    if (invalidatedScenes.has(scene.scene_number)) {
      for (const kind of KINDS) complete[kind] = false;
      continue;
    }
    const manifest = scene.content_manifest;
    if (!manifest || typeof manifest !== "object") {
      for (const kind of KINDS) complete[kind] = false;
      continue;
    }
    if (nameValue(manifest.location)) addAsset("scene", manifest.location.trim(), sourceSceneId);
    else complete.scene = false;
    for (const [kind, values] of [["character", manifest.character_refs], ["prop", manifest.props]] as const) {
      if (!Array.isArray(values)) { complete[kind] = false; continue; }
      // Empty arrays are explicit empty declarations; no body/global-cast fallback.
      for (const rawName of values) {
        if (!nameValue(rawName)) { complete[kind] = false; continue; }
        if (kind === "prop") { addAsset(kind, rawName.trim(), sourceSceneId); continue; }
        const reference = visualCharacterReference(rawName.trim());
        if (!reference) continue;
        const names = references.get(reference);
        if ((names && names.size !== 1) || (!names && machineReference.test(reference))) {
          complete.character = false;
          continue;
        }
        addAsset("character", names ? [...names][0] : reference, sourceSceneId);
      }
    }
  }
  const evidence: PendingHostAssetEvidence = {
    version: "script_asset_evidence.v1", sourceContent: content.trim(), complete, assets: [...assets.values()],
  };
  const body = content.split(/^正式正文\s*$/mu)[1]?.split(/^FADE IN \/ 淡入[：:]\s*$/mu)[1];
  const headings = body ? [...body.matchAll(/^(?:INT\.(?:\s*\/\s*EXT\.)?|EXT\.(?:\s*\/\s*INT\.)?)\s+[^\r\n]+$/gimu)].map(match => match[0].trim()) : [];
  if (headings.length === draft.scenes.length && headings.length > 0) {
    evidence.scenes = draft.scenes.map((scene, index) => ({ sourceSceneId: `${sourceEpisodeId}:${scene.scene_number}`, heading: headings[index] }));
    for (const asset of evidence.assets.filter(item => item.kind === "scene")) {
      const spaces = new Set(evidence.scenes.filter(scene => asset.sourceSceneIds.includes(scene.sourceSceneId))
        .map(scene => /^INT\.\s+(?!\/)/iu.test(scene.heading) ? "室内" : /^EXT\.\s+(?!\/)/iu.test(scene.heading) ? "室外" : ""));
      if (spaces.size === 1 && !spaces.has("")) asset.facts["空间"] = [...spaces][0];
    }
  }
  if (invalidSceneIdentity || !withinLimits(evidence)) return {
    warning: "结构化资产资料超出交付限制或场次标识无效，本集仍交付正文，资产将从正文重新识别。",
  };
  return { evidence };
}

/** Bind only the exact text from which the projection was prepared. */
export async function bindHostAssetEvidence(
  pending: PendingHostAssetEvidence | undefined,
  content: string,
): Promise<HostAssetEvidence | undefined> {
  if (!pending || pending.sourceContent !== content.trim() || !withinLimits(pending)) return undefined;
  // Snapshot before awaiting hashing so mutable preparation state cannot race it.
  const complete = { character: pending.complete.character, scene: pending.complete.scene, prop: pending.complete.prop };
  const assets = pending.assets.map(({ kind, name, facts, sourceSceneIds }) => ({
    kind, name, facts: { ...facts }, sourceSceneIds: [...sourceSceneIds],
  }));
  const scenes = pending.scenes?.map(scene => ({ ...scene }));
  const contentHash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content.trim())))]
    .map(byte => byte.toString(16).padStart(2, "0")).join("");
  return { version: "script_asset_evidence.v1", contentHash, complete, assets, ...(scenes ? { scenes } : {}) };
}
