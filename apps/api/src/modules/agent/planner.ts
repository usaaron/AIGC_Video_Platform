import {
  AGENT_CREDIT_COSTS,
  agentPlanSchema,
  type AgentContentType,
  type AgentPlan,
  type AgentPlanOverrides,
} from '@seqora/contracts'

const TYPE_PATTERNS: Array<[AgentContentType, RegExp]> = [
  ['advertisement', /(?:广告|宣传片|宣传视频|品牌片|产品片)/i],
  ['web-series', /(?:网剧|短剧|微短剧|连续剧)/i],
  ['short-film', /(?:短片|微电影|故事片)/i],
]

const STYLE_PATTERNS: Array<[NonNullable<AgentPlan['visualStyle']>, RegExp]> = [
  ['photorealistic', /(?:仿真人|真人感|写实|照片级)/i],
  ['cinematic-cg', /(?:电影\s*cg|影视\s*cg|cg风|cg质感|\bcg\b)/i],
  ['chinese-3d', /(?:国风3d|国风三维|中式3d|修仙3d)/i],
  ['chinese-2d', /(?:国风2d|国风二维|中式2d|水墨)/i],
  ['anime', /(?:动漫|动画番剧|日漫|二次元)/i],
  ['storybook', /(?:绘本|童话插画|故事书)/i],
]

export function createAgentPlan(
  prompt: string,
  previous: AgentPlan | null = null,
  overrides: AgentPlanOverrides = {},
): AgentPlan {
  const source = prompt.trim()
  const contentType = overrides.contentType ?? detectContentType(source) ?? previous?.contentType ?? null
  const durationSeconds =
    overrides.durationSeconds ?? detectDurationSeconds(source) ?? previous?.durationSeconds ?? null
  const aspectRatio = overrides.aspectRatio ?? detectAspectRatio(source) ?? previous?.aspectRatio ?? null
  const visualStyle = overrides.visualStyle ?? detectVisualStyle(source) ?? previous?.visualStyle ?? null
  const storyBrief = overrides.storyBrief ?? mergeStoryBrief(previous?.storyBrief ?? '', source)
  const projectName =
    overrides.projectName ?? previous?.projectName ?? deriveProjectName(storyBrief || source)
  const episodeDurationSeconds = resolveEpisodeDuration(
    contentType,
    durationSeconds,
    overrides.episodeDurationSeconds ?? previous?.episodeDurationSeconds ?? null,
  )
  const episodeCount =
    durationSeconds && episodeDurationSeconds ? Math.ceil(durationSeconds / episodeDurationSeconds) : null
  const missingFields: AgentPlan['missingFields'] = []
  if (storyBrief.length < 2) missingFields.push('storyBrief')
  if (!contentType) missingFields.push('contentType')
  if (!durationSeconds) missingFields.push('durationSeconds')
  if (!aspectRatio) missingFields.push('aspectRatio')
  if (!visualStyle) missingFields.push('visualStyle')

  return agentPlanSchema.parse({
    contentType,
    durationSeconds,
    episodeDurationSeconds,
    episodeCount,
    aspectRatio,
    visualStyle,
    storyBrief,
    projectName,
    missingFields,
    estimate:
      contentType && durationSeconds && aspectRatio && visualStyle
        ? estimateAgentRun(
            contentType,
            durationSeconds,
            episodeDurationSeconds ?? durationSeconds,
            visualStyle,
          )
        : null,
  })
}

export function estimateAgentRun(
  contentType: AgentContentType,
  durationSeconds: number,
  episodeDurationSeconds: number,
  visualStyle: NonNullable<AgentPlan['visualStyle']>,
): NonNullable<AgentPlan['estimate']> {
  const averageShotSeconds = contentType === 'web-series' ? 4 : contentType === 'advertisement' ? 5 : 6
  const estimatedShots = Math.min(120, Math.max(3, Math.ceil(durationSeconds / averageShotSeconds)))
  const estimatedAssets = contentType === 'advertisement' ? 3 : 4
  const characterCount = contentType === 'advertisement' ? 1 : 2
  const scriptCredits = AGENT_CREDIT_COSTS.script + AGENT_CREDIT_COSTS.assetAnalysis
  const assetCredits =
    characterCount * AGENT_CREDIT_COSTS.characterFace +
    (estimatedAssets - characterCount) * AGENT_CREDIT_COSTS.assetImage +
    (visualStyle === 'photorealistic' ? characterCount * AGENT_CREDIT_COSTS.trustedPortrait : 0)
  const videoCredits = estimatedShots * AGENT_CREDIT_COSTS.videoShot
  const estimatedEpisodes = Math.max(1, Math.ceil(durationSeconds / episodeDurationSeconds))

  return {
    scriptCredits,
    assetCredits,
    videoCredits,
    totalCredits: scriptCredits + assetCredits + videoCredits,
    estimatedShots,
    estimatedAssets,
    estimatedEpisodes,
    minMinutes: Math.max(6, estimatedShots * 2),
    maxMinutes: Math.max(15, estimatedShots * 6),
  }
}

function detectContentType(source: string): AgentContentType | null {
  return TYPE_PATTERNS.find(([, pattern]) => pattern.test(source))?.[0] ?? null
}

function detectDurationSeconds(source: string): number | null {
  const minutes = source.match(/(\d+(?:\.\d+)?)\s*(?:分钟|分(?:钟)?)(?!镜)/i)
  if (minutes) return validDuration(Math.round(Number(minutes[1]) * 60))
  const seconds = source.match(/(\d+)\s*(?:秒|s(?:ec(?:ond)?s?)?)(?![a-z])/i)
  if (seconds) return validDuration(Number(seconds[1]))
  return null
}

function detectAspectRatio(source: string): AgentPlan['aspectRatio'] {
  if (/(?:9\s*[:：比x×]\s*16|竖屏|竖版)/i.test(source)) return '9:16'
  if (/(?:16\s*[:：比x×]\s*9|横屏|横版)/i.test(source)) return '16:9'
  if (/(?:1\s*[:：比x×]\s*1|方形|正方形)/i.test(source)) return '1:1'
  return null
}

function detectVisualStyle(source: string): AgentPlan['visualStyle'] {
  return STYLE_PATTERNS.find(([, pattern]) => pattern.test(source))?.[0] ?? null
}

function resolveEpisodeDuration(
  contentType: AgentContentType | null,
  durationSeconds: number | null,
  requested: number | null,
): number | null {
  if (!contentType || !durationSeconds) return requested
  if (contentType === 'web-series') return Math.min(durationSeconds, requested ?? 60, 300)
  return Math.min(durationSeconds, 300)
}

function mergeStoryBrief(previous: string, source: string): string {
  if (!previous) return source
  if (!source || previous.includes(source)) return previous
  return `${previous}\n${source}`.slice(0, 20_000)
}

function deriveProjectName(source: string): string {
  const explicitSubject = source.match(/(?:主题(?:是|为)|关于|讲述)\s*[“”"']?([^，。！？；,\n]{2,40})/i)?.[1]
  if (explicitSubject) {
    const subjectName = explicitSubject.replace(/[“”"'：:\s]+$/g, '').trim()
    if (subjectName) return subjectName.slice(0, 24)
  }

  const cleaned = source
    .replace(/(?:请|帮我|给我)?(?:做|制作|生成|创作)(?:一支|一个|一部|个)?/g, '')
    .replace(/\d+(?:\.\d+)?\s*(?:分钟|分|秒)/g, '')
    .replace(/(?:9\s*[:：]\s*16|16\s*[:：]\s*9|1\s*[:：]\s*1|竖屏|横屏)/gi, '')
    .replace(/[，。！？；、,.!?;：:\s]+/g, ' ')
    .trim()
  return (cleaned.split(' ')[0] || '一句成片项目').slice(0, 24)
}

function validDuration(value: number): number | null {
  return Number.isFinite(value) && value >= 5 && value <= 300 ? value : null
}
