import type { GeneratedContinuityStateUpdate, GeneratedDraft } from "./types";

export type ContinuityTextField = "current_state" | "future_constraint" | "change_cause";

export function updateSceneProps(
  draft: GeneratedDraft,
  sceneIndex: number,
  sceneNumber: number,
  text: string,
): GeneratedDraft {
  const scene = draft.scenes[sceneIndex];
  if (!scene?.content_manifest || scene.scene_number !== sceneNumber) return draft;
  const props = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (JSON.stringify(props) === JSON.stringify(scene.content_manifest.props)) return draft;
  return {
    ...draft,
    scenes: draft.scenes.map((item, index) => index === sceneIndex
      ? { ...item, content_manifest: { ...scene.content_manifest!, props } }
      : item),
  };
}

export function updateContinuityText(
  draft: GeneratedDraft,
  recordIndex: number,
  identity: Pick<GeneratedContinuityStateUpdate, "entity_key" | "state_domain">,
  field: ContinuityTextField,
  value: string,
): GeneratedDraft {
  const records = draft.continuity_state_updates;
  const record = records?.[recordIndex];
  if (!record || record.entity_key !== identity.entity_key || record.state_domain !== identity.state_domain
    || !["current_state", "future_constraint", "change_cause"].includes(field)) return draft;
  const nextValue = field === "future_constraint" && !value ? null : value;
  if (record[field] === nextValue) return draft;
  return {
    ...draft,
    continuity_state_updates: records!.map((item, index) => index === recordIndex
      ? { ...item, [field]: nextValue }
      : item),
  };
}
