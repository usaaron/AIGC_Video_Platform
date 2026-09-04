const TASK_DETAIL_STEPS = new Set(['script', 'assets', 'storyboard', 'film', 'image-studio'])

export function workspacePollingProjectId(activeStep, workspace) {
  return activeStep === 'home' ? null : workspace?.project?.id || null
}

export function shouldLoadTaskDetails(activeStep) {
  return TASK_DETAIL_STEPS.has(activeStep)
}
