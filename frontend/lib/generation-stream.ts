import type {
  ScriptGenerationStage,
  ScriptGenerationStreamEvent,
} from "@/lib/generation-client";
import { scriptBodyLengthGuidance } from "./generation-planning.ts";

export type EpisodeStreamStatus = "queued" | "active" | "completed" | "failed";

export interface EpisodeStreamProgress {
  episodeNumber: number;
  status: EpisodeStreamStatus;
  stage: ScriptGenerationStage | "queued" | "failed";
  rawOutput: string;
  preview: string;
  targetCharacters: number;
  preferredMinCharacters: number;
  preferredMaxCharacters: number;
  actualCharacters?: number;
  title?: string;
  error?: string;
  startedAt?: number;
  completedAt?: number;
  pausedAt?: number;
  pausedDurationMs?: number;
  modelPassCount?: number;
  generationElapsedMs?: number;
  firstPassAccepted?: boolean;
  attemptCount?: number;
}

export function createEpisodeStreamBatch(
  startEpisode: number,
  endEpisode: number,
  targetCharacters: number,
): EpisodeStreamProgress[] {
  const guidance = scriptBodyLengthGuidance(targetCharacters);
  return Array.from(
    { length: endEpisode - startEpisode + 1 },
    (_, index) => ({
      episodeNumber: startEpisode + index,
      status: "queued" as const,
      stage: "queued" as const,
      rawOutput: "",
      preview: "",
      targetCharacters,
      preferredMinCharacters: guidance.preferredMinCharacters,
      preferredMaxCharacters: guidance.preferredMaxCharacters,
    }),
  );
}

export function startEpisodeStream(
  batch: EpisodeStreamProgress[],
  episodeNumber: number,
  targetCharacters: number,
): EpisodeStreamProgress[] {
  const guidance = scriptBodyLengthGuidance(targetCharacters);
  return batch.map((item) => item.episodeNumber === episodeNumber
    ? (() => {
      const isAutomaticRetry = (item.attemptCount ?? 0) > 0;
      return {
        ...item,
        status: "active",
        stage: "preparing",
        targetCharacters,
        preferredMinCharacters: guidance.preferredMinCharacters,
        preferredMaxCharacters: guidance.preferredMaxCharacters,
        // Preserve a readable prior attempt until the retry has completed.
        rawOutput: isAutomaticRetry ? item.rawOutput : "",
        preview: isAutomaticRetry ? item.preview : "",
        error: undefined,
        // Keep one wall-clock timer across automatic retries for this episode.
        startedAt: item.startedAt ?? Date.now(),
        completedAt: undefined,
        modelPassCount: undefined,
        generationElapsedMs: undefined,
        firstPassAccepted: undefined,
        attemptCount: (item.attemptCount ?? 0) + 1,
      };
    })()
    : item);
}

export function applyEpisodeStreamEvent(
  batch: EpisodeStreamProgress[],
  episodeNumber: number,
  event: ScriptGenerationStreamEvent,
): EpisodeStreamProgress[] {
  return batch.map((item) => {
    if (item.episodeNumber !== episodeNumber) return item;
    if (event.type === "stage") {
      return {
        ...item,
        status: event.stage === "completed" ? item.status : "active",
        stage: event.stage,
        actualCharacters: event.actual_characters ?? item.actualCharacters,
        targetCharacters: event.target_characters ?? item.targetCharacters,
        preferredMinCharacters: event.preferred_min_characters
          ?? item.preferredMinCharacters,
        preferredMaxCharacters: event.preferred_max_characters
          ?? item.preferredMaxCharacters,
      };
    }
    if (event.type === "draft_delta") {
      // Repair models often stream a merge patch or one nested contract item.
      // Keep the readable first draft on screen while those internal passes run;
      // the authoritative final result replaces the workspace only after validation.
      if (event.phase !== "draft" || (item.attemptCount ?? 0) > 1) return item;
      const rawOutput = event.reset ? event.delta : item.rawOutput + event.delta;
      return {
        ...item,
        status: "active",
        rawOutput,
        preview: extractReadableStreamPreview(rawOutput),
      };
    }
    if (event.type === "error") {
      return {
        ...item,
        status: "failed",
        stage: "failed",
        error: event.message,
        completedAt: Date.now(),
      };
    }
    return item;
  });
}

export function completeEpisodeStream(
  batch: EpisodeStreamProgress[],
  episodeNumber: number,
  details: {
    title?: string;
    actualCharacters: number;
    modelPassCount?: number;
    generationElapsedMs?: number;
    firstPassAccepted?: boolean;
  },
): EpisodeStreamProgress[] {
  return batch.map((item) => item.episodeNumber === episodeNumber
    ? {
        ...item,
        status: "completed",
        stage: "completed",
        title: details.title ?? item.title,
        actualCharacters: details.actualCharacters,
        modelPassCount: details.modelPassCount,
        generationElapsedMs: details.generationElapsedMs,
        firstPassAccepted: details.firstPassAccepted,
        completedAt: Date.now(),
      }
    : item);
}

export function failEpisodeStream(
  batch: EpisodeStreamProgress[],
  episodeNumber: number,
  error: string,
): EpisodeStreamProgress[] {
  return batch.map((item) => item.episodeNumber === episodeNumber
    ? {
        ...item,
        status: "failed",
        stage: "failed",
        error,
        completedAt: Date.now(),
      }
    : item);
}

export function markEpisodeAutomaticRetry(
  batch: EpisodeStreamProgress[],
  episodeNumber: number,
): EpisodeStreamProgress[] {
  return batch.map((item) => item.episodeNumber === episodeNumber
    ? {
        ...item,
        status: "active",
        stage: "preparing",
        error: undefined,
        completedAt: undefined,
      }
    : item);
}

export function extractReadableStreamPreview(rawOutput: string): string {
  const normalized = rawOutput.trim();
  if (!normalized) return "";
  try {
    const parsed = JSON.parse(stripMarkdownFence(normalized)) as Record<string, unknown>;
    const visible = collectScreenplayValues(parsed);
    if (visible.length) return visible.join("\n");
  } catch {
    // A streaming JSON document is normally incomplete until the final chunk.
  }
  return scanCompletedStringValues(normalized).slice(-80).join("\n");
}

function collectScreenplayValues(value: Record<string, unknown>): string[] {
  const values: string[] = [];
  if (typeof value.title === "string" && value.title.trim()) {
    values.push(value.title.trim());
  }
  if (!Array.isArray(value.scenes)) return values;
  for (const rawScene of value.scenes) {
    if (!rawScene || typeof rawScene !== "object" || Array.isArray(rawScene)) continue;
    const scene = rawScene as Record<string, unknown>;
    if (typeof scene.slug === "string" && scene.slug.trim()) {
      values.push(`【${scene.slug.trim()}】`);
    }
    if (typeof scene.setting === "string" && scene.setting.trim()) {
      values.push(`场景：${scene.setting.trim()}`);
    }
    if (Array.isArray(scene.character_actions)) {
      for (const action of scene.character_actions) {
        if (typeof action === "string" && action.trim()) {
          values.push(`△ ${action.trim()}`);
        }
      }
    }
    if (Array.isArray(scene.dialogues)) {
      for (const rawDialogue of scene.dialogues) {
        if (!rawDialogue || typeof rawDialogue !== "object" || Array.isArray(rawDialogue)) continue;
        const dialogue = rawDialogue as Record<string, unknown>;
        if (typeof dialogue.text !== "string" || !dialogue.text.trim()) continue;
        const speaker = typeof dialogue.character_name === "string"
          ? dialogue.character_name.trim()
          : "";
        const intent = typeof dialogue.intent === "string" ? dialogue.intent.trim() : "";
        values.push(`${speaker}${intent ? `（${intent}）` : ""}\n${dialogue.text.trim()}`);
      }
    }
  }
  return values;
}

function scanCompletedStringValues(rawOutput: string): string[] {
  const values: string[] = [];
  let currentKey = "";
  let speaker = "";
  let intent = "";
  let index = 0;
  while (index < rawOutput.length) {
    if (rawOutput[index] !== '"') {
      index += 1;
      continue;
    }
    const start = index;
    index += 1;
    let escaped = false;
    while (index < rawOutput.length) {
      const character = rawOutput[index];
      if (!escaped && character === '"') break;
      escaped = !escaped && character === "\\";
      if (character !== "\\") escaped = false;
      index += 1;
    }
    if (index >= rawOutput.length) break;
    const encoded = rawOutput.slice(start, index + 1);
    index += 1;
    let next = index;
    while (/\s/.test(rawOutput[next] ?? "")) next += 1;
    try {
      const value = JSON.parse(encoded) as string;
      if (rawOutput[next] === ":") {
        currentKey = value;
        continue;
      }
      const normalized = value.trim();
      if (normalized.length < 2) continue;
      if (currentKey === "title") values.push(normalized);
      else if (currentKey === "slug") values.push(`【${normalized}】`);
      else if (currentKey === "setting") values.push(`场景：${normalized}`);
      else if (currentKey === "character_actions") values.push(`△ ${normalized}`);
      else if (currentKey === "character_name") speaker = normalized;
      else if (currentKey === "intent") intent = normalized;
      else if (currentKey === "text") {
        values.push(`${speaker}${intent ? `（${intent}）` : ""}\n${normalized}`);
        intent = "";
      }
    } catch {
      // Ignore one malformed token and continue scanning later chunks.
    }
  }
  return values;
}

function stripMarkdownFence(value: string): string {
  const lines = value.split("\n");
  if (lines[0]?.trim().toLowerCase() === "```json" && lines.at(-1)?.trim() === "```") {
    return lines.slice(1, -1).join("\n").trim();
  }
  return value;
}
