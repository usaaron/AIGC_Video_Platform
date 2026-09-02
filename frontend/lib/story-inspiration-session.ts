import type {
  StoryInspirationBrief,
  StoryInspirationFrontierQuestion,
  StoryInspirationMessage,
  StoryInspirationSession,
} from "./types.ts";
import {
  previewStoryInspirationBrief,
  storyInspirationRoundAnswersFromMessage,
} from "./story-inspiration-round.ts";

export const INSPIRATION_SESSION_KEY = "__inspiration_session";

export const EMPTY_INSPIRATION_BRIEF: StoryInspirationBrief = {
  story_promise: "",
  protagonist_and_goal: "",
  core_obstacle: "",
  stakes: "",
  relationship_direction: "",
  reveal_or_twist: "",
  ending_direction: "",
  tone_and_pacing: "",
  must_keep: [],
  must_avoid: [],
  unresolved: [],
  additional_notes: [],
  creative_decisions: [],
};

const INSPIRATION_SCALAR_FIELDS = [
  "story_promise",
  "protagonist_and_goal",
  "core_obstacle",
  "stakes",
  "relationship_direction",
  "reveal_or_twist",
  "ending_direction",
  "tone_and_pacing",
] as const;

function mergeUniqueBriefItems(current: string[], next: string[], limit: number): string[] {
  return [...new Set([...current, ...next].map((item) => item.trim()).filter(Boolean))].slice(0, limit);
}

function mergeCreativeDecisions(
  current: StoryInspirationBrief["creative_decisions"],
  next: StoryInspirationBrief["creative_decisions"],
): StoryInspirationBrief["creative_decisions"] {
  const byKey = new Map(current.map((decision) => [decision.decision_key, decision]));
  for (const decision of next) byKey.set(decision.decision_key, decision);
  return [...byKey.values()].slice(0, 80);
}

export function mergeStoryInspirationBrief(
  current: StoryInspirationBrief,
  next: StoryInspirationBrief,
): StoryInspirationBrief {
  const merged: StoryInspirationBrief = {
    ...current,
    must_keep: mergeUniqueBriefItems(current.must_keep, next.must_keep, 12),
    must_avoid: mergeUniqueBriefItems(current.must_avoid, next.must_avoid, 12),
    unresolved: [...next.unresolved],
    additional_notes: mergeUniqueBriefItems(
      current.additional_notes,
      next.additional_notes,
      20,
    ),
    creative_decisions: mergeCreativeDecisions(
      current.creative_decisions,
      next.creative_decisions,
    ),
  };
  for (const field of INSPIRATION_SCALAR_FIELDS) {
    const value = next[field].trim();
    merged[field] = value || current[field];
  }
  return merged;
}

function emptyInspirationSession(): StoryInspirationSession {
  return {
    schemaVersion: "v1",
    status: "active",
    messages: [],
    brief: { ...EMPTY_INSPIRATION_BRIEF },
    readyToGenerate: false,
    updatedAt: new Date().toISOString(),
  };
}

function isFrontierQuestion(value: unknown): value is StoryInspirationFrontierQuestion {
  if (!value || typeof value !== "object") return false;
  const question = value as Partial<StoryInspirationFrontierQuestion>;
  return (
    typeof question.question_id === "string"
    && typeof question.decision_key === "string"
    && typeof question.title === "string"
    && typeof question.question === "string"
    && Array.isArray(question.choices)
    && (question.recommended_answer == null || typeof question.recommended_answer === "string")
  );
}

function isPausedMessage(message: StoryInspirationMessage | undefined): boolean {
  return Boolean(
    message?.role === "assistant"
    && message.content.trim().startsWith("已暂停本次思考"),
  );
}

function recoverStoryInspirationBriefFromMessages(
  messages: StoryInspirationMessage[],
): StoryInspirationBrief {
  let recovered = { ...EMPTY_INSPIRATION_BRIEF };
  let pendingQuestions: StoryInspirationFrontierQuestion[] = [];
  for (const message of messages) {
    if (message.role === "assistant") {
      pendingQuestions = message.questions;
      continue;
    }
    if (!pendingQuestions.length) continue;
    const answers = storyInspirationRoundAnswersFromMessage(
      pendingQuestions,
      message.content,
    );
    recovered = previewStoryInspirationBrief(recovered, pendingQuestions, answers);
    pendingQuestions = [];
  }
  return recovered;
}

export function normalizeStoryInspirationSession(value: unknown): StoryInspirationSession {
  if (!value || typeof value !== "object") return emptyInspirationSession();
  const candidate = value as Partial<StoryInspirationSession>;
  let messages = Array.isArray(candidate.messages)
    ? candidate.messages.filter((message): message is StoryInspirationMessage => (
      Boolean(message)
      && typeof message === "object"
      && typeof message.id === "string"
      && (message.role === "assistant" || message.role === "user")
      && typeof message.content === "string"
      && typeof message.createdAt === "string"
    )).map((message) => ({
      ...message,
      questions: Array.isArray((message as Partial<StoryInspirationMessage>).questions)
        ? (message as Partial<StoryInspirationMessage>).questions!
          .filter(isFrontierQuestion)
          .slice(0, 4)
        : [],
    })).slice(-30)
    : [];
  const readyToGenerate = candidate.readyToGenerate === true;
  const lastMessage = messages.at(-1);
  if (
    !readyToGenerate
    && lastMessage?.role === "assistant"
    && lastMessage.questions.length === 0
    && !isPausedMessage(lastMessage)
  ) {
    messages = messages.slice(0, -1);
  }
  const persistedBrief = candidate.brief && typeof candidate.brief === "object"
    ? { ...EMPTY_INSPIRATION_BRIEF, ...candidate.brief }
    : { ...EMPTY_INSPIRATION_BRIEF };
  persistedBrief.creative_decisions = Array.isArray(persistedBrief.creative_decisions)
    ? persistedBrief.creative_decisions
    : [];
  const brief = mergeStoryInspirationBrief(
    recoverStoryInspirationBriefFromMessages(messages),
    persistedBrief,
  );
  return {
    schemaVersion: "v1",
    status: candidate.status === "ready" || candidate.status === "completed"
      ? candidate.status
      : "active",
    messages,
    brief,
    readyToGenerate,
    updatedAt: typeof candidate.updatedAt === "string"
      ? candidate.updatedAt
      : new Date().toISOString(),
  };
}

export function storyInspirationSessionForSections(
  sections: Record<string, unknown> | undefined,
): StoryInspirationSession {
  return normalizeStoryInspirationSession(sections?.[INSPIRATION_SESSION_KEY]);
}

export function storyInspirationSessionNeedsTurn(
  session: StoryInspirationSession,
): boolean {
  if (session.readyToGenerate || session.status === "completed") return false;
  const lastMessage = session.messages.at(-1);
  if (!lastMessage) return true;
  if (lastMessage.role === "user") return true;
  return lastMessage.questions.length === 0 && !isPausedMessage(lastMessage);
}

export function storyInspirationTurnIsActionable(
  readyToGenerate: boolean,
  questions: StoryInspirationFrontierQuestion[],
): boolean {
  return readyToGenerate || questions.length > 0;
}
