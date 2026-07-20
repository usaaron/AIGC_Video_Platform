import { useEffect, useRef, useState } from 'react'
import { analyzeScriptForProduction } from '@seqora/contracts'
import { ArrowRight, BadgeCheck, FileText, Save, Scissors, Upload } from 'lucide-react'
import { PageHeader } from '../components/ui'

const assetKindLabels = {
  character: '角色',
  scene: '场景',
  prop: '道具',
  costume: '服装',
  audio: '音频',
}

export function ScriptPage({ project, assets = [], onSave, onSplit }) {
  const [script, setScript] = useState(project.script)
  const [saved, setSaved] = useState(true)
  const [splitting, setSplitting] = useState(false)
  const fileInput = useRef(null)
  const count = script.replace(/\s/g, '').length
  const analysis = analyzeScriptForProduction(script, assets)
  const paragraphs = script.split(/\n+/).filter((item) => item.trim()).length
  const estimatedShots = analysis.shots.length || Math.min(12, Math.max(1, paragraphs))
  const suggestions = analysis.assetSuggestions

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
        title="输入剧本，拆成可生成的镜头"
        description="先把文本稳定下来，再让系统按语义段落、动作和对白拆出镜头草稿。"
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
            placeholder="粘贴或输入剧本。建议用空行分隔场景；较长段落会继续按动作、对白和句子语义拆分。"
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
          <span className="eyebrow">拆分预览</span>
          <h2>语义拆分后进入分镜页</h2>
          <p>系统会生成标题、景别、时长、画面提示词，并尽量把已存在资产挂到对应镜头。</p>
          <div className="split-metrics">
            <div>
              <span>文本长度</span>
              <strong>{count} 字</strong>
            </div>
            <div>
              <span>预计镜头</span>
              <strong>{estimatedShots}</strong>
            </div>
            <div>
              <span>资产建议</span>
              <strong>{suggestions.length}</strong>
            </div>
          </div>
          <div className="script-shot-preview">
            {analysis.shots.slice(0, 4).map((shot, index) => (
              <div key={`${shot.title}-${index}`}>
                <strong>
                  {String(index + 1).padStart(2, '0')} · {shot.title}
                </strong>
                <span>
                  {shot.framing} · {shot.duration} 秒 · 引用 {shot.assetIds.length} 个资产
                </span>
              </div>
            ))}
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

      <section className="script-assets-panel">
        <div className="panel-head">
          <div>
            <h2>资产建议</h2>
            <span>已有资产会自动引用；新建议需要到资产页确认后再生成。</span>
          </div>
        </div>
        <div className="asset-suggestion-list">
          {suggestions.length ? (
            suggestions.map((suggestion) => (
              <article className="asset-suggestion-card" key={`${suggestion.kind}-${suggestion.name}`}>
                <span>{assetKindLabels[suggestion.kind] || suggestion.kind}</span>
                <strong>{suggestion.name}</strong>
                <p>{suggestion.reason}</p>
                <small>
                  出现 {suggestion.evidenceCount} 次 · {suggestion.assetId ? '已有资产' : '建议补齐'}
                </small>
              </article>
            ))
          ) : (
            <div className="empty-state compact">
              <FileText size={24} />
              <h3>暂无明确资产建议</h3>
              <p>剧本保存后可以先拆分镜头，再从分镜补充引用资产。</p>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
