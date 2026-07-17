import { useEffect, useRef, useState } from 'react'
import {
  ArrowRight,
  BadgeCheck,
  Clapperboard,
  Clock3,
  Image,
  Save,
  Sparkles,
  Upload,
  UserRound,
} from 'lucide-react'
import { PageHeader } from '../components/ui'

export function ScriptPage({ project, onSave, onGenerate, onNext }) {
  const [script, setScript] = useState(project.script)
  const [saved, setSaved] = useState(true)
  const fileInput = useRef(null)
  const count = script.replace(/\s/g, '').length

  useEffect(() => {
    setScript(project.script)
    setSaved(true)
  }, [project.id, project.script])

  const update = (value) => {
    setScript(value)
    setSaved(false)
  }
  const insert = (label) => update(`${script}${script ? '\n\n' : ''}${label}：`)
  const upload = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    update(await file.text())
    event.target.value = ''
  }

  return (
    <div className="page editor-page">
      <PageHeader
        eyebrow="第 1 步 · 剧本"
        title="把故事变成可制作的剧本"
        description="文本会保存到项目，刷新或换设备后仍然保留。"
      >
        <input ref={fileInput} className="hidden-input" type="file" accept=".txt,.md" onChange={upload} />
        <button className="button secondary" onClick={() => fileInput.current?.click()}>
          <Upload size={16} /> 上传文本
        </button>
        <button className="button primary" onClick={onGenerate}>
          <Sparkles size={16} /> AI 扩写任务
        </button>
      </PageHeader>
      <div className="script-layout">
        <section className="script-editor">
          <div className="editor-toolbar">
            <div>
              <button className="format-button" onClick={() => insert('场景')}>
                场景
              </button>
              <button className="format-button" onClick={() => insert('角色')}>
                角色
              </button>
              <button className="format-button" onClick={() => insert('对白')}>
                对白
              </button>
            </div>
            <span>
              {saved ? (
                <>
                  <BadgeCheck size={14} /> 已保存
                </>
              ) : (
                '有未保存修改'
              )}
            </span>
          </div>
          <textarea
            value={script}
            onChange={(event) => update(event.target.value)}
            placeholder="写下故事内容，或者上传文本……"
          />
          <div className="editor-footer">
            <span>
              {count} 字 · 预计 {Math.max(1, Math.ceil(count / 120))} 分钟
            </span>
            <button
              onClick={async () => {
                await onSave(script)
                setSaved(true)
              }}
            >
              <Save size={14} /> 保存剧本
            </button>
          </div>
        </section>
        <aside className="analysis-panel">
          <div className="analysis-head">
            <span className="spark-icon">
              <Sparkles size={17} />
            </span>
            <div>
              <h3>剧本分析</h3>
              <p>按当前文本估算</p>
            </div>
          </div>
          <div className="analysis-score">
            <div>
              <strong>{Math.min(100, Math.round(count / 2))}</strong>
              <span>完整度</span>
            </div>
            <div className="score-ring" />
          </div>
          <div className="analysis-list">
            <div>
              <span>
                <UserRound size={15} /> 主要角色
              </span>
              <strong>
                {Math.max(
                  1,
                  (script.match(/林夏|周野/g) || []).filter(
                    (value, index, array) => array.indexOf(value) === index,
                  ).length,
                )}{' '}
                人
              </strong>
            </div>
            <div>
              <span>
                <Image size={15} /> 段落
              </span>
              <strong>{script.split(/\n+/).filter(Boolean).length} 段</strong>
            </div>
            <div>
              <span>
                <Clapperboard size={15} /> 建议镜头
              </span>
              <strong>{Math.min(8, Math.max(1, script.split(/\n+/).filter(Boolean).length))} 个</strong>
            </div>
            <div>
              <span>
                <Clock3 size={15} /> 预计时长
              </span>
              <strong>{Math.max(1, Math.ceil(count / 120))} 分钟</strong>
            </div>
          </div>
          <div className="tip-box">
            <Sparkles size={15} />
            <p>保存后进入分镜页，系统会按段落自动拆分镜头。</p>
          </div>
        </aside>
      </div>
      <div className="sticky-actions">
        <span>剧本保存后才能在其他设备继续编辑。</span>
        <button className="button primary" onClick={onNext}>
          管理角色资产 <ArrowRight size={16} />
        </button>
      </div>
    </div>
  )
}
