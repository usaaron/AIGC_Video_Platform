const TASK_DETAIL_STEPS = new Set(['script', 'assets', 'storyboard', 'film', 'image-studio'])

export function workspacePollingProjectId(activeStep, workspace) {
  return activeStep === 'home' ? null : workspace?.project?.id || null
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
    project,
    scriptEpisodes: normalizeCollection(workspace.scriptEpisodes),
    assets: normalizeCollection(workspace.assets),
    shots: normalizeCollection(workspace.shots),
  }
}

export function shouldLoadTaskDetails(activeStep) {
  return TASK_DETAIL_STEPS.has(activeStep)
}

function normalizeCollection(value) {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === 'object') : []
}
