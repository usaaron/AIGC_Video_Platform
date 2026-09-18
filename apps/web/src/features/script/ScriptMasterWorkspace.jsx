import { useEffect, useRef, useState } from 'react'
import { LoaderCircle, RefreshCw } from 'lucide-react'
import { api } from '../../services/apiClient'

// Both applications are served by the host gateway; never embed a ticket on another origin.
export function scriptMasterFrameUrl(launch, origin) {
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
  return url.href
}

export function ScriptMasterWorkspace({ projectId, onSynced, onNavigate }) {
  const frame = useRef(null)
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState({ url: '', status: 'loading', error: '' })

  useEffect(() => {
    let active = true
    setState({ url: '', status: 'loading', error: '' })
    void api
      .scriptMasterLaunch(projectId)
      .then((launch) => {
        const url = scriptMasterFrameUrl(launch, window.location.origin)
        if (active) setState({ url, status: 'loading', error: '' })
      })
      .catch((error) => {
        if (active)
          setState({ url: '', status: 'error', error: error?.message || '暂时无法连接剧本创作，请重试。' })
      })
    const timeout = window.setTimeout(() => {
      if (active)
        setState((current) =>
          current.status === 'loading'
            ? { ...current, status: 'error', error: '创作工作台连接较慢，请检查下方状态，或重新连接。' }
            : current,
        )
    }, 30_000)
    return () => {
      active = false
      window.clearTimeout(timeout)
    }
  }, [projectId, attempt])

  useEffect(() => {
    function receive(event) {
      if (
        event.origin !== window.location.origin ||
        !frame.current ||
        event.source !== frame.current.contentWindow
      )
        return
      const message = event.data
      if (!message || message.projectId !== (projectId ?? null)) return
      if (message.type === 'seqora:script-master:ready') {
        setState((current) => ({ ...current, status: 'ready', error: '' }))
      } else if (message.type === 'seqora:script-master:synced') {
        void Promise.resolve()
          .then(() => onSynced?.())
          .catch(() => {
            setState((current) => ({ ...current, error: '内容已同步，但制作稿暂未刷新；请重新打开制作稿。' }))
          })
      } else if (
        message.type === 'seqora:script-master:navigate' &&
        ['script', 'assets', 'storyboard'].includes(message.view)
      ) {
        onNavigate?.(message.view)
      }
    }
    window.addEventListener('message', receive)
    return () => window.removeEventListener('message', receive)
  }, [projectId, onSynced, onNavigate])

  return (
    <section
      className="script-master-workspace"
      aria-label="网剧创作工作台"
      aria-busy={state.status === 'loading'}
    >
      {state.status === 'loading' && (
        <div className="script-master-connection" role="status">
          <LoaderCircle size={22} className="spin" />
          <strong>正在恢复当前项目的创作…</strong>
          <span>设定、全剧规划、正文与分镜将在这里展开</span>
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
          key={state.url + attempt}
          title="网剧创作"
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
  onViewChange,
  busy,
  onOpenCreation,
  onSynced,
  onNavigate,
}) {
  return (
    <>
      <nav className="series-workspace-tabs" aria-label="剧本工作区">
        <button
          type="button"
          aria-current={view === 'creation' ? 'page' : undefined}
          disabled={busy}
          onClick={onOpenCreation}
        >
          剧本创作 <small>设定 · 规划 · 正文 · 分镜</small>
        </button>
        <button
          type="button"
          aria-current={view === 'production' ? 'page' : undefined}
          onClick={() => onViewChange('production')}
        >
          制作稿 <small>{episodeCount ? `${episodeCount} 集已同步` : '导入与编辑已有剧本'}</small>
        </button>
      </nav>
      <div className="series-creation-pane" hidden={view !== 'creation'}>
        <ScriptMasterWorkspace
          projectId={projectId}
          onSynced={onSynced}
          onNavigate={(view) => {
            if (view === 'script') onViewChange('production')
            else onNavigate?.(view)
          }}
        />
      </div>
      {view === 'production' && (
        <p className="series-production-note">
          这里是用于资产与视频制作的剧本。创作修改请切换「剧本创作」，完成后选择「同步到制作」；制作稿编辑不会回写创作源稿。
        </p>
      )}
    </>
  )
}
