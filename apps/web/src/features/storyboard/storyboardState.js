import { normalizedVideoDuration } from '@seqora/prompting'

const taskIndexCache = new WeakMap()

export function taskFor(tasks, shot, kind) {
  const shotId = typeof shot === 'string' ? shot : shot.id
  const selectedTaskId =
    typeof shot === 'string' ? null : kind === 'image' ? shot.selectedImageTaskId : shot.selectedVideoTaskId
  const candidates = taskIndexFor(tasks).byShotKind.get(taskKey(kind, shotId)) || []
  return (
    candidates.find((task) => isActive(task) && typeof task.metadata?.queueHiddenAt !== 'string') ||
    candidates.find((task) => task.id === selectedTaskId && task.status === 'completed') ||
    candidates.find((task) => typeof task.metadata?.queueHiddenAt !== 'string') ||
    candidates.find((task) => task.status === 'completed') ||
    null
  )
}

export function taskById(tasks, taskId) {
  if (!taskId) return null
  return taskIndexFor(tasks).byId.get(taskId) || null
}

export function isActive(task) {
  return task?.status === 'queued' || task?.status === 'paused' || task?.status === 'running'
}

export function taskLabel(task, hasResult) {
  if (!task) return hasResult ? '已就绪' : '未生成'
  if (task.status === 'completed') return '已完成'
  if (task.status === 'failed') return '失败'
  if (task.status === 'paused') return '已暂停'
  if (task.status === 'running') return `${task.progress}%`
  return '排队中'
}

export function generationActionLabel(task, matchesAssets, kind, hasResult = false) {
  if (task?.status === 'running') return `${kind}生成中 ${task.progress}%`
  if (task?.status === 'queued') return `${kind}排队中`
  if (task?.status === 'paused') return `${kind}已暂停`
  if (task?.status === 'completed' && !matchesAssets) return `同步${kind}`
  if (task || hasResult) return `重新生成${kind}`
  return `生成${kind}`
}

export function videoResolutionForTask(task, resolutions) {
  return resolutions.some((option) => option.value === task?.metadata?.resolution)
    ? task.metadata.resolution
    : null
}

export function resolutionLabel(value, resolutions) {
  return resolutions.find((option) => option.value === value)?.label || '720P'
}

export function selectedVersionTaskId(tasks, shot, kind) {
  const storedId = kind === 'image' ? shot.selectedImageTaskId : shot.selectedVideoTaskId
  const candidates = taskIndexFor(tasks).byShotKind.get(taskKey(kind, shot.id)) || []
  if (storedId && candidates.some((task) => task.id === storedId && task.status === 'completed'))
    return storedId
  return candidates
    .filter((task) => task.status === 'completed')
    .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))[0]?.id
}

export function taskOutputUrl(task, kind) {
  if (!task) return null
  if (kind === 'video')
    return task.resultUrl || task.outputs?.find((output) => output.mediaType === 'video')?.url
  return task.resultUrl || task.outputs?.find((output) => output.mediaType === 'image')?.url
}

export async function addStoryboardVideosToArchive(zip, videos, fetchVideo = globalThis.fetch) {
  const results = await mapWithConcurrency(videos, 4, async ({ shot, url }) => {
    try {
      const response = await fetchVideo(url, { credentials: 'include', cache: 'force-cache' })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const episode = `第${String(shot.episodeNumber || 1).padStart(2, '0')}集`
      const name = `${String(shot.order).padStart(2, '0')}-${safeFileName(shot.title || '未命名镜头')}.mp4`
      zip.folder(episode)?.file(name, await response.blob())
      return { ok: true, shot }
    } catch (error) {
      return { ok: false, shot, message: error instanceof Error ? error.message : String(error) }
    }
  })
  const failures = results.filter((result) => !result.ok)
  const successCount = results.length - failures.length
  if (failures.length) {
    zip.file(
      '_下载失败清单.txt',
      [
        '以下分镜的已完成记录暂时无法读取源文件，可在分镜页重新生成后再次下载：',
        ...failures.map(
          ({ shot, message }) =>
            `第 ${shot.episodeNumber || 1} 集 · ${shot.title || `镜头 ${shot.order}`}：${message}`,
        ),
      ].join('\n'),
    )
  }
  return { successCount, failures }
}

export function groupShotsByEpisode(shots, minDuration = 4, scriptEpisodes = []) {
  const groups = new Map()
  for (const episode of scriptEpisodes) {
    if (episode.status !== 'saved' || !episode.content?.trim()) continue
    const key = String(episode.episodeNumber)
    groups.set(key, {
      number: episode.episodeNumber,
      title: episode.title || `第 ${episode.episodeNumber} 集`,
      scriptEpisodeId: episode.id,
      kind: 'standard',
      hasHook: false,
      duration: 0,
      shots: [],
    })
  }
  for (const shot of shots) {
    const number = shot.episodeNumber || 1
    const kind = shot.episodeKind || 'standard'
    const key = String(number)
    const current = groups.get(key) || {
      number,
      title: shot.episodeTitle || `第 ${number} 集`,
      scriptEpisodeId: shot.scriptEpisodeId || null,
      kind: 'standard',
      hasHook: false,
      duration: 0,
      shots: [],
    }
    current.shots.push(shot)
    current.scriptEpisodeId ||= shot.scriptEpisodeId || null
    current.duration += normalizedVideoDuration(shot.duration, minDuration)
    current.hasHook ||= kind === 'hook'
    current.kind = current.hasHook ? 'hook' : 'standard'
    groups.set(key, current)
  }
  return [...groups.values()].sort((left, right) => left.number - right.number)
}

export function episodeKey(episode) {
  return String(episode.number)
}

export function episodeKeyForShot(shot) {
  if (!shot) return ''
  return String(shot.episodeNumber || 1)
}

export function shotVersionPair(tasks, shot, kind) {
  const candidates = taskIndexFor(tasks).byShotKind.get(taskKey(kind, shot.id)) || []
  const completed = candidates
    .filter((task) => task.status === 'completed')
    .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))
  if (!completed.length) return []
  const selectedId = selectedVersionTaskId(tasks, shot, kind)
  const current = completed.find((task) => task.id === selectedId) || completed[0]
  const previous = completed.find((task) => task.id !== current.id)
  return [current, previous].filter(Boolean)
}

async function mapWithConcurrency(items, concurrency, operation) {
  const results = Array.from({ length: items.length })
  let nextIndex = 0
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await operation(items[index], index)
    }
  })
  await Promise.all(workers)
  return results
}

function safeFileName(value) {
  return [...String(value || '')]
    .map((character) => (character.charCodeAt(0) < 32 ? '-' : character))
    .join('')
    .replace(/[<>:"/\\|?*]/gu, '-')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 80)
}

function taskIndexFor(tasks) {
  if (!Array.isArray(tasks)) return { byId: new Map(), byShotKind: new Map() }
  const cached = taskIndexCache.get(tasks)
  if (cached) return cached
  const byId = new Map()
  const byShotKind = new Map()
  for (const task of tasks) {
    if (task?.id) byId.set(task.id, task)
    const shotId = task?.metadata?.shotId
    if (!task?.kind || !shotId) continue
    const key = taskKey(task.kind, shotId)
    const candidates = byShotKind.get(key) || []
    candidates.push(task)
    byShotKind.set(key, candidates)
  }
  const index = { byId, byShotKind }
  taskIndexCache.set(tasks, index)
  return index
}

function taskKey(kind, shotId) {
  return `${kind}:${shotId}`
}
