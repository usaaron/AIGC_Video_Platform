import type { CopilotProgress } from "./copilot-progress";

const CHINESE_TEXT = /[\u3400-\u9fff]/;
const TECHNICAL_WORD = /^(?:JSON|API|SSE|HTTP|HTTPS|URL|URI|UI|UX|AI|ID|DNA|VIP|LLM|GPT|SQL|HTML|CSS|UTF-?8|PDF|CSV|XML|YAML)$/;
const NAME_WORD = /^[A-Z][a-z]*(?:['’\-][A-Z]?[a-z]+)*$/;
const PROSE_START = /^(?:I|We|You|The|This|That|There|Let|First|Next|Then|Now|Please|Thinking|Waiting|Checking|Check|Analyzing|Analysing|Reviewing|Generating|Writing|Processing|Validating)$/i;
const PROSE_WORD = /^(?:i|we|you|the|a|an|and|or|but|to|of|for|is|are|was|were|need|should|must|will|would|can|could|let|checking|analyzing|generating|writing)$/i;

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
export function copilotProgressForDisplay(progress: CopilotProgress): CopilotProgress {
  return {
    ...progress,
    steps: progress.steps.map((step) => ({
      ...step,
      message: hasNonChineseProse(step.message) ? "此步骤说明未使用中文，暂不展示原文。" : step.message,
    })),
    summary: hasNonChineseProse(progress.summary) ? "模型返回的摘要未使用中文，暂不展示原文。" : progress.summary,
    ...(progress.thinking === undefined ? {} : {
      thinking: hasNonChineseProse(progress.thinking) ? "模型返回的思考内容未使用中文，暂不展示原文。" : progress.thinking,
    }),
  };
}
