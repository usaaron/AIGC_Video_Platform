import type { StoryInspirationBrief, StorySynopsis } from "./types";

/** Deduplicate repeated facts across generated fields, preserving authored prose. */
export function synopsisBriefParagraphs(brief: StoryInspirationBrief): string[] {
  const fields = [brief.story_promise, brief.protagonist_and_goal, brief.core_obstacle,
    brief.stakes, brief.relationship_direction, brief.reveal_or_twist, brief.ending_direction];
  const segmenter = new Intl.Segmenter("zh", { granularity: "sentence" });
  const seen = new Set<string>();
  return fields.map((field) => {
    const segments = [...segmenter.segment(field.trim())].map(({ segment }) => segment);
    const key = (value: string) => value.trim().replace(/\s+/g, "");
    const paragraph = segments.filter((segment) => !seen.has(key(segment))).join("").trim();
    segments.forEach((segment) => seen.add(key(segment)));
    return paragraph;
  }).filter(Boolean);
}

/** Older refining drafts predate the explicit pending marker. */
export function synopsisHasPendingChanges(synopsis?: Pick<StorySynopsis, "status" | "pendingChanges">): boolean {
  return synopsis?.pendingChanges ?? synopsis?.status === "refining";
}

function briefContentKey(value: unknown, field?: string): string {
  if (typeof value === "string") return JSON.stringify(value.trim());
  if (Array.isArray(value)) {
    const items = value.map((item) => briefContentKey(item));
    // Creative decisions are applied in order: a later record can supersede an
    // earlier decision with the same key. The other brief lists are sets.
    return `[${(field === "creative_decisions" ? items : items.sort()).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value).filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${briefContentKey(item, key)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function synopsisAfterDiscussion(
  synopsis: StorySynopsis,
  previousBrief: StoryInspirationBrief,
  nextBrief: StoryInspirationBrief,
): StorySynopsis {
  const effectiveBrief = (brief: StoryInspirationBrief) => ({
    ...brief,
    creative_decisions: brief.creative_decisions.filter((decision) => !(
      decision.status === "proposed"
      && decision.source === "ai_proposal"
      && decision.authority === "provisional"
      && !decision.locked
    )),
  });
  if (briefContentKey(effectiveBrief(previousBrief)) === briefContentKey(effectiveBrief(nextBrief))) return synopsis;
  return { ...synopsis, status: "refining", pendingChanges: true, review: undefined };
}

export function synopsisAfterManualEdit(synopsis: StorySynopsis, text: string): StorySynopsis {
  return {
    ...synopsis,
    text,
    status: "draft",
    source: "user",
    pendingChanges: synopsisHasPendingChanges(synopsis),
    review: undefined,
  };
}

/** Keep the prior saved document, including author edits, before replacing it. */
export function synopsisWithRevision(
  previous: StorySynopsis,
  next: StorySynopsis,
): StorySynopsis {
  const { history = [], ...snapshot } = previous;
  return {
    ...next,
    version: Math.max(previous.version, next.version) + 1,
    history: [...history, snapshot],
  };
}

export type SynopsisUnresolvedItem =
  | { kind: "unresolved"; index: number; value: string; label: string }
  | { kind: "decision"; decisionKey: string; label: string };

export function synopsisUnresolvedItems(brief: StoryInspirationBrief): SynopsisUnresolvedItem[] {
  const currentDecisions = new Map(brief.creative_decisions.map((decision) => [decision.decision_key, decision]));
  return [
    ...brief.unresolved.map((value, index): SynopsisUnresolvedItem => ({
      kind: "unresolved", index, value, label: `待作者决定：${value}`,
    })),
    ...[...currentDecisions.values()]
      .filter((decision) => decision.status === "unresolved" || decision.status === "conflicted")
      .map((decision): SynopsisUnresolvedItem => ({
        kind: "decision", decisionKey: decision.decision_key,
        label: `${decision.status === "conflicted" ? "待澄清" : "待作者决定"}：${decision.title}${decision.value ? ` — ${decision.value}` : ""}`,
      })),
  ];
}

/** Only an explicit author action removes a reservation; never infer new facts. */
export function resolveSynopsisUnresolvedItem(synopsis: StorySynopsis, item: SynopsisUnresolvedItem): StorySynopsis {
  const conversation = synopsis.conversation;
  if (!synopsis.text.trim() || !conversation) return synopsis;
  const currentBrief = conversation.brief;
  if (item.kind === "unresolved" && currentBrief.unresolved[item.index] !== item.value) return synopsis;
  if (item.kind === "decision" && !synopsisUnresolvedItems(currentBrief)
    .some((current) => current.kind === "decision" && current.decisionKey === item.decisionKey)) return synopsis;
  const nextBrief: StoryInspirationBrief = item.kind === "unresolved" ? {
    ...currentBrief,
    unresolved: currentBrief.unresolved.filter((_, index) => index !== item.index),
  } : {
    ...currentBrief,
    creative_decisions: currentBrief.creative_decisions.filter((decision) => !(
      decision.decision_key === item.decisionKey
      && (decision.status === "unresolved" || decision.status === "conflicted")
    )),
  };
  return synopsisWithRevision(synopsis, {
    ...synopsis,
    status: "draft",
    pendingChanges: synopsisHasPendingChanges(synopsis),
    review: undefined,
    conversation: { ...conversation, brief: nextBrief },
  });
}

export function requireCompleteSynopsisText(text: string): string {
  if (text.length > 20_000) {
    throw new Error("当前梗概超过 20,000 字，请先精简或分段整理；本次不会截断或覆盖原稿。");
  }
  return text;
}

/** Late save/model callbacks belong to the request and project that started them. */
export function synopsisOperationIsCurrent(
  controller: AbortController,
  activeController: AbortController | null,
  requestedProjectId: string,
  currentProjectId: string,
): boolean {
  return controller === activeController
    && !controller.signal.aborted
    && requestedProjectId === currentProjectId;
}
