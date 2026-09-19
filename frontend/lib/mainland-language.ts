const CHINESE_CHARACTER_PATTERN = /[\u3400-\u9fff]/g;
const LATIN_CHARACTER_PATTERN = /[A-Za-z]/g;
const COMMON_ABBREVIATION_PATTERN = /(?<![A-Za-z])[A-Z]{1,4}(?:-?\d{1,4})?(?![A-Za-z])/g;
const PERSONAL_NAME_WORD = /^[A-Z][a-zA-Z]*(?:['’-][A-Z]?[a-zA-Z]+)*$/;
const NAME_TITLES = new Set([
  "mr", "mrs", "ms", "miss", "dr", "doctor", "professor", "sir", "lady",
  "lord", "king", "queen", "prince", "princess", "duke", "duchess",
  "marquis", "marquess", "count", "countess", "baron", "baroness",
  "captain", "commander", "general", "officer", "father", "mother",
]);

// Keep this language-only view aligned with overseas_identity.py. The supplied
// identity ledger may permit a unique given name, never a guessed nickname,
// surname, title or arbitrary capitalized word from narrative text.
export function englishLanguageNameExceptions(names: readonly string[]): string[] {
  const registered = [...new Set(names.map((name) => name.trim()))]
    .filter((name) => /^[A-Za-z][A-Za-z .’'-]{0,79}$/.test(name));
  const owners = new Map<string, Set<string>>();
  const shorthand = new Map<string, string>();
  for (const name of registered) {
    const parts = name.split(/\s+/);
    const first = parts[0];
    const key = first.toLowerCase();
    const identities = owners.get(key) ?? new Set<string>();
    identities.add(name.toLowerCase());
    owners.set(key, identities);
    if (parts.length >= 2 && parts.length <= 4
      && parts.every((part) => PERSONAL_NAME_WORD.test(part))
      && !parts.some((part) => NAME_TITLES.has(part.toLowerCase()))) {
      if (!shorthand.has(key)) shorthand.set(key, first);
    }
  }
  return [...registered, ...[...shorthand].filter(([key]) => owners.get(key)?.size === 1).map(([, name]) => name)];
}

export class CreatorNarrativeLanguageError extends Error {
  constructor(fieldLabels: readonly string[]) {
    super(`以下内容需要使用中文叙述：${fieldLabels.slice(0, 5).join("、")}。请保留已确认的英文人物名和常用缩写。`);
    this.name = "CreatorNarrativeLanguageError";
  }
}

export function mainlandTextIsEnglishDominant(
  value: string | null | undefined,
  allowedNames: readonly string[] = [],
): boolean {
  if (!value?.trim()) return false;

  let narrative = value;
  for (const name of englishLanguageNameExceptions(allowedNames).sort((a, b) => b.length - a.length)) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    narrative = narrative.replace(new RegExp(`(?<![A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`, "gi"), "");
  }
  const withoutCommonAbbreviations = narrative.replace(COMMON_ABBREVIATION_PATTERN, "");
  const latinCount = withoutCommonAbbreviations.match(LATIN_CHARACTER_PATTERN)?.length ?? 0;
  if (latinCount === 0) return false;

  const chineseCount = value.match(CHINESE_CHARACTER_PATTERN)?.length ?? 0;
  if (chineseCount === 0) return true;

  return latinCount >= Math.max(4, Math.round(chineseCount * 0.25));
}
