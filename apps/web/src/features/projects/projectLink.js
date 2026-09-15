export function projectLinkTarget(projects, search) {
  const params = new URLSearchParams(search)
  const project = projects.find((item) => item.id === params.get('projectId'))
  if (!project) return null
  const requestedView = params.get('view')
  return {
    project,
    view: ['script', 'assets', 'storyboard'].includes(requestedView) ? requestedView : 'overview',
  }
}
