export const FILM_EXPORT_RATIOS = ['9:16', '16:9', '1:1'] as const
export const FILM_EXPORT_RESOLUTIONS = ['720p', '1080p'] as const
export const FILM_EXPORT_FPS = [24, 30] as const

export type FilmExportRatio = (typeof FILM_EXPORT_RATIOS)[number]
export type FilmExportResolution = (typeof FILM_EXPORT_RESOLUTIONS)[number]
export type FilmExportTimelineEntry = {
  shotId: string
  taskId: string
  title: string
  duration: number
  subtitle: string
}
export type FilmExportOptions = {
  ratio: FilmExportRatio
  resolution: FilmExportResolution
  fps: number
  subtitlesEnabled: boolean
  coverShotId: string
  voiceoverText: string
  timeline: FilmExportTimelineEntry[]
}

export function normalizeFilmExportOptions(
  value: unknown,
  fallbackRatio: string = '16:9',
): FilmExportOptions {
  const record = isRecord(value) ? value : {}
  const ratio = ratioValue(record.ratio, fallbackRatio)
  const resolution = resolutionValue(record.resolution)
  const fps = fpsValue(record.fps)
  const subtitlesEnabled = record.subtitlesEnabled !== false
  const coverShotId = stringValue(record.coverShotId)
  const voiceoverText = stringValue(record.voiceoverText)

  return {
    ratio,
    resolution,
    fps,
    subtitlesEnabled,
    coverShotId,
    voiceoverText,
    timeline: timelineEntriesValue(record.timeline),
  }
}

export function frameSizeForFilmExport(
  ratio: FilmExportRatio,
  resolution: FilmExportResolution,
): { width: number; height: number } {
  const shortSide = resolution === '1080p' ? 1080 : 720
  if (ratio === '1:1') return { width: shortSide, height: shortSide }
  if (ratio === '16:9') return { width: Math.round((shortSide * 16) / 9), height: shortSide }
  return { width: shortSide, height: Math.round((shortSide * 16) / 9) }
}

function timelineEntriesValue(value: unknown): FilmExportTimelineEntry[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      if (!isRecord(item)) return null
      const shotId = stringValue(item.shotId)
      const taskId = stringValue(item.taskId)
      if (!shotId || !taskId) return null
      return {
        shotId,
        taskId,
        title: stringValue(item.title, shotId),
        duration: normalizeDuration(item.duration),
        subtitle: stringValue(item.subtitle, stringValue(item.title, shotId)),
      }
    })
    .filter((item): item is FilmExportTimelineEntry => Boolean(item))
}

function ratioValue(value: unknown, fallback: string): FilmExportRatio {
  if (value === '9:16' || value === '16:9' || value === '1:1') return value
  if (fallback === '9:16' || fallback === '16:9' || fallback === '1:1') return fallback
  return '16:9'
}

function resolutionValue(value: unknown): FilmExportResolution {
  return value === '1080p' ? '1080p' : '720p'
}

function fpsValue(value: unknown): number {
  return value === 30 ? 30 : 24
}

function normalizeDuration(value: unknown): number {
  const number = Number(value)
  if (!Number.isFinite(number)) return 4
  return Math.min(120, Math.max(1, Math.round(number)))
}

function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
