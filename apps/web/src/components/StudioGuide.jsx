import { ArrowRight, Compass } from 'lucide-react'
import { useEffect, useRef } from 'react'

const GUIDANCE = [
  ['script', '写好故事', '输入想法或导入文本，生成后先保存剧本。'],
  ['assets', '定义角色与场景', '从资产建议开始，确认人物面部，再生成不同造型。'],
  ['storyboard', '安排每一个镜头', '拆分剧本，编辑画面描述，需要时加入参考图。'],
  ['generate', '让画面动起来', '在分镜中提交视频任务，到生成队列查看进度。'],
  ['film', '预览你的作品', '检查生成结果，合成预览并下载可用视频。'],
]

export function StudioGuide({ onNavigate }) {
  const guide = useRef(null)
  useEffect(() => {
    const dismiss = (event) => {
      const panel = guide.current
      if (!panel?.open) return
      if (event.type === 'keydown') {
        if (event.key !== 'Escape') return
        panel.open = false
        panel.querySelector('summary').focus()
      } else if (!panel.contains(event.target)) panel.open = false
    }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', dismiss)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('keydown', dismiss)
    }
  }, [])
  return (
    <details className="studio-guide" ref={guide}>
      <summary aria-label="创作指引">
        <Compass size={16} />
        <span>创作指引</span>
      </summary>
      <div className="studio-guide-popover">
        <span className="studio-kicker">从想法，到作品</span>
        <h2>跟着这五步，开始创作。</h2>
        <p>先创建或打开一个项目，你的内容会保存在对应项目里。</p>
        {GUIDANCE.map(([id, title, description], index) => (
          <button
            key={id}
            onClick={(event) => {
              event.currentTarget.closest('details').open = false
              onNavigate(id)
            }}
          >
            <span className="studio-guide-number">0{index + 1}</span>
            <span>
              <strong>{title}</strong>
              <small>{description}</small>
            </span>
            <ArrowRight size={15} />
          </button>
        ))}
      </div>
    </details>
  )
}
