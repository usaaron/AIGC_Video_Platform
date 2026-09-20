export function subscribeScriptMasterMessages({
  hostWindow,
  projectId,
  getFrameWindow,
  onReady,
  onSynced,
  onNavigate,
  onError,
}) {
  let active = true

  async function receive(event) {
    const source = getFrameWindow()
    if (!active || event.origin !== hostWindow.location.origin || !source || event.source !== source) return
    const message = event.data
    if (!message || message.projectId !== (projectId ?? null)) return
    if (message.type === 'seqora:script-master:ready') {
      onReady()
    } else if (message.type === 'seqora:script-master:synced') {
      try {
        await onSynced?.()
        if (active && getFrameWindow() === source && ['assets', 'storyboard'].includes(message.view))
          onNavigate?.(message.view)
      } catch {
        if (active && getFrameWindow() === source) onError('内容已同步，但制作稿暂未刷新；请重新打开制作稿。')
      }
    } else if (
      message.type === 'seqora:script-master:navigate' &&
      ['script', 'assets', 'storyboard'].includes(message.view)
    ) {
      onNavigate?.(message.view)
    }
  }

  hostWindow.addEventListener('message', receive)
  return () => {
    active = false
    hostWindow.removeEventListener('message', receive)
  }
}
