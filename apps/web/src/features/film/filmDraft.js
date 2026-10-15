export const FILM_RATIOS = ['9:16', '16:9', '1:1']
export const FILM_RESOLUTIONS = ['720p', '1080p']
export const FILM_FPS = [24, 30]

export function createFilmDraft(project, shots = [], tasks = []) {
  const sequence = shots.map((shot) => shot.id)
  const firstAudioTask = completedAudioTasks(tasks)[0]
  return {
    sequence,
    clips: clipsForShots(shots),
    coverShotId: sequence[0] || '',
    ratio: FILM_RATIOS.includes(project?.aspectRatio) ? project.aspectRatio : '9:16',
    resolution: '720p',
    fps: 24,
    subtitlesEnabled: true,
    bgmTaskId: firstAudioTask?.id || '',
    voiceoverText: '',
  }
}

export function syncFilmDraft(draft, project, shots = [], tasks = []) {
  const current = draft || createFilmDraft(project, shots, tasks)
  const shotIds = shots.map((shot) => shot.id)
  const nextSequence = uniqueSequence(current.sequence, shotIds)
  const nextClips = clipsForShots(shots, current.clips)
  const audioIds = new Set(completedAudioTasks(tasks).map((task) => task.id))

  return {
    ...current,
    sequence: nextSequence,
    clips: nextClips,
    coverShotId: shotIds.includes(current.coverShotId) ? current.coverShotId : nextSequence[0] || '',
    ratio: FILM_RATIOS.includes(current.ratio) ? current.ratio : project?.aspectRatio || '9:16',
    resolution: FILM_RESOLUTIONS.includes(current.resolution) ? current.resolution : '720p',
    fps: FILM_FPS.includes(Number(current.fps)) ? Number(current.fps) : 24,
    bgmTaskId: audioIds.has(current.bgmTaskId) ? current.bgmTaskId : '',
  }
}

export function moveFilmClip(sequence, index, direction) {
  const nextIndex = index + direction
  if (nextIndex < 0 || nextIndex >= sequence.length) return sequence
  const next = [...sequence]
  const current = next[index]
  next[index] = next[nextIndex]
  next[nextIndex] = current
  return next
}

export function replaceFilmClip(sequence, index, nextShotId) {
  if (!nextShotId || !sequence[index]) return sequence
  const existingIndex = sequence.indexOf(nextShotId)
  const next = [...sequence]
  if (existingIndex !== -1 && existingIndex !== index) {
    next[existingIndex] = next[index]
  }
  next[index] = nextShotId
  return next
}

export function updateFilmClip(draft, shotId, input) {
  const current = draft.clips[shotId] || {}
  return {
    ...draft,
    clips: {
      ...draft.clips,
      [shotId]: {
        ...current,
        ...input,
        duration: normalizeDuration(input.duration ?? current.duration),
      },
    },
  }
}

export function orderedFilmShots(shots = [], sequence = []) {
  const shotsById = new Map(shots.map((shot) => [shot.id, shot]))
  return sequence.map((shotId) => shotsById.get(shotId)).filter(Boolean)
}

export function filmExportDraftForTask(draft, shots = [], tasks = []) {
  const shotsById = new Map(shots.map((shot) => [shot.id, shot]))
  const timeline = draft.sequence
    .map((shotId) => {
      const shot = shotsById.get(shotId)
      const task = shot ? completedVideoTaskForShot(tasks, shot.id) : null
      if (!shot || !task) return null
      const clip = draft.clips[shot.id] || {}
      return {
        shotId: shot.id,
        taskId: task.id,
        title: shot.title,
        duration: normalizeDuration(clip.duration ?? shot.duration),
        subtitle: String(clip.subtitle ?? shot.title).trim(),
      }
    })
    .filter(Boolean)

  return {
    timeline,
    sourceTaskIds: timeline.map((item) => item.taskId),
    audioTaskIds: draft.bgmTaskId ? [draft.bgmTaskId] : [],
    exportOptions: {
      ratio: draft.ratio,
      resolution: draft.resolution,
      fps: Number(draft.fps) || 24,
      coverShotId: draft.coverShotId || timeline[0]?.shotId || '',
      subtitlesEnabled: draft.subtitlesEnabled,
      voiceoverText: String(draft.voiceoverText || '').trim(),
      audioMode: draft.bgmTaskId ? 'selected' : 'silent',
      timeline,
    },
  }
}

export function completedAudioTasks(tasks = []) {
  return tasks.filter(
    (task) =>
      task.kind === 'audio' &&
      task.status === 'completed' &&
      task.outputs?.some((output) => output.mediaType === 'audio'),
  )
}

function clipsForShots(shots, existing = {}) {
  return Object.fromEntries(
    shots.map((shot) => [
      shot.id,
      {
        duration: normalizeDuration(existing[shot.id]?.duration ?? shot.duration),
        subtitle: String(existing[shot.id]?.subtitle ?? shot.title).slice(0, 140),
      },
    ]),
  )
}

function uniqueSequence(sequence = [], shotIds = []) {
  const known = new Set(shotIds)
  const next = sequence.filter((shotId, index) => known.has(shotId) && sequence.indexOf(shotId) === index)
  for (const shotId of shotIds) {
    if (!next.includes(shotId)) next.push(shotId)
  }
  return next
}

function completedVideoTaskForShot(tasks, shotId) {
  return (
    tasks.find(
      (task) =>
        task.kind === 'video' &&
        task.status === 'completed' &&
        task.metadata?.shotId === shotId &&
        task.outputs?.some((output) => output.mediaType === 'video'),
    ) || null
  )
}

function normalizeDuration(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return 4
  return Math.min(120, Math.max(1, Math.round(number)))
}
