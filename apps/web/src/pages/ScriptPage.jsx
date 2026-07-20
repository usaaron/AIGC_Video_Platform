import { useEffect, useRef, useState } from 'react'
import { ArrowRight, BadgeCheck, FileText, Save, Scissors, Upload } from 'lucide-react'
import { PageHeader } from '../components/ui'

export function ScriptPage({ project, onSave, onSplit }) {
  const [script, setScript] = useState(project.script)
  const [saved, setSaved] = useState(true)
  const [splitting, setSplitting] = useState(false)
  const fileInput = useRef(null)
  const count = script.replace(/\s/g, '').length
  const paragraphs = script.split(/\n+/).filter((item) => item.trim()).length
  const estimatedShots = Math.min(12, Math.max(1, paragraphs))

  useEffect(() => {
    setScript(project.script)
    setSaved(true)
  }, [project.id, project.script])

  const update = (value) => {
    setScript(value)
    setSaved(false)
  }
  const upload = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    update(await file.text())
    event.target.value = ''
  }
  const handleSave = async () => {
    await onSave(script)
    setSaved(true)
  }
  const handleSplit = async () => {
    setSplitting(true)
    try {
      if (!saved) await handleSave()
      await onSplit()
    } finally {
      setSplitting(false)
    }
  }

  return (
    <div className="page editor-page">
      <PageHeader
        eyebrow="第 1 步 · 剧本"
        title="输入剧本，然后拆成镜头"
        description="这一页只处理两件事：写入文本、拆分分镜。"
      >
        <input ref={fileInput} className="hidden-input" type="file" accept=".txt,.md" onChange={upload} />
        <button className="button secondary" onClick={() => fileInput.current?.click()}>
          <Upload size={16} /> 上传文本
        </button>
        <button className="button secondary" onClick={handleSave}>
          <Save size={16} /> 保存
        </button>
        <button className="button primary" onClick={handleSplit} disabled={splitting || !script.trim()}>
          <Scissors size={16} /> {splitting ? '拆分中' : '保存并拆分'}
        </button>
      </PageHeader>

      <div className="script-layout script-layout-simple">
        <section className="script-editor">
          <div className="editor-toolbar">
            <div>
              <span className="script-input-label">
                <FileText size={15} /> 剧本文本
              </span>
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
            placeholder="粘贴或输入剧本。建议用空行分隔场景或段落，后续会按段落拆成镜头列表。"
          />
          <div className="editor-footer">
            <span>
              {count} 字 · {paragraphs} 段 · 预计 {estimatedShots} 个镜头
            </span>
            <button onClick={handleSave}>
              <Save size={14} /> 保存剧本
            </button>
          </div>
        </section>

        <aside className="script-split-panel">
          <span className="eyebrow">拆分</span>
          <h2>保存后生成镜头列表</h2>
          <p>系统会把当前剧本拆成列表式镜头，之后可以在分镜页逐条编辑标题、时长和提示词。</p>
          <div className="split-metrics">
            <div>
              <span>文本长度</span>
              <strong>{count} 字</strong>
            </div>
            <div>
              <span>段落</span>
              <strong>{paragraphs}</strong>
            </div>
            <div>
              <span>预计镜头</span>
              <strong>{estimatedShots}</strong>
            </div>
          </div>
          <button
            className="button primary full"
            onClick={handleSplit}
            disabled={splitting || !script.trim()}
          >
            {splitting ? '正在拆分' : '拆分到分镜页'} <ArrowRight size={16} />
          </button>
        </aside>
      </div>
    </div>
  )
}
