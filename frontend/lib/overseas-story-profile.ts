import type { GenerationSettings, OverseasStoryProfile } from "./types";

export interface OverseasStoryProfileApi {
  schema_version: "overseas_story_profile.v1";
  country: string;
  region: string;
  social_context: string;
  story_engine: string;
}

/** Only an explicit opt-in creates a profile; legacy settings stay field-free. */
export function normalizeOverseasStoryProfile(value: unknown): OverseasStoryProfile | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  if (source.enabled !== true) return undefined;
  const text = (key: string, limit: number) => typeof source[key] === "string"
    ? (source[key] as string).slice(0, limit) : "";
  return {
    enabled: true,
    country: text("country", 80),
    region: text("region", 120),
    socialContext: text("socialContext", 800),
    storyEngine: text("storyEngine", 800),
  };
}

export function overseasStoryProfileForApi(
  settings: Pick<GenerationSettings, "releaseRegion" | "overseasStoryProfile">,
): OverseasStoryProfileApi | undefined {
  if (settings.releaseRegion !== "overseas") return undefined;
  const profile = normalizeOverseasStoryProfile(settings.overseasStoryProfile);
  return profile ? {
    schema_version: "overseas_story_profile.v1",
    country: profile.country.trim(),
    region: profile.region.trim(),
    social_context: profile.socialContext.trim(),
    story_engine: profile.storyEngine.trim(),
  } : undefined;
}

export function overseasStoryProfilePrompt(
  settings: Pick<GenerationSettings, "releaseRegion" | "overseasStoryProfile">,
): string {
  const profile = overseasStoryProfileForApi(settings);
  if (!profile) return "";
  const fields = [
    profile.country ? `国家：${profile.country}` : "国家：未指定，不推定具体国家",
    profile.region ? `地区：${profile.region}` : "",
    profile.social_context ? `社会环境：${profile.social_context}` : "",
    profile.story_engine ? `连续冲突来源：${profile.story_engine}` : "",
  ].filter(Boolean);
  return `作者选择的海外故事背景（沿用已确认事实，不能据此新增秘密或改写剧情）：\n${fields.join("\n")}`;
}

/** Reserve the authored profile before bounding large source documents. */
export function creativePromptWithOverseasProfile(
  prompt: string,
  settings: Pick<GenerationSettings, "releaseRegion" | "overseasStoryProfile">,
  limit: number,
): string {
  const profile = overseasStoryProfileForApi(settings);
  if (!profile) return prompt.slice(0, limit);
  const budget = Math.max(0, Math.floor(limit * 0.45) - 2);
  const header = [
    "作者选择的海外故事背景（沿用已确认事实）：",
    `国家：${profile.country || "未指定，不推定具体国家"}`,
    profile.region ? `地区：${profile.region}` : "",
  ].filter(Boolean).join("\n");
  const detailBudget = Math.max(0, Math.floor((budget - header.length - 22) / 2));
  const brief = [
    header,
    profile.social_context ? `社会环境：${profile.social_context.slice(0, detailBudget)}` : "",
    profile.story_engine ? `连续冲突来源：${profile.story_engine.slice(0, detailBudget)}` : "",
  ].filter(Boolean).join("\n").slice(0, budget);
  return `${brief}\n\n${prompt.slice(0, Math.max(0, limit - brief.length - 2))}`.slice(0, limit);
}

/** A cached ContentSpec must not retain a removed or changed country profile. */
export function overseasStoryProfileMatchesSignature(
  settings: Pick<GenerationSettings, "releaseRegion" | "overseasStoryProfile">,
  signature?: string,
): boolean {
  const profile = overseasStoryProfileForApi(settings);
  let previous: unknown;
  try { previous = signature ? JSON.parse(signature)?.generation?.overseasStoryProfile : undefined; }
  catch { return !profile; }
  return JSON.stringify(profile) === JSON.stringify(previous);
}
