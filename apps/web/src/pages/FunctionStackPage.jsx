import { useEffect, useState } from 'react'
import {
  ArrowLeft,
  ArrowUpRight,
  BookOpenText,
  Clapperboard,
  Film,
  LockKeyhole,
  RefreshCw,
  Sparkles,
} from 'lucide-react'
import { PageHeader } from '../components/ui'
import { FUNCTION_STACK_ITEMS } from '../features/functionStack/config'
import { ImageStudioPage } from '../features/imageStudio/ImageStudioPage'
import { api } from '../services/apiClient'
import '../features/functionStack/comingSoon.css'

export function FunctionStackPage({
  tool,
  project,
  billing,
  tasks,
  image2ProviderStatus = null,
  onRefreshImageStudio,
  onOpenBilling,
  onOpenScript,
  onOpenHome,
}) {
  const item = FUNCTION_STACK_ITEMS.find((entry) => entry.id === tool) ?? FUNCTION_STACK_ITEMS[0]
  if (item.id === 'writing-studio') return <WritingStudio project={project} onOpenScript={onOpenScript} />
  if (item.availability === 'coming-soon') return <AgentComingSoon onOpenHome={onOpenHome} />
  return (
    <div className={`page tool-studio-page ${item.id}`}>
      <PageHeader eyebrow={item.eyebrow} title={item.title} description={item.description} />
      <ImageStudioPage
        project={project}
        billing={billing}
        tasks={tasks}
        image2ProviderStatus={image2ProviderStatus}
        onRefresh={onRefreshImageStudio}
        onOpenBilling={onOpenBilling}
      />
    </div>
  )
}

function AgentComingSoon({ onOpenHome }) {
  return (
    <section className="page agent-coming-soon" aria-label="一句成片筹备中">
      <div className="agent-soon-copy">
        <span className="eyebrow">创作的下一种可能</span>
        <span className="agent-soon-badge">
          <LockKeyhole size={13} /> 筹备中 · 暂未开放
        </span>
        <h1>
          一句灵感，
          <br />
          一部好戏。
        </h1>
        <p>让故事从想法自然走向成片。我们正在完善自动创作流程，准备好后，这里将成为你的新起点。</p>
        <button type="button" className="button primary" onClick={onOpenHome}>
          前往项目创作 <ArrowUpRight size={16} />
        </button>
        <small>现在可以在项目中完成剧本、资产、分镜与视频制作。</small>
      </div>
      <div className="agent-soon-art" aria-hidden="true">
        <span className="agent-soon-orbit" />
        <div className="agent-soon-frame">
          <Clapperboard size={54} strokeWidth={1} />
          <span>好故事，值得等待</span>
          <b>序幕 TV</b>
        </div>
        <span className="agent-soon-note note-script">
          <BookOpenText size={21} />
          故事
        </span>
        <span className="agent-soon-note note-spark">
          <Sparkles size={21} />
          灵感
        </span>
        <span className="agent-soon-note note-film">
          <Film size={21} />
          成片
        </span>
      </div>
    </section>
  )
}

function WritingStudio({ project, onOpenScript }) {
  const [state, setState] = useState({ status: 'loading', launchUrl: '', message: '' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    setState({ status: 'loading', launchUrl: '', message: '' })
    void api
      .scriptMasterLaunch(project?.id)
      .then((launch) => {
        if (!active) return
        if (!launch.enabled || !launch.launchUrl) throw new Error('剧本大师暂未配置，请联系管理员。')
        const url = new URL(launch.launchUrl)
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error('剧本大师工作台地址无效。')
        setState({ status: 'ready', launchUrl: url.href, message: '' })
        window.location.assign(url.href)
      })
      .catch((error) => {
        if (active)
          setState({
            status: 'error',
            launchUrl: '',
            message: error?.message || '剧本大师暂时无法连接，请稍后重试。',
          })
      })
    return () => {
      active = false
    }
  }, [project?.id, attempt])

  return (
    <section
      className="page writing-studio-launch"
      aria-label="剧本大师工作台"
      aria-busy={state.status === 'loading'}
    >
      <BookOpenText size={32} aria-hidden="true" />
      <h1>{state.status === 'error' ? '暂时无法打开剧本大师' : '正在打开剧本大师'}</h1>
      <p role={state.status === 'error' ? 'alert' : 'status'}>{state.message || '正在准备你的剧本工作台…'}</p>
      <div className="writing-studio-handoff-actions">
        {state.launchUrl && (
          <a className="button primary" href={state.launchUrl}>
            进入工作台
          </a>
        )}
        {state.status === 'error' && (
          <button type="button" className="button primary" onClick={() => setAttempt((value) => value + 1)}>
            <RefreshCw size={15} />
            重新连接
          </button>
        )}
        <button type="button" className="button secondary" onClick={onOpenScript}>
          <ArrowLeft size={15} />
          返回单集剧本
        </button>
      </div>
    </section>
  )
}
