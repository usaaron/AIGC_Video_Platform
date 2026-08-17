export function normalizePlanningPunctuation(value: string): string {
  return value
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/。+\s*[；;]+/gu, "；")
    .replace(/[；;]+\s*。+/gu, "。")
    .replace(/。{2,}/gu, "。")
    .replace(/[；;]{2,}/gu, "；")
    .replace(/。+\s*[，,]+/gu, "，")
    .replace(/[，,]+\s*。+/gu, "。")
    .replace(/。+(?=为行动目标)/gu, "");
}

export function compactTopLevelSynopsis(value: string): string {
  const normalized = normalizePlanningPunctuation(value);
  if (normalized.length <= 240) return normalized;
  return `${normalized.slice(0, 239).replace(/[；，。,\s]+$/u, "")}。`;
}
