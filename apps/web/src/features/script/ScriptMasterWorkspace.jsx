import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, History, LoaderCircle, RefreshCw } from 'lucide-react'
import { subscribeScriptMasterMessages } from './scriptMasterMessages'

// Both applications are served by the host gateway; never embed a ticket on another origin.
const standaloneLaunch = {
  enabled: true,
  surface: 'standalone',
  module: 'standalone',
  project: null,
  launchUrl: '/script-master?surface=standalone&module=standalone',
}

// The embedded app owns its launch ticket. Loading this stable same-origin
// entry avoids a host launch request followed by the iframe's identical
// refresh request. The project id remains in the URL so the embedded session
// can request a ticket scoped to the current project.
function embeddedLaunch(projectId) {
  if (!projectId) throw new Error('请先进入一个主项目，再打开剧本大师。')
  const params = new URLSearchParams({
    surface: 'embedded',
    module: 'project-script',
    host_project_id: projectId,
  })
  return {
    enabled: true,
    surface: 'embedded',
    module: 'project-script',
    project: { id: projectId },
    launchUrl: `/script-master?${params.toString()}`,
  }
}

export function scriptMasterFrameUrl(launch, origin, scope) {
  if (!launch.enabled || !launch.launchUrl) throw new Error('剧本创作服务暂未配置，请联系管理员。')
  const url = new URL(launch.launchUrl, origin)
  if (
    url.origin !== origin ||
    url.username ||
    url.password ||
    !/^\/script-master(?:\/|$)/.test(url.pathname)
  ) {
    throw new Error('剧本创作需要配置为主站同源的 /script-master 服务。')
  }
  const urlProjectId = url.searchParams.get('host_project_id') || null
  const urlSurface = url.searchParams.get('surface') || null
  const urlModule = url.searchParams.get('module') || null
  const moduleSurface =
    urlModule === 'project-script' ? 'embedded' : urlModule === 'standalone' ? 'standalone' : null
  const launchModuleSurface =
    launch.module === 'project-script' ? 'embedded' : launch.module === 'standalone' ? 'standalone' : null
  const validSurface = (value) => value === null || value === 'embedded' || value === 'standalone'
  const validModule = (value) => value === null || value === 'project-script' || value === 'standalone'
  if (
    !validSurface(urlSurface) ||
    !validModule(urlModule) ||
    (urlSurface && moduleSurface && urlSurface !== moduleSurface) ||
    (launch.surface && launch.surface !== 'embedded' && launch.surface !== 'standalone') ||
    (launch.module && !launchModuleSurface) ||
    (launch.surface && urlSurface && launch.surface !== urlSurface) ||
    (launch.surface && moduleSurface && launch.surface !== moduleSurface) ||
    (launchModuleSurface && urlSurface && launchModuleSurface !== urlSurface) ||
    (launchModuleSurface && moduleSurface && launchModuleSurface !== moduleSurface)
  ) {
    throw new Error('剧本工作台入口与项目范围不一致，请重新连接。')
  }
  const launchProjectId = urlProjectId || launch.project?.id || null
  const actualSurface =
    launch.surface ??
    urlSurface ??
    moduleSurface ??
    launchModuleSurface ??
    (launchProjectId ? 'embedded' : 'standalone')
  if (
    (urlProjectId && launch.project?.id && urlProjectId !== launch.project.id) ||
    (actualSurface === 'standalone' && (urlProjectId || launch.project?.id)) ||
    (actualSurface === 'embedded' &&
      !launchProjectId &&
      (urlSurface || moduleSurface || launch.surface || launchModuleSurface))
  ) {
    throw new Error('剧本工作台入口与项目范围不一致，请重新连接。')
  }
  if (
    scope &&
    (actualSurface !== scope.surface ||
      urlProjectId !== (scope.projectId || null) ||
      (launch.project?.id && launch.project.id !== scope.projectId) ||
      (!scope.projectId && launch.project?.id))
  ) {
    throw new Error('剧本工作台入口与项目范围不一致，请重新连接。')
  }
  return url.href
}

export function standaloneScriptMasterFrameUrl(origin) {
  return scriptMasterFrameUrl(standaloneLaunch, origin, { surface: 'standalone', projectId: null })
}

export function embeddedScriptMasterFrameUrl(origin, projectId) {
  return scriptMasterFrameUrl(embeddedLaunch(projectId), origin, {
    surface: 'embedded',
    projectId,
  })
}

export function createHostNavigationMessage({ projectId, surface = 'embedded', view = 'script' }) {
  return {
    type: 'seqora:host:navigate',
    surface,
    projectId,
    view: view === 'storyboard' ? 'storyboard' : 'script',
  }
}

export function ScriptMasterWorkspace({
  projectId,
  surface = 'embedded',
  view = 'script',
  onSynced,
  onNavigate,
  onReturn,
  hidden = false,
}) {
  const frame = useRef(null)
  const callbacks = useRef({ onSynced, onNavigate, onReturn })
  callbacks.current = { onSynced, onNavigate, onReturn }
  const standalone = surface === 'standalone'
  const launchSurface = surface
  const boundProjectId = projectId
  const requestedView = view === 'storyboard' ? 'storyboard' : 'script'
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState({ url: '', status: 'loading', error: '' })

  useEffect(() => {
    let active = true
    setState({ url: '', status: 'loading', error: '' })
    // Both surfaces load a stable same-origin entry. The embedded app then
    // requests its project-scoped launch ticket once from its own session.
    const launchRequest = Promise.resolve().then(() =>
      launchSurface === 'standalone'
        ? standaloneScriptMasterFrameUrl(window.location.origin)
        : embeddedScriptMasterFrameUrl(window.location.origin, boundProjectId),
    )
    void launchRequest
      .then((launch) => {
        if (active) setState({ url: launch, status: 'loading', error: '' })
      })
      .catch((error) => {
        if (active)
          setState({ url: '', status: 'error', error: error?.message || '暂时无法连接剧本创作，请重试。' })
      })
    const timeout = window.setTimeout(() => {
      if (active)
        setState((current) =>
          current.status === 'loading'
            ? { url: '', status: 'error', error: '创作工作台连接较慢，请检查下方状态，或重新连接。' }
            : current,
        )
    }, 30_000)
    return () => {
      active = false
      window.clearTimeout(timeout)
    }
  }, [boundProjectId, attempt, launchSurface, surface])

  useEffect(() => {
    return subscribeScriptMasterMessages({
      hostWindow: window,
      projectId: boundProjectId,
      surface: launchSurface,
      getFrameWindow: () => frame.current?.contentWindow,
      onReady: () => {
        setState((current) => ({ ...current, status: 'ready', error: '' }))
      },
      onSynced: () => callbacks.current.onSynced?.(),
      onNavigate: (view) => callbacks.current.onNavigate?.(view),
      onReturn: () => callbacks.current.onReturn?.(),
      onError: (error) => setState((current) => ({ ...current, error })),
    })
  }, [boundProjectId, attempt, launchSurface])

  useEffect(() => {
    if (launchSurface !== 'embedded' || !boundProjectId || state.status !== 'ready') return
    frame.current?.contentWindow?.postMessage(
      createHostNavigationMessage({
        surface: launchSurface,
        projectId: boundProjectId,
        view: requestedView,
      }),
      window.location.origin,
    )
  }, [boundProjectId, launchSurface, requestedView, state.status])

  return (
    <section
      className="script-master-workspace"
      {...(hidden ? {} : { 'aria-label': standalone ? '剧本大师工作台' : '网剧创作工作台' })}
      data-surface={surface}
      hidden={hidden}
      aria-busy={state.status === 'loading'}
    >
      {state.status === 'loading' && (
        <div className="script-master-connection" role="status">
          <LoaderCircle size={22} className="spin" />
          <strong>{standalone ? '正在连接剧本大师…' : '正在恢复当前项目的创作…'}</strong>
          <span>写下故事想法，确认安排后生成剧本，完成后进入资产设计</span>
        </div>
      )}
      {state.error && (
        <div className="script-master-connection-error" role="alert">
          <span>{state.error}</span>
          <button className="button secondary" onClick={() => setAttempt((value) => value + 1)}>
            <RefreshCw size={16} />
            重新连接
          </button>
        </div>
      )}
      {state.url && (
        <iframe
          ref={frame}
          key={state.url + attempt + surface}
          title={standalone ? '剧本大师' : '网剧创作'}
          name={standalone ? 'seqora-script-master-standalone' : 'seqora-script-master-script'}
          src={state.url}
          referrerPolicy="no-referrer"
          className={state.status === 'loading' ? 'is-connecting' : ''}
        />
      )}
    </section>
  )
}

export function SeriesCreationWorkspace({
  projectId,
  episodeCount,
  view,
  activeView = 'script',
  onViewChange,
  busy,
  onOpenCreation,
  onSynced,
  onNavigate,
}) {
  return (
    <>
      <nav className="series-workspace-header" aria-label="剧本工作区">
        <div className="series-workspace-heading">
          <strong>{view === 'production' ? '已交付版本' : '剧本创作'}</strong>
          {view === 'production' && episodeCount > 0 && <small>{episodeCount} 集</small>}
        </div>
        <button
          type="button"
          className="series-workspace-secondary"
          disabled={busy}
          onClick={view === 'production' ? onOpenCreation : () => onViewChange('production')}
          title={view === 'production' ? '返回当前项目的剧本创作' : '查看用于资产与分镜制作的剧本版本'}
        >
          {view === 'production' ? <ArrowLeft size={14} /> : <History size={14} />}
          <span>{view === 'production' ? '返回剧本创作' : '已交付版本'}</span>
          {view !== 'production' && episodeCount > 0 && <small>{episodeCount} 集</small>}
        </button>
      </nav>
      <div
        className={view === 'creation' ? 'series-creation-pane' : 'series-creation-retained-pane'}
        hidden={view !== 'creation'}
      >
        <ScriptMasterWorkspace
          projectId={projectId}
          surface="embedded"
          view={activeView}
          hidden={view !== 'creation'}
          onSynced={onSynced}
          onNavigate={(view) => {
            if (view === 'script') onViewChange('production')
            else onNavigate?.(view)
          }}
        />
      </div>
      {view === 'production' && (
        <section className="series-delivery-note" aria-label="交付版本说明">
          {episodeCount === 0 && <strong>暂无已交付剧集</strong>}
          <p>
            {episodeCount === 0
              ? '在剧本创作中同步已保存的分集正文后，这里会保留用于资产与分镜制作的版本。'
              : '这些剧本供后续资产与分镜制作使用。'}
            此处编辑不会回写「剧本创作」。
          </p>
        </section>
      )}
    </>
  )
}
