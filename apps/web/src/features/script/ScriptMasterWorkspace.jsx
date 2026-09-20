import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, History, LoaderCircle, RefreshCw } from 'lucide-react'
import { api } from '../../services/apiClient'
import { subscribeScriptMasterMessages } from './scriptMasterMessages'

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

export function ScriptMasterWorkspace({ projectId, surface = 'script', onSynced, onNavigate }) {
  const frame = useRef(null)
  const callbacks = useRef({ onSynced, onNavigate })
  callbacks.current = { onSynced, onNavigate }
  const standalone = surface === 'standalone'
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
  }, [projectId, attempt, surface])

  useEffect(() => {
    return subscribeScriptMasterMessages({
      hostWindow: window,
      projectId,
      getFrameWindow: () => frame.current?.contentWindow,
      onReady: () => setState((current) => ({ ...current, status: 'ready', error: '' })),
      onSynced: () => callbacks.current.onSynced?.(),
      onNavigate: (view) => callbacks.current.onNavigate?.(view),
      onError: (error) => setState((current) => ({ ...current, error })),
    })
  }, [projectId, attempt, surface])

  return (
    <section
      className="script-master-workspace"
      aria-label={standalone ? '独立剧本创作工作台' : '网剧创作工作台'}
      data-surface={surface}
      aria-busy={state.status === 'loading'}
    >
      {state.status === 'loading' && (
        <div className="script-master-connection" role="status">
          <LoaderCircle size={22} className="spin" />
          <strong>{standalone ? '正在打开剧本大师…' : '正在恢复当前项目的创作…'}</strong>
          <span>
            {standalone
              ? '梗概、总纲、规划、正文、分镜与文件导出将在这里展开'
              : '写下故事想法，确认安排后生成剧本，完成后进入资产设计'}
          </span>
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
          title={standalone ? '剧本大师（测试中）' : '网剧创作'}
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
      <div className="series-creation-pane" hidden={view !== 'creation'}>
        <ScriptMasterWorkspace
          projectId={projectId}
          surface="script"
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
