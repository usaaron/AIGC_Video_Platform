import {
  MAX_TARGET_TOTAL_CHARACTERS,
  MIN_TARGET_TOTAL_CHARACTERS,
  targetBodyScaleBand,
} from "./generation-planning.ts";
import type { SeriesTextMetrics } from "./script-metrics.ts";
import { calculateDraftTextMetrics } from "./script-metrics.ts";
import { draftMetadata } from "./draft-metadata.ts";
import type { GeneratedDraft } from "./types.ts";

export interface SeriesScaleStatus {
  allEpisodesSaved: boolean;
  actualCharacters: number;
  targetCharacters: number;
  remainingCharacters: number;
  referenceReached: boolean;
  rangeMinimum: number | null;
  rangeMaximum: number | null;
  remainingToRangeMinimum: number;
  status: "below_range" | "below_reference" | "reference_reached" | "target_unset";
}

/** Episode coverage does not establish that the requested body scale was reached. */
export function assessSeriesScale(
  metrics: Pick<SeriesTextMetrics, "scriptBodyCharacters" | "targetCharacters">,
  allEpisodesSaved: boolean,
): SeriesScaleStatus {
  const actualCharacters = Math.max(0, Math.round(metrics.scriptBodyCharacters));
  const targetCharacters = Math.max(0, Math.round(metrics.targetCharacters));
  const band = targetCharacters >= MIN_TARGET_TOTAL_CHARACTERS
    && targetCharacters <= MAX_TARGET_TOTAL_CHARACTERS
    ? targetBodyScaleBand(targetCharacters)
    : null;
  const remainingCharacters = Math.max(0, targetCharacters - actualCharacters);
  const remainingToRangeMinimum = band
    ? Math.max(0, band.minCharacters - actualCharacters)
    : 0;
  const referenceReached = targetCharacters > 0 && remainingCharacters === 0;
  return {
    allEpisodesSaved,
    actualCharacters,
    targetCharacters,
    remainingCharacters,
    referenceReached,
    rangeMinimum: band?.minCharacters ?? null,
    rangeMaximum: band?.maxCharacters ?? null,
    remainingToRangeMinimum,
    status: targetCharacters === 0 ? "target_unset"
      : remainingToRangeMinimum > 0 ? "below_range"
        : referenceReached ? "reference_reached" : "below_reference",
  };
}

/** Shared by the saved-body view and export so a work draft stays exportable. */
export function formatSeriesScaleStatus(
  metrics: Pick<SeriesTextMetrics, "scriptBodyCharacters" | "targetCharacters" | "generatedEpisodes" | "plannedEpisodes">,
  allEpisodesSaved: boolean,
  locale: string,
): string {
  const result = assessSeriesScale(metrics, allEpisodesSaved);
  const chinese = locale.startsWith("zh");
  const number = new Intl.NumberFormat(chinese ? "zh-CN" : "en-US");
  const format = (value: number) => number.format(value);
  const episodes = allEpisodesSaved
    ? chinese ? `${format(metrics.plannedEpisodes)} 集已保存。` : `All ${format(metrics.plannedEpisodes)} episodes are saved. `
    : chinese ? `已统计 ${format(metrics.generatedEpisodes)}/${format(metrics.plannedEpisodes)} 集。` : `${format(metrics.generatedEpisodes)}/${format(metrics.plannedEpisodes)} episodes counted. `;
  const actual = chinese
    ? `有效正文 ${format(result.actualCharacters)} 字`
    : `Effective body length: ${format(result.actualCharacters)} characters`;
  const target = result.status === "target_unset"
    ? chinese ? "；未设置正文参考规模。" : "; no body-scale target is set."
    : result.referenceReached
      ? chinese ? `，已达到 ${format(result.targetCharacters)} 字参考值。` : `; the ${format(result.targetCharacters)}-character reference is reached.`
      : chinese
        ? `，距 ${format(result.targetCharacters)} 字参考值还差 ${format(result.remainingCharacters)} 字。`
        : `; ${format(result.remainingCharacters)} characters below the ${format(result.targetCharacters)}-character reference.`;
  const range = result.status === "below_range"
    ? chinese
      ? `低于所选 ${format(result.rangeMinimum!)}–${format(result.rangeMaximum!)} 字范围下沿，还差 ${format(result.remainingToRangeMinimum)} 字。`
      : ` Below the selected ${format(result.rangeMinimum!)}–${format(result.rangeMaximum!)} range by ${format(result.remainingToRangeMinimum)} characters.`
    : result.status === "below_reference" && result.rangeMinimum !== null
      ? chinese ? "已进入所选参考范围。" : " Within the selected reference range."
      : "";
  const exportNote = allEpisodesSaved && !result.referenceReached
    ? chinese ? "可导出当前工作稿。" : " The current work draft can be exported."
    : "";
  return episodes + actual + target + range + exportNote;
}

/** Surface a sustained shortfall while the author can still adjust future work. */
export function formatSeriesScaleProjection(
  metrics: Pick<SeriesTextMetrics, "scriptBodyCharacters" | "targetCharacters" | "generatedEpisodes" | "plannedEpisodes">,
  locale: string,
): string | null {
  if (metrics.generatedEpisodes < 3 || metrics.generatedEpisodes >= metrics.plannedEpisodes
      || metrics.targetCharacters < MIN_TARGET_TOTAL_CHARACTERS
      || metrics.targetCharacters > MAX_TARGET_TOTAL_CHARACTERS) return null;
  const minimum = targetBodyScaleBand(metrics.targetCharacters).minCharacters;
  const projected = Math.round(metrics.scriptBodyCharacters / metrics.generatedEpisodes * metrics.plannedEpisodes);
  if (projected >= minimum) return null;
  const format = new Intl.NumberFormat(locale.startsWith("zh") ? "zh-CN" : "en-US").format;
  const required = Math.ceil(Math.max(0, minimum - metrics.scriptBodyCharacters)
    / (metrics.plannedEpisodes - metrics.generatedEpisodes));
  return locale.startsWith("zh")
    ? `正文规模偏低：按已写 ${format(metrics.generatedEpisodes)} 集估算，全剧约 ${format(projected)} 有效字，低于所选范围下沿 ${format(minimum)} 字。余下各集平均需 ${format(required)} 有效字才能进入范围；请检查后续规划是否有足够的动作、交锋和后果可展开，避免把缺口留到结尾。`
    : `Body scale is running low: the ${format(metrics.generatedEpisodes)} written episodes project to ${format(projected)} effective characters, below the selected minimum of ${format(minimum)}. Remaining episodes need an average of ${format(required)} effective characters to reach that range. Check that the remaining plans support enough enacted action, interaction and consequences before the finale.`;
}

export function formatEpisodeBodyScaleWarning(draft: GeneratedDraft, locale: string): string | null {
  const metadata = draftMetadata(draft);
  if (metadata.script_body_scale_policy !== "effective_body_80_120_v1") return null;
  const minimum = metadata.script_body_preferred_min_characters;
  if (typeof minimum !== "number" || !Number.isFinite(minimum) || minimum <= 0) return null;
  // Recount the displayed body so a saved warning cannot overrule later edits.
  const actual = calculateDraftTextMetrics(draft).scriptBodyCharacters;
  if (actual >= minimum) return null;
  const format = new Intl.NumberFormat(locale.startsWith("zh") ? "zh-CN" : "en-US").format;
  return locale.startsWith("zh")
    ? `本集正文展开不足：当前 ${format(actual)} 有效字，参考下沿 ${format(minimum)} 字，还差 ${format(minimum - actual)} 字。当前稿已保留，篇幅要求尚未通过；请检查批准场景中尚未充分演出的行动、交锋和后果。`
    : `This episode is underdeveloped: ${format(actual)} effective characters against a minimum reference of ${format(minimum)}, a shortfall of ${format(minimum - actual)}. The draft is retained, but the body-scale requirement is not met. Check for action, interaction and consequences in the approved scenes that have not been fully enacted.`;
}
