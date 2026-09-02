import type {
  StoryInspirationBrief,
  StoryInspirationFrontierQuestion,
} from "./types.ts";

export type StoryInspirationAnswerKind = "choice" | "custom" | "unsure" | "delegate";

export interface StoryInspirationRoundAnswer {
  kind: StoryInspirationAnswerKind;
  value: string;
  note: string;
}

type InspirationCoreField =
  | "story_promise"
  | "protagonist_and_goal"
  | "core_obstacle"
  | "stakes"
  | "relationship_direction"
  | "reveal_or_twist"
  | "ending_direction"
  | "tone_and_pacing";

const INSPIRATION_CORE_FIELDS = new Set<InspirationCoreField>([
  "story_promise",
  "protagonist_and_goal",
  "core_obstacle",
  "stakes",
  "relationship_direction",
  "reveal_or_twist",
  "ending_direction",
  "tone_and_pacing",
]);

function inspirationBriefFieldForQuestion(
  question: StoryInspirationFrontierQuestion,
): InspirationCoreField | null {
  const field = question.decision_key.split(".", 1)[0] as InspirationCoreField;
  return INSPIRATION_CORE_FIELDS.has(field) ? field : null;
}

function roundAnswerPreview(answer: StoryInspirationRoundAnswer): string {
  if (answer.kind === "unsure" || answer.kind === "delegate") return "";
  return answer.value.trim();
}

/**
 * Merge the current round into a new brief value without mutating the saved
 * session. It is a live preview until every question has been answered, then
 * becomes the request checkpoint when the user submits the complete round.
 */
export function previewStoryInspirationBrief(
  brief: StoryInspirationBrief,
  questions: StoryInspirationFrontierQuestion[],
  answers: Record<string, StoryInspirationRoundAnswer>,
): StoryInspirationBrief {
  const preview = {
    ...brief,
    must_keep: [...brief.must_keep],
    must_avoid: [...brief.must_avoid],
    unresolved: [...brief.unresolved],
    additional_notes: [...brief.additional_notes],
    creative_decisions: [...(brief.creative_decisions ?? [])],
  };
  const decisions = new Map(
    preview.creative_decisions.map((decision) => [decision.decision_key, decision]),
  );
  for (const question of questions) {
    const answer = answers[question.decision_key];
    if (!answer || !storyInspirationAnswerIsComplete(answer)) continue;
    const field = inspirationBriefFieldForQuestion(question);
    const value = roundAnswerPreview(answer);
    if (field && value) preview[field] = value;
    const isUnresolved = answer.kind === "unsure";
    const isDelegated = answer.kind === "delegate";
    preview.unresolved = preview.unresolved.filter((item) => !item.startsWith(`${question.title}：`));
    decisions.set(question.decision_key, {
      decision_key: question.decision_key,
      title: question.title,
      value: isUnresolved || isDelegated ? null : answer.value.trim(),
      authority: isUnresolved || isDelegated ? "provisional" : "canonical",
      status: isUnresolved ? "unresolved" : isDelegated ? "delegated" : "confirmed",
      source: "grill_answer",
      owner: "user",
      ai_permission: isDelegated ? "suggest_only" : "none",
      locked: false,
    });
    if (isUnresolved) {
      preview.unresolved = [
        ...new Set([
          ...preview.unresolved,
          `${question.title}：暂时不确定，保留到后续阶段再决定`,
        ]),
      ].slice(-12);
    }
  }
  preview.creative_decisions = [...decisions.values()].slice(0, 80);
  return preview;
}

export function storyInspirationRoundAnswersFromMessage(
  questions: StoryInspirationFrontierQuestion[],
  message: string,
): Record<string, StoryInspirationRoundAnswer> {
  const answers: Record<string, StoryInspirationRoundAnswer> = {};
  for (const question of questions) {
    const escapedQuestionId = question.question_id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const block = message.match(new RegExp(
      `(?:^|\\n)\\s*${escapedQuestionId}(?:\\s*[｜|]\\s*[^\\n]*)?`
      + `\\s*\\n\\s*方向\\s*[：:]\\s*([^\\n]+)`
      + `(?:\\s*\\n\\s*补充\\s*[：:]\\s*([^\\n]+))?`,
    ));
    const value = block?.[1]?.trim() ?? "";
    if (!value) continue;
    const delegate = value.startsWith("已授权剧本大师先提出方案")
      || value.startsWith("暂时不确定，请剧本大师依据当前故事给出最佳方案");
    const unsure = value.startsWith("暂时不确定") && !delegate;
    answers[question.decision_key] = {
      kind: delegate ? "delegate" : unsure ? "unsure" : question.choices.includes(value) ? "choice" : "custom",
      value: unsure || delegate ? "" : value,
      note: block?.[2]?.trim() ?? "",
    };
  }
  return answers;
}

function normalizedChoiceLabel(value: string): string {
  return value
    .split(/[：:]/, 1)[0]
    .replace(/[\s，。,.；;：:、“”‘’]/g, "")
    .toLocaleLowerCase();
}

export function recommendedChoiceForQuestion(
  question: StoryInspirationFrontierQuestion,
): string | null {
  const explicit = question.recommended_choice?.trim();
  if (explicit) return question.choices.includes(explicit) ? explicit : null;

  const recommendation = question.recommended_answer?.trim();
  if (!recommendation) return null;
  const normalizedRecommendation = recommendation
    .replace(/[\s，。,.；;：:、“”‘’]/g, "")
    .toLocaleLowerCase();
  const matches = question.choices.filter((choice) => {
    const label = normalizedChoiceLabel(choice);
    return label.length >= 2 && normalizedRecommendation.includes(label);
  });
  return matches.length === 1 ? matches[0] : null;
}

export function storyInspirationAnswerIsComplete(
  answer: StoryInspirationRoundAnswer | undefined,
): boolean {
  if (!answer) return false;
  if (answer.kind === "unsure" || answer.kind === "delegate") return true;
  return answer.value.trim().length > 0;
}

export function buildStoryInspirationRoundMessage(
  questions: StoryInspirationFrontierQuestion[],
  answers: Record<string, StoryInspirationRoundAnswer>,
): string {
  return questions.map((question) => {
    const answer = answers[question.decision_key];
    const title = question.title.trim().slice(0, 40);
    const direction = answer?.kind === "unsure"
      ? "暂时不确定，保留到后续阶段再决定。"
      : answer?.kind === "delegate"
        ? "已授权剧本大师先提出方案，但未经我确认不能写入故事事实。"
        : answer?.value.trim().slice(0, 260) ?? "";
    const note = answer?.note.trim().slice(0, 140);
    return [
      `${question.question_id}｜${title}`,
      `方向：${direction}`,
      ...(note ? [`补充：${note}`] : []),
    ].join("\n");
  }).join("\n\n").slice(0, 2_000);
}
