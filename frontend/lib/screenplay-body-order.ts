import type { GeneratedDialogue, GeneratedScene } from "./types.ts";

export type ScreenplayBodyReference = `action:${number}` | `dialogue:${number}`;

export type OrderedScreenplayBodyItem =
  | { kind: "action"; index: number; action: string }
  | { kind: "dialogue"; index: number; dialogue: GeneratedDialogue };

const BODY_REFERENCE_PATTERN = /^(action|dialogue):(0|[1-9]\d*)$/;

export function buildDefaultScreenplayBodyOrder(
  actionCount: number,
  dialogueCount: number,
): ScreenplayBodyReference[] {
  if (actionCount <= 0) {
    return Array.from(
      { length: Math.max(0, dialogueCount) },
      (_, index) => `dialogue:${index}` as ScreenplayBodyReference,
    );
  }
  if (dialogueCount <= 0) {
    return Array.from(
      { length: Math.max(0, actionCount) },
      (_, index) => `action:${index}` as ScreenplayBodyReference,
    );
  }

  const order: ScreenplayBodyReference[] = [];
  let nextAction = 0;
  for (let dialogueIndex = 0; dialogueIndex < dialogueCount; dialogueIndex += 1) {
    const targetActionCount = Math.max(
      1,
      Math.ceil(((dialogueIndex + 1) * actionCount) / (dialogueCount + 1)),
    );
    while (nextAction < Math.min(actionCount, targetActionCount)) {
      order.push(`action:${nextAction}`);
      nextAction += 1;
    }
    order.push(`dialogue:${dialogueIndex}`);
  }
  while (nextAction < actionCount) {
    order.push(`action:${nextAction}`);
    nextAction += 1;
  }
  return order;
}

export function normalizeScreenplayBodyOrder(
  scene: Pick<GeneratedScene, "body_order" | "character_actions" | "dialogues">,
): ScreenplayBodyReference[] {
  const expected = new Set<ScreenplayBodyReference>([
    ...scene.character_actions.map((_, index) => `action:${index}` as const),
    ...scene.dialogues.map((_, index) => `dialogue:${index}` as const),
  ]);
  const requested = scene.body_order;
  if (Array.isArray(requested)) {
    const normalized = requested.map((item) => item.trim());
    const kinds = normalized.map((item) => item.split(":", 1)[0]);
    const groupedByKind = [
      ...Array.from({ length: scene.character_actions.length }, () => "action"),
      ...Array.from({ length: scene.dialogues.length }, () => "dialogue"),
    ].every((kind, index) => kinds[index] === kind)
      || [
        ...Array.from({ length: scene.dialogues.length }, () => "dialogue"),
        ...Array.from({ length: scene.character_actions.length }, () => "action"),
      ].every((kind, index) => kinds[index] === kind);
    if (
      normalized.length === expected.size
      && new Set(normalized).size === normalized.length
      && normalized.every((item) => BODY_REFERENCE_PATTERN.test(item))
      && normalized.every((item) => expected.has(item as ScreenplayBodyReference))
      && !(scene.character_actions.length > 1 && scene.dialogues.length > 1 && groupedByKind)
    ) {
      return normalized as ScreenplayBodyReference[];
    }
  }
  return buildDefaultScreenplayBodyOrder(
    scene.character_actions.length,
    scene.dialogues.length,
  );
}

export function orderedScreenplayBody(
  scene: Pick<GeneratedScene, "body_order" | "character_actions" | "dialogues">,
): OrderedScreenplayBodyItem[] {
  return normalizeScreenplayBodyOrder(scene).map((reference) => {
    const [kind, rawIndex] = reference.split(":", 2) as ["action" | "dialogue", string];
    const index = Number(rawIndex);
    return kind === "action"
      ? { kind, index, action: scene.character_actions[index] }
      : { kind, index, dialogue: scene.dialogues[index] };
  });
}
