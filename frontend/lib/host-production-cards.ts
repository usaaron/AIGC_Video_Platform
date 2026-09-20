import type { QuickScriptPlan } from "./quick-script-types.ts";
import type { CharacterDraft } from "./types.ts";

/** Card facts are joined only after a scene explicitly declares the asset. */
export function productionCardFacts(
  kind: "character" | "scene" | "prop",
  name: string,
  characters: readonly CharacterDraft[],
  plan?: QuickScriptPlan | null,
): Record<string, string> {
  const facts: Record<string, string> = {};
  const put = (label: string, value: unknown) => {
    if (typeof value === "string" && value.trim()) facts[label] = value.trim();
  };
  if (kind === "character") {
    const profiles = characters.filter(item => item.name?.trim() === name);
    // Conflicting cards must be resolved by the author, never arbitrarily merged.
    for (const [field, label] of [["age", "年龄"], ["gender", "性别"], ["role", "角色身份"]] as const) {
      const values = new Set(profiles.map(item => item[field]?.trim()).filter(Boolean));
      if (values.size === 1) put(label, [...values][0]);
    }
    const approved = plan?.characters.filter(item => item.name.trim() === name);
    if (approved?.length === 1) put("身份", approved[0].fixed_identity);
    return facts;
  }
  const key = kind === "scene" ? locationKey(name) : name.trim();
  const cards = plan?.production_assets?.filter(item => item.kind === kind
    && (kind === "scene" ? locationKey(item.name) : item.name.trim()) === key);
  if (cards?.length !== 1) return facts;
  put("外观", cards[0].appearance);
  cards[0].fixed_details?.forEach((detail, index) => put(`固定细节${index + 1}`, detail));
  return facts;
}

function locationKey(value: string): string {
  return value.trim().replace(/^(?:INT\.|EXT\.)(?:\s*\/\s*(?:INT\.|EXT\.))?\s*/iu, "")
    .replace(/\s*[-—–]\s*(?:日|夜|早晨|清晨|凌晨|黎明|黄昏|傍晚|白天|晚上|DAY|NIGHT|DAWN|DUSK)\s*$/iu, "")
    .trim();
}
