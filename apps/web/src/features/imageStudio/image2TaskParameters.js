import { IMAGE2_ASPECT_RATIOS, IMAGE2_REFERENCE_ROLES } from '@seqora/contracts'

const IMAGE2_QUALITIES = new Set(['low', 'medium', 'high'])
const IMAGE2_ROLES = new Set(IMAGE2_REFERENCE_ROLES)

export function image2BatchInputFromTask(task, projectId) {
  const form = image2FormFromTask(task)
  const snapshot = generationSnapshotFromTask(task)
  const reuseFinalPrompt = snapshot?.finalized === true && Boolean(cleanText(snapshot.prompt))
  return {
    ...(reuseFinalPrompt && task?.id ? { sourceTaskId: task.id } : {}),
    projectId,
    prompt: form.prompt,
    ...(form.negativePrompt ? { negativePrompt: form.negativePrompt } : {}),
    aspectRatio: form.aspectRatio,
    quality: form.quality,
    imageCount: 1,
    assist: reuseFinalPrompt
      ? { promptOptimization: false, referenceVision: false }
      : form.assist,
    references: form.references.map((reference) => ({
      mediaId: reference.mediaId,
      role: reference.role,
      referenceNumber: reference.inputNumber,
    })),
  }
}

export function image2EditFormFromTask(task, subjectMedia) {
  const form = image2FormFromTask(task)
  const references = [
    {
      mediaId: subjectMedia.id,
      url: subjectMedia.url,
      role: 'subject',
      inputNumber: 1,
    },
  ]

  return {
    ...form,
    imageCount: 1,
    references,
    nextReferenceNumber: 2,
  }
}

export function image2FormFromTask(task) {
  const metadata = task?.metadata ?? {}
  const snapshot = generationSnapshotFromTask(task)
  const snapshotAssist = isRecord(snapshot?.assist) ? snapshot.assist : null
  const fallbackNegativePrompt =
    cleanText(metadata.userNegativePrompt) || cleanText(task?.negativePrompt)
  return {
    prompt: snapshot
      ? snapshotText(snapshot, 'prompt', cleanText(task?.prompt))
      : cleanText(metadata.originalPrompt) || cleanText(task?.prompt),
    negativePrompt: snapshot
      ? snapshotText(
          snapshot,
          'userNegativePrompt',
          snapshotText(snapshot, 'negativePrompt', fallbackNegativePrompt),
        )
      : fallbackNegativePrompt,
    aspectRatio: valueFromSnapshotOrMetadata(snapshot, 'aspectRatio', metadata.aspectRatio, 'auto'),
    quality: valueFromSnapshotOrMetadata(snapshot, 'quality', metadata.quality, 'low', IMAGE2_QUALITIES),
    assist: {
      promptOptimization: assistWasRequested(
        snapshotAssist?.promptOptimization ?? metadata.promptOptimization,
      ),
      referenceVision: assistWasRequested(snapshotAssist?.referenceVision ?? metadata.referenceVision),
    },
    references: taskReferences(Array.isArray(snapshot?.references) ? snapshot.references : metadata.references),
  }
}

function taskReferences(value) {
  if (!Array.isArray(value)) return []
  const references = []
  const mediaIds = new Set()
  const referenceNumbers = new Set()
  let hasSubject = false

  for (const [index, candidate] of value.entries()) {
    if (!candidate || typeof candidate !== 'object') continue
    const mediaId = cleanText(candidate.id)
    if (!mediaId || mediaIds.has(mediaId)) continue

    let inputNumber = positiveInteger(candidate.referenceNumber) || index + 1
    while (referenceNumbers.has(inputNumber)) inputNumber += 1

    let role = IMAGE2_ROLES.has(candidate.role) ? candidate.role : 'style'
    if (role === 'subject' && hasSubject) role = 'style'
    if (role === 'subject') hasSubject = true

    references.push({
      order: positiveInteger(candidate.order) || index + 1,
      reference: {
        mediaId,
        url: cleanText(candidate.url) || `/api/v1/media/${encodeURIComponent(mediaId)}`,
        role,
        inputNumber,
      },
    })
    mediaIds.add(mediaId)
    referenceNumbers.add(inputNumber)
  }

  return references
    .sort((left, right) => left.order - right.order)
    .map((entry) => entry.reference)
}

function assistWasRequested(value) {
  return value === true || Boolean(value && typeof value === 'object' && value.requested === true)
}

function generationSnapshotFromTask(task) {
  const snapshot = task?.metadata?.generationSnapshot
  return isRecord(snapshot) ? snapshot : null
}

function snapshotText(snapshot, key, fallback = '') {
  if (snapshot && Object.prototype.hasOwnProperty.call(snapshot, key) && typeof snapshot[key] === 'string') {
    return cleanText(snapshot[key])
  }
  return fallback
}

function valueFromSnapshotOrMetadata(snapshot, key, metadataValue, fallback, allowedValues = null) {
  const value = snapshot && Object.prototype.hasOwnProperty.call(snapshot, key) ? snapshot[key] : metadataValue
  return (!allowedValues || allowedValues.has(value)) && typeof value === 'string' ? value : fallback
}

function positiveInteger(value) {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : 0
}

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
