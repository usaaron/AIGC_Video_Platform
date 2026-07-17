import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import './App.css'
import { AppHeader, AppSidebar, NewProjectModal } from './components/AppShell'
import { DEFAULT_SCRIPT, DEMO_CHARACTERS, DEMO_SCENES, DEMO_SHOTS, SEED_JOBS } from './data/demoData'
import { advanceQueue } from './features/generation/queue'
import { useStoredState } from './hooks/useStoredState'
import { AssetsPage } from './pages/AssetsPage'
import { FilmPage } from './pages/FilmPage'
import { GenerationPage } from './pages/GenerationPage'
import { OverviewPage } from './pages/OverviewPage'
import { ScriptPage } from './pages/ScriptPage'
import { StoryboardPage } from './pages/StoryboardPage'
import { dispatchGeneration } from './services/generationProvider'

function App() {
  const [activeStep, setActiveStep] = useState('overview')
  const [member, setMember] = useStoredState('seqora-member', false)
  const [credits, setCredits] = useStoredState('seqora-credits', 286)
  const [script, setScript] = useStoredState('seqora-script', DEFAULT_SCRIPT)
  const [jobs, setJobs] = useStoredState('seqora-jobs', SEED_JOBS)
  const [projectName, setProjectName] = useStoredState('seqora-project', '午夜胶片')
  const [assetTab, setAssetTab] = useState('characters')
  const [mobileNav, setMobileNav] = useState(false)
  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const [toast, setToast] = useState('')
  const [playing, setPlaying] = useState(false)
  const [currentShot, setCurrentShot] = useState(0)
  const [scriptSaved, setScriptSaved] = useState(true)

  const runningJobs = jobs.filter((job) => job.status === 'running')
  const concurrency = member ? 3 : 1

  useEffect(() => {
    const timer = window.setInterval(() => {
      setJobs((current) => advanceQueue(current, concurrency, () => 9 + Math.floor(Math.random() * 12)))
    }, 900)
    return () => window.clearInterval(timer)
  }, [concurrency, setJobs])

  useEffect(() => {
    if (!playing) return undefined
    const timer = window.setInterval(() => {
      setCurrentShot((shot) => (shot + 1) % DEMO_SHOTS.length)
    }, 2400)
    return () => window.clearInterval(timer)
  }, [playing])

  useEffect(() => {
    if (!toast) return undefined
    const timer = window.setTimeout(() => setToast(''), 2600)
    return () => window.clearTimeout(timer)
  }, [toast])

  const createJob = (label, type = '图片', cost = 6) => {
    if (credits < cost) {
      setToast('积分不足，请先充值')
      return false
    }

    const id = `${Date.now()}-${Math.random()}`
    setCredits((value) => value - cost)
    setJobs((current) => [
      { id, label, type, status: 'queued', progress: 0, cost, created: '刚刚' },
      ...current,
    ])
    dispatchGeneration({ id, label, type, cost }).catch(() => {
      setToast('模型服务暂不可用，任务保留在队列中')
    })
    setToast(`${label} 已加入生成队列`)
    return true
  }

  const generateScript = () => {
    if (createJob('剧本 · AI 扩写', '文本', 3)) {
      setScript(DEFAULT_SCRIPT)
      setScriptSaved(false)
    }
  }

  const generateAllAssets = () => {
    const targets = [...DEMO_CHARACTERS, ...DEMO_SCENES]
    if (!member) {
      createJob(`${targets[0].name} · 资产生成`, '图片', 6)
      setToast('非会员每次生成 1 个资产，任务已加入队列')
      return
    }
    targets.forEach((asset) => createJob(`${asset.name} · 资产生成`, '图片', 6))
  }

  const exportProject = () => {
    const payload = {
      projectName,
      script,
      characters: DEMO_CHARACTERS,
      scenes: DEMO_SCENES,
      shots: DEMO_SHOTS,
      exportedAt: new Date().toISOString(),
    }
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
    )
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${projectName}-项目包.json`
    anchor.click()
    URL.revokeObjectURL(url)
    setToast('项目包已导出')
  }

  const navigateTo = (id) => {
    setActiveStep(id)
    setMobileNav(false)
  }

  const renderContent = () => {
    const pageProps = {
      overview: {
        projectName,
        setActiveStep: navigateTo,
        runningJobs,
        jobs,
        member,
        setNewProjectOpen,
      },
      script: {
        script,
        setScript: (value) => {
          setScript(value)
          setScriptSaved(false)
        },
        saved: scriptSaved,
        onSave: () => {
          setScriptSaved(true)
          setToast('剧本已保存')
        },
        onGenerate: generateScript,
        onNext: () => {
          createJob('剧本 · 资产解析', '文本', 2)
          navigateTo('assets')
        },
      },
      assets: {
        tab: assetTab,
        setTab: setAssetTab,
        member,
        onGenerateAll: generateAllAssets,
        onGenerate: (name) => createJob(`${name} · 重新生成`, '图片', 6),
        onNext: () => navigateTo('storyboard'),
      },
      storyboard: {
        onGenerate: (shot) => createJob(`镜头 ${shot.number} · ${shot.title}`, '视频', 18),
        onNext: () => navigateTo('generate'),
      },
      generate: {
        jobs,
        concurrency,
        member,
        setMember,
        onClear: () => setJobs((current) => current.filter((job) => job.status !== 'completed')),
        onNext: () => navigateTo('film'),
      },
      film: { playing, setPlaying, currentShot, setCurrentShot, onExport: exportProject },
    }

    const pages = {
      overview: <OverviewPage {...pageProps.overview} />,
      script: <ScriptPage {...pageProps.script} />,
      assets: <AssetsPage {...pageProps.assets} />,
      storyboard: <StoryboardPage {...pageProps.storyboard} />,
      generate: <GenerationPage {...pageProps.generate} />,
      film: <FilmPage {...pageProps.film} />,
    }
    return pages[activeStep]
  }

  return (
    <div className="app-shell">
      <AppHeader
        projectName={projectName}
        credits={credits}
        member={member}
        setMember={setMember}
        runningJobs={runningJobs}
        onOpenNav={() => setMobileNav(true)}
        onProjectClick={() => navigateTo('overview')}
        onCreditsClick={() => setToast('充值功能将在支付接入后开放')}
      />
      <AppSidebar
        activeStep={activeStep}
        mobileNav={mobileNav}
        member={member}
        onNavigate={navigateTo}
        onClose={() => setMobileNav(false)}
      />
      {mobileNav && (
        <button className="sidebar-backdrop" aria-label="关闭导航" onClick={() => setMobileNav(false)} />
      )}
      <main className="workspace">{renderContent()}</main>
      {newProjectOpen && (
        <NewProjectModal
          onClose={() => setNewProjectOpen(false)}
          onCreate={(name) => {
            setProjectName(name)
            setScript('')
            setNewProjectOpen(false)
            navigateTo('script')
            setToast('新项目已创建')
          }}
        />
      )}
      {toast && (
        <div className="toast">
          <Check size={16} /> {toast}
        </div>
      )}
    </div>
  )
}

export default App
