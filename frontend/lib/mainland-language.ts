const CHINESE_CHARACTER_PATTERN = /[\u3400-\u9fff]/g;
const LATIN_CHARACTER_PATTERN = /[A-Za-z]/g;
const COMMON_ABBREVIATION_PATTERN = /(?<![A-Za-z])[A-Z]{1,4}(?:-?\d{1,4})?(?![A-Za-z])/g;

export function mainlandTextIsEnglishDominant(value: string | null | undefined): boolean {
  if (!value?.trim()) return false;

  const withoutCommonAbbreviations = value.replace(COMMON_ABBREVIATION_PATTERN, "");
  const latinCount = withoutCommonAbbreviations.match(LATIN_CHARACTER_PATTERN)?.length ?? 0;
  if (latinCount === 0) return false;

  const chineseCount = value.match(CHINESE_CHARACTER_PATTERN)?.length ?? 0;
  if (chineseCount === 0) return true;

  return latinCount >= Math.max(4, Math.round(chineseCount * 0.25));
}
