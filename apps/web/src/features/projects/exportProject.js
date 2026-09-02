export function exportProject(workspace, tasks) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify({ ...workspace, tasks, exportedAt: new Date().toISOString() }, null, 2)], {
      type: 'application/json',
    }),
  )
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${workspace.project.name}-项目包.json`
  anchor.click()
  URL.revokeObjectURL(url)
}
