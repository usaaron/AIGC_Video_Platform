import { z } from 'zod'

export const EPISODE_INPUT_LIMIT = 2_200
export const episodePlanSchema = z
  .object({
    id: z.string().uuid(),
    episodes: z
      .array(
        z.object({
          title: z.string().trim().min(1).max(120),
          source: z.string().trim().min(1).max(10_000),
        }),
      )
      .min(2)
      .max(100),
  })
  .refine(
    (plan) => plan.episodes.reduce((size, episode) => size + episode.source.length, 0) <= 100_000,
    '分集素材总量不能超过 10 万字',
  )

export type EpisodePlan = z.infer<typeof episodePlanSchema>

/** A free, editable estimate. Only explicit boundaries and visible narrative beats are counted. */
export function suggestEpisodePlan(source: string, seconds = 60, requestedCount?: number) {
  const text = source.trim()
  const length = text.replace(/\s/gu, '').length
  const episodeStarts = [
    ...text.matchAll(/^(?:\s*#{1,3}\s*)?第\s*[零〇一二三四五六七八九十百\d]+\s*集[^\n]*$/gmu),
  ]
  const sceneStarts = [...text.matchAll(/^\s*场次\s*[：:]/gmu)]
  const beats = (text.match(/(?:随后|次日|翌日|几天后|与此同时|另一边|多年后|第二天)/gu) || []).length
  const scenesPerEpisode = Math.max(2, Math.ceil(seconds / 20))
  const crowded = sceneStarts.length >= scenesPerEpisode * 2 || (length > 600 && beats >= 4)
  const suggested = Math.max(
    2,
    episodeStarts.length,
    Math.ceil(length / 1_800),
    crowded ? Math.ceil(Math.max(sceneStarts.length / scenesPerEpisode, beats / 3)) : 1,
  )
  const count = Math.min(100, Math.max(2, Math.round(requestedCount || suggested)))
  const required = length > EPISODE_INPUT_LIMIT || episodeStarts.length > 1 || crowded
  const reason =
    length > EPISODE_INPUT_LIMIT
      ? `素材共 ${length} 字，超过单集素材 2200 字`
      : episodeStarts.length > 1
        ? '素材包含多个明确的剧集标题'
        : '素材包含多组场次或时间、地点转折，建议分集承载'
  // ponytail: boundary-based estimate; users confirm/edit before paid adaptation. Semantic planning can replace this later.
  let pieces: string[]
  if (!requestedCount && episodeStarts.length > 1 && count === episodeStarts.length) {
    const starts = [0, ...episodeStarts.slice(1).map((match) => match.index!)]
    pieces = starts.map((start, index) => text.slice(start, starts[index + 1]).trim())
  } else {
    const boundaries = [...text.matchAll(/[。！？!?；;]\s*|\n+/gu)].map(
      (match) => match.index! + match[0].length,
    )
    pieces = []
    let start = 0
    for (let index = 1; index < count; index += 1) {
      const target = Math.round((text.length * index) / count)
      const nearby = boundaries.filter(
        (end) => end > start && end < text.length && Math.abs(end - target) < text.length / count / 3,
      )
      const end = nearby.sort((a, b) => Math.abs(a - target) - Math.abs(b - target))[0] ?? target
      if (end > start) pieces.push(text.slice(start, end).trim())
      start = end
    }
    pieces.push(text.slice(start).trim())
  }
  return {
    required,
    reason,
    characterCount: length,
    episodes: pieces.filter(Boolean).map((source, index) => ({ title: `第 ${index + 1} 集`, source })),
  }
}
