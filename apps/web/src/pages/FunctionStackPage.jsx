import {
  ArrowLeft,
  ArrowUpRight,
  BookOpenText,
  Clapperboard,
  Film,
  LockKeyhole,
  Sparkles,
} from 'lucide-react'
import { PageHeader } from '../components/ui'
import { FUNCTION_STACK_ITEMS } from '../features/functionStack/config'
import { ImageStudioPage } from '../features/imageStudio/ImageStudioPage'
import { ScriptMasterWorkspace } from '../features/script/ScriptMasterWorkspace'
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
  onRefreshProduction,
  onOpenProduction,
}) {
  const item = FUNCTION_STACK_ITEMS.find((entry) => entry.id === tool) ?? FUNCTION_STACK_ITEMS[0]
  if (item.id === 'writing-studio')
    return (
      <WritingStudio
        project={project}
        onOpenScript={onOpenScript}
        onRefreshProduction={onRefreshProduction}
        onOpenProduction={onOpenProduction}
      />
    )
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

function WritingStudio({ project, onOpenScript, onRefreshProduction, onOpenProduction }) {
  return (
    <section className="page" aria-label="剧本大师工作台">
      <button type="button" className="button secondary" onClick={onOpenScript}>
        <ArrowLeft size={15} /> 返回项目剧本
      </button>
      <ScriptMasterWorkspace
        projectId={project?.id}
        onSynced={onRefreshProduction}
        onNavigate={(view) => (view === 'script' ? onOpenScript?.() : onOpenProduction?.(view))}
      />
    </section>
  )
}
