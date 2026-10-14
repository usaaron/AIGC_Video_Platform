const TASK_DETAIL_STEPS = new Set(['script', 'assets', 'storyboard', 'generate', 'film', 'image-studio'])
const INDEPENDENT_WORKSPACE_STEPS = new Set(['writing-studio', 'agent-studio'])
const PROJECT_CONTENT_TYPES = new Set(['advertisement', 'animation', 'short-drama'])
const PROJECT_ASPECT_RATIOS = new Set(['9:16', '16:9', '1:1'])
const ASSET_KINDS = new Set(['character', 'scene', 'prop', 'costume', 'brand', 'audio'])
const TASK_KINDS = new Set(['text', 'image', 'video', 'audio'])
const TASK_STATUSES = new Set(['queued', 'paused', 'running', 'completed', 'failed', 'cancelled'])

const WORKFLOW_STEPS = ['script', 'assets', 'storyboard', 'generate', 'film']

/**
 * Project workflow navigation is intentionally derived from persisted output.
 * A sidebar click must not be able to skip the creative handoff simply because
 * a page can render an empty state. Existing pages remain reviewable once the
 * corresponding artifact exists, while future stages stay locked until their
 * prerequisite is present.
 */
export function workflowNavigationAccess(workspace) {
  const project = workspace?.project
  if (!project || typeof project !== 'object') {
    return Object.fromEntries(WORKFLOW_STEPS.map((step) => [step, false]))
  }

  const scriptEpisodes = Array.isArray(workspace?.scriptEpisodes) ? workspace.scriptEpisodes : []
  const assets = Array.isArray(workspace?.assets) ? workspace.assets : []
  const shots = Array.isArray(workspace?.shots) ? workspace.shots : []
  const projectScript = typeof project.script === 'string' && project.script.trim().length > 0
  const savedEpisodeScript = scriptEpisodes.some(
    (episode) =>
      episode?.status === 'saved' && typeof episode.content === 'string' && episode.content.trim().length > 0,
  )
  const script = projectScript || savedEpisodeScript
  const assetsReady = assets.length > 0
  const shotsReady = shots.length > 0

  return {
    script: true,
    // Existing assets and downstream artifacts remain reviewable after a
    // legacy import even if its original script projection is incomplete.
    assets: script || assetsReady || shotsReady,
    // Text storyboard design can start from the saved screenplay. Asset
    // records and their optional images remain available as references, while
    // image generation is never a prerequisite for writing shot descriptions.
    storyboard: script || shotsReady,
    generate: (script && assetsReady && shotsReady) || shotsReady,
    film: (script && assetsReady && shotsReady) || shotsReady,
  }
}

export function workflowNavigationBlockMessage(step, access = {}) {
  if (access[step] !== false) return ''
  if (step === 'assets') return '请先保存剧本，再进入资产设计。'
  if (step === 'storyboard') return '请先保存剧本，再进入分镜设计。'
  if (step === 'generate') return '请先完成资产设计并生成至少一个分镜。'
  if (step === 'film') return '请先完成资产设计并生成至少一个分镜。'
  return '请先完成前一步创作内容。'
}

export function workspacePollingOptions(activeStep, activeProjectId) {
  const includeRecentActivity = INDEPENDENT_WORKSPACE_STEPS.has(activeStep)
  return {
    projectId: activeStep === 'home' || includeRecentActivity ? null : activeProjectId || null,
    includeRecentActivity,
  }
}

export function isActiveWorkspaceProject(activeProjectId, projectId) {
  return Boolean(projectId) && activeProjectId === projectId
}

export function normalizeWorkspace(workspace) {
  if (!workspace || typeof workspace !== 'object') return null
  const project = workspace.project
  if (!project || typeof project !== 'object' || typeof project.id !== 'string' || !project.id) return null

  return {
    ...workspace,
    project: normalizeProject(project),
    scriptEpisodes: normalizeCollection(workspace.scriptEpisodes, normalizeEpisode),
    assets: normalizeCollection(workspace.assets, normalizeAsset),
    shots: normalizeCollection(workspace.shots, normalizeShot),
  }
}

export function shouldLoadTaskDetails(activeStep) {
  return TASK_DETAIL_STEPS.has(activeStep)
}

export function normalizeTasks(tasks) {
  return normalizeCollection(tasks, normalizeTask)
}

export function normalizeTaskPolling(tasks) {
  return normalizeCollection(tasks, (item) => {
    const task = normalizeTask(item)
    // Compact polling omits outputs. An omitted field must not clear loaded candidate images.
    if (task && !Array.isArray(item.outputs)) delete task.outputs
    return task
  })
}

function normalizeCollection(value, normalizeItem) {
  if (!Array.isArray(value)) return []
  return value.map(normalizeItem).filter(Boolean)
}

function normalizeProject(project) {
  return {
    ...project,
    name: stringValue(project.name, '未命名项目'),
    contentType: PROJECT_CONTENT_TYPES.has(project.contentType) ? project.contentType : 'animation',
    visualStyle: stringValue(project.visualStyle, 'cinematic-cg'),
    episodeDurationSeconds: integerInRange(project.episodeDurationSeconds, 60, 5, 300),
    aspectRatio: PROJECT_ASPECT_RATIOS.has(project.aspectRatio) ? project.aspectRatio : '16:9',
    status: stringValue(project.status, 'draft'),
    synopsis: stringValue(project.synopsis),
    script: stringValue(project.script),
    version: integerInRange(project.version, 1, 1, Number.MAX_SAFE_INTEGER),
  }
}

function normalizeEpisode(item) {
  if (!hasId(item)) return null
  return {
    ...item,
    id: item.id,
    episodeNumber: integerInRange(item.episodeNumber, 1, 1, Number.MAX_SAFE_INTEGER),
    title: stringValue(item.title, `第 ${item.episodeNumber || 1} 集`),
    content: stringValue(item.content),
    draftContent: stringValue(item.draftContent),
    status: item.status === 'saved' ? 'saved' : 'draft',
    summary: stringValue(item.summary),
    continuityState: recordValue(item.continuityState),
    revision: integerInRange(item.revision, 1, 1, Number.MAX_SAFE_INTEGER),
    updatedAt: stringValue(item.updatedAt),
  }
}

function normalizeAsset(item) {
  if (!hasId(item)) return null
  const kind = ASSET_KINDS.has(item.kind) ? item.kind : 'prop'
  return {
    ...item,
    id: item.id,
    kind,
    sourceMode: item.sourceMode === 'import' ? 'import' : 'generate',
    name: stringValue(item.name, '未命名资产'),
    description: stringValue(item.description),
    prompt: stringValue(item.prompt),
    customPrompt: stringValue(item.customPrompt),
    negativePrompt: stringValue(item.negativePrompt),
    references: normalizeReferences(item.references, item.id),
    attributes: normalizeAttributes(item.attributes, kind),
    imageUrl: nullableString(item.imageUrl),
    status: item.status === 'confirmed' ? 'confirmed' : 'draft',
  }
}

function normalizeShot(item, index) {
  if (!hasId(item)) return null
  const episodeNumber = integerInRange(item.episodeNumber, 1, 1, Number.MAX_SAFE_INTEGER)
  return {
    ...item,
    id: item.id,
    order: integerInRange(item.order, index + 1, 1, Number.MAX_SAFE_INTEGER),
    title: stringValue(item.title, `镜头 ${index + 1}`),
    framing: stringValue(item.framing, '中景'),
    duration: integerInRange(item.duration, 4, 3, 15),
    prompt: stringValue(item.prompt),
    negativePrompt: stringValue(item.negativePrompt),
    imageUrl: nullableString(item.imageUrl),
    selectedImageTaskId: nullableString(item.selectedImageTaskId),
    selectedVideoTaskId: nullableString(item.selectedVideoTaskId),
    continuityMode: item.continuityMode === 'independent' ? 'independent' : 'continue',
    continuityNote: stringValue(item.continuityNote),
    episodeBreakBefore: item.episodeBreakBefore === true,
    episodeNumber,
    episodeTitle: stringValue(item.episodeTitle, `第 ${episodeNumber} 集`),
    episodeKind: item.episodeKind === 'hook' ? 'hook' : 'standard',
  }
}

function normalizeTask(item) {
  if (!hasId(item)) return null
  const metadata = recordValue(item.metadata)
  return {
    ...item,
    id: item.id,
    projectId: stringValue(item.projectId),
    kind: TASK_KINDS.has(item.kind) ? item.kind : 'text',
    status: TASK_STATUSES.has(item.status) ? item.status : 'queued',
    label: stringValue(item.label, '生成任务'),
    progress: integerInRange(item.progress, 0, 0, 100),
    estimatedCredits: numberValue(item.estimatedCredits, 0),
    metadata: normalizeTaskMetadata(metadata),
    outputs: normalizeOutputs(item.outputs, item.id),
    resultUrl: nullableString(item.resultUrl),
    error: stringValue(item.error),
    createdAt: dateString(item.createdAt),
    updatedAt: dateString(item.updatedAt || item.createdAt),
  }
}

function normalizeTaskMetadata(metadata) {
  const next = { ...metadata }
  const textResult = metadata.textResult
  if (textResult && typeof textResult === 'object' && !Array.isArray(textResult)) {
    next.textResult = normalizeTextResult(textResult)
  }
  return next
}

function normalizeTextResult(result) {
  if (!Array.isArray(result.assets)) return result
  return {
    ...result,
    summary: stringValue(result.summary),
    warnings: Array.isArray(result.warnings)
      ? result.warnings.filter((item) => typeof item === 'string')
      : [],
    assets: result.assets.map(normalizeSuggestion).filter(Boolean),
  }
}

function normalizeSuggestion(item, index) {
  if (!item || typeof item !== 'object') return null
  const kind = ASSET_KINDS.has(item.kind) ? item.kind : 'prop'
  return {
    ...item,
    kind,
    name: stringValue(item.name, `未命名建议 ${index + 1}`),
    description: stringValue(item.description),
    prompt: stringValue(item.prompt),
    negativePrompt: stringValue(item.negativePrompt),
    reason: stringValue(item.reason),
    priority: numberValue(item.priority, 1),
    attributes: normalizeAttributes(item.attributes, kind),
    sourceFacts: recordValue(item.sourceFacts),
    references: normalizeReferences(item.references, `suggestion-${index + 1}`),
  }
}

function normalizeAttributes(value, kind) {
  const attributes = recordValue(value)
  const next = { ...attributes, type: kind }
  if (kind === 'character') {
    next.appearanceVariants = normalizeVariants(attributes.appearanceVariants)
    next.stagePrompts = recordValue(attributes.stagePrompts)
    next.faceReference = normalizeReference(attributes.faceReference, 'face-reference')
    next.bodyReference = normalizeReference(attributes.bodyReference, 'body-reference')
    next.trustedPortrait = recordValueOrNull(attributes.trustedPortrait)
  }
  return next
}

function normalizeVariants(value) {
  return normalizeCollection(value, (item) => {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !item.id) return null
    return {
      ...item,
      id: item.id,
      name: stringValue(item.name, '未命名造型'),
      bodyReference: normalizeReference(item.bodyReference, `${item.id}-body`),
      turnaroundReferences: normalizeReferences(item.turnaroundReferences, item.id).slice(0, 3),
    }
  })
}

function normalizeReferences(value, ownerId) {
  if (!Array.isArray(value)) return []
  return value
    .map((item, index) => normalizeReference(item, `${ownerId}-reference-${index + 1}`))
    .filter(Boolean)
}

function normalizeReference(value, fallbackId) {
  if (!value || typeof value !== 'object') return null
  const url = nullableString(value.url)
  if (!url) return null
  return {
    ...value,
    id: stringValue(value.id, fallbackId),
    url,
    name: stringValue(value.name, '参考图'),
  }
}

function normalizeOutputs(value, taskId) {
  if (!Array.isArray(value)) return []
  return value
    .map((item, index) => {
      if (!item || typeof item !== 'object') return null
      return {
        ...item,
        id: stringValue(item.id, `${taskId}-output-${index + 1}`),
        url: nullableString(item.url),
        mediaType: stringValue(item.mediaType),
        view: stringValue(item.view),
      }
    })
    .filter(Boolean)
}

function hasId(value) {
  return Boolean(value && typeof value === 'object' && typeof value.id === 'string' && value.id)
}

function recordValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function recordValueOrNull(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null
}

function stringValue(value, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

function nullableString(value) {
  return typeof value === 'string' && value ? value : null
}

function dateString(value) {
  if (typeof value !== 'string' || !value || !Number.isFinite(Date.parse(value))) return ''
  return value
}

function numberValue(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function integerInRange(value, fallback, minimum, maximum) {
  const number = Math.round(numberValue(value, fallback))
  return Math.min(maximum, Math.max(minimum, number))
}
