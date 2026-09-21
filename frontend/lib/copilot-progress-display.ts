import type { CopilotProgress } from "./copilot-progress";
import { COPILOT_TEXT_NOTICES } from "./copilot-progress";

const CHINESE_TEXT = /[\u3400-\u9fff]/;
const TECHNICAL_WORD = /^(?:JSON|API|SSE|HTTP|HTTPS|URL|URI|UI|UX|AI|ID|DNA|VIP|LLM|GPT|SQL|HTML|CSS|UTF-?8|PDF|CSV|XML|YAML)$/;
const NAME_WORD = /^[A-Z][a-z]*(?:['’\-][A-Z]?[a-z]+)*$/;
const PROSE_START = /^(?:I|We|You|The|This|That|There|Let|First|Next|Then|Now|Please|Thinking|Waiting|Checking|Check|Analyzing|Analysing|Reviewing|Generating|Writing|Processing|Validating)$/i;
const PROSE_WORD = /^(?:i|we|you|the|a|an|and|or|but|to|of|for|is|are|was|were|need|should|must|will|would|can|could|let|checking|analyzing|generating|writing)$/i;
const THINKING_FORMAT_NOTICE = "已略过孤立编号和空白片段，显示可读的模型思考。";

function isOrphanMarker(value: string): boolean {
  const stripped = value.replace(/["'“”‘’`]/gu, "")
    .replaceAll("[", "").replaceAll("]", "").replaceAll("{", "").replaceAll("}", "").trim();
  return /^(?:\d{1,3}|[一二三四五六七八九十百]+)\s*(?:[.)、:：])?$/u.test(stripped);
}

/**
 * Reasoning providers sometimes include a draft outline while they think.
 * Keep the provider's readable text, but hide orphan list markers such as `2)`.
 * Chinese scene headings, dialogue, and numbered explanations stay intact.
 * Stored progress remains untouched so the full trace is still recoverable.
 */
export function thinkingTextForDisplay(value: string): string {
  const lines = value.replace(/\r\n?/g, "\n").split("\n");
  const kept: string[] = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      if (kept.length && kept.at(-1) !== "") kept.push("");
      continue;
    }
    if (isOrphanMarker(line)) {
      continue;
    }
    if (!/[\p{L}\p{N}]/u.test(line)) {
      continue;
    }
    kept.push(rawLine);
  }
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * A narrow presentation guard for obvious non-Chinese prose, including old history.
 * This is not the identity-aware language validator used for generated artifacts:
 * progress views have no character registry, so short names inside Chinese text
 * and technical identifiers must remain readable.
 */
function hasNonChineseProse(value: string): boolean {
  return value.split(/[\n。！？!?；;]|\.(?:\s+|$)/).some((sentence) => {
    // Other writing systems are not Chinese progress either. Keep Han, Latin
    // names and identifiers; do not mistake punctuation or emoji for prose.
    if (/\p{L}/u.test(sentence.replace(/[\p{Script=Han}\p{Script=Latin}]/gu, ""))) return true;
    const hasChinese = CHINESE_TEXT.test(sentence);
    // Formatting and non-ASCII spaces must not hide an English phrase. Preserve
    // underscores inside technical identifiers such as source_language.
    const plain = sentence.replace(/[*`~]/g, "").replace(/(?<![A-Za-z0-9])_+|_+(?![A-Za-z0-9])/g, "");
    const runs = plain.match(/[A-Za-z][A-Za-z0-9_'’.-]*(?:\s+[A-Za-z][A-Za-z0-9_'’.-]*)*/g) ?? [];
    return runs.some((run) => {
      const words = run.split(/\s+/).map((word) => word.replace(/[.]+$/, ""))
        .filter((word) => !TECHNICAL_WORD.test(word) && !/[_0-9]/.test(word));
      if (!words.length) return false;
      if (!hasChinese) return true;
      if (words.length <= 4 && words.every((word) => NAME_WORD.test(word)) && !PROSE_START.test(words[0])) {
        return false;
      }
      return PROSE_START.test(words[0]) || words.length >= 3 || (words.length >= 2 && words.some((word) => PROSE_WORD.test(word)));
    });
  });
}

/** Only call at render time; never write this projection back into history. */
export function copilotProgressForDisplay(progress: CopilotProgress): CopilotProgress & { thinkingNotice?: string } {
  const thinking = progress.thinking === undefined ? undefined : thinkingTextForDisplay(progress.thinking);
  const omittedNonChinese = thinking !== undefined && hasNonChineseProse(thinking);
  // Older histories stored notices as a step. Surface them independently too,
  // so later provider stages cannot conceal that some text was omitted.
  const notices = [...new Set([...(progress.notices ?? []).filter(notice => COPILOT_TEXT_NOTICES.has(notice)),
    ...progress.steps.filter(step => COPILOT_TEXT_NOTICES.has(step.message)).map(step => step.message)])];
  return {
    ...progress,
    steps: progress.steps.map((step) => ({
      ...step,
      message: hasNonChineseProse(step.message) ? "此步骤说明未使用中文，暂不展示原文。" : step.message,
    })),
    summary: hasNonChineseProse(progress.summary) ? "模型返回的摘要未使用中文，暂不展示原文。" : progress.summary,
    ...(progress.thinking === undefined ? {} : {
      thinking: omittedNonChinese
        ? "模型返回的思考内容未使用中文，暂不展示原文。"
        : thinking,
    }),
    ...(!omittedNonChinese && thinking !== undefined && thinking !== progress.thinking?.trim()
      ? { thinkingNotice: THINKING_FORMAT_NOTICE } : {}),
    ...(notices.length ? { notices } : {}),
  };
}
