import { CreatorNarrativeLanguageError, mainlandTextIsEnglishDominant } from "./mainland-language";

const SAMPLE = /^(拒绝|撒谎|示弱|亲近者|对手)｜EN:[ \t]*([^|｜\r\n]+)｜中译:[ \t]*([^|｜\r\n]+)$/;
const SAMPLE_MARKER = /[|｜]|\bEN\s*[:：]|中译\s*[:：]/i;
const LINE_SEPARATOR = /\r\n|[\n\v\f\r\x1c-\x1e\x85\u2028\u2029]/;

export class OverseasVoiceSampleError extends CreatorNarrativeLanguageError {
  constructor(fieldLabels: readonly string[]) {
    super(fieldLabels);
    this.name = "OverseasVoiceSampleError";
    this.message = `请检查${fieldLabels.slice(0, 5).join("、")}：英文样例请单独成行，使用“拒绝｜EN: …｜中译: …”`
      + "（情境可选拒绝、撒谎、示弱、亲近者、对手），最多3条；说明和中译使用中文，整个字段不超过600字符。";
  }
}

/** Whole bilingual lines are indivisible when packing generation instructions. */
export function overseasVoiceSampleLines(value: string): string[] {
  return value.split(LINE_SEPARATOR).map(line => line.trim()).filter(line => {
    const matched = SAMPLE.exec(line);
    return matched && /[A-Za-z]/.test(matched[2]) && !/[\u3400-\u9fff]/.test(matched[2])
      && /[\u3400-\u9fff]/.test(matched[3]);
  });
}

/** Validate only the explicit quoted samples; the author's voice description stays Chinese. */
export function overseasVoiceValidationText(
  value: string,
  allowedNames: readonly string[] = [],
): { text: string; valid: boolean } {
  const lines = value.split(LINE_SEPARATOR);
  let samples = 0;
  let valid = value.length <= 600;
  const text = lines.map((line) => {
    if (!SAMPLE_MARKER.test(line)) {
      if (mainlandTextIsEnglishDominant(line, allowedNames)) valid = false;
      return line;
    }
    const matched = SAMPLE.exec(line.trim());
    if (!matched || !/[A-Za-z]/.test(matched[2]) || /[\u3400-\u9fff]/.test(matched[2])
      || !/[\u3400-\u9fff]/.test(matched[3]) || mainlandTextIsEnglishDominant(matched[3], allowedNames)) {
      valid = false;
      return line;
    }
    samples++;
    return `${matched[1]}：${matched[3].trim()}`;
  }).join("\n");
  return { text, valid: valid && samples <= 3 };
}
