import { useEffect, useState } from 'react'
import { CheckCircle2, LoaderCircle, RefreshCcw, Sparkles } from 'lucide-react'
import { SCRIPT_OPERATION_CREDITS } from '@seqora/contracts'
import { formatOutlineRegenerationIdea } from './outlineDraft'

const OUTLINE_COUNTS = [3, 4, 5]
const DEFAULT_SCENE_COUNT = 12

export function OutlineOptionsPanel({
  projectId,
  ideaSeed,
  billing,
  busy,
  direction,
  onGenerate,
  onGenerateStructure,
  onGenerateScenes,
  onUseOutline,
  onUseStructure,
  onUseScenes,
}) {
  const [idea, setIdea] = useState(ideaSeed)
  const [count, setCount] = useState(4)
  const [outlines, setOutlines] = useState([])
  const [generatedAt, setGeneratedAt] = useState('')
  const [generating, setGenerating] = useState(false)
  const [structuring, setStructuring] = useState(false)
  const [structure, setStructure] = useState(null)
  const [sceneGenerating, setSceneGenerating] = useState(false)
  const [sceneScript, setSceneScript] = useState(null)
  const [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const canGenerate = idea.trim().length >= 4 && !busy && !generating && !structuring && !sceneGenerating
  const selectedOutline = outlines.find((outline) => outline.id === selectedId) || null

  useEffect(() => {
    setIdea(ideaSeed)
    setOutlines([])
    setGeneratedAt('')
    setStructure(null)
    setSceneScript(null)
    setError('')
    setSelectedId('')
  }, [projectId, ideaSeed])

  const hasCredits = (action, credits) => {
    if (billing.credits >= credits) return true
    setError(`${action}需要 ${credits} 积分，当前剩余 ${billing.credits} 积分`)
    return false
  }

  const generate = async () => {
    if (!idea.trim()) {
      setError('请先填写一句话故事想法')
      return
    }
    if (!hasCredits('生成大纲候选', SCRIPT_OPERATION_CREDITS.outline)) return
    setGenerating(true)
    setError('')
    setSelectedId('')
    setStructure(null)
    setSceneScript(null)
    try {
      const result = await onGenerate(idea, direction, count)
      setOutlines(result.outlines || [])
      setGeneratedAt(result.generatedAt || '')
    } catch (outlineError) {
      setError(outlineError.message)
    } finally {
      setGenerating(false)
    }
  }

  const regenerateOutline = async (outline) => {
    if (!idea.trim()) {
      setError('请先填写一句话故事想法')
      return
    }
    if (!hasCredits('重新生成大纲', SCRIPT_OPERATION_CREDITS.outline)) return
    setGenerating(true)
    setError('')
    try {
      const result = await onGenerate(formatOutlineRegenerationIdea(idea, outline), direction, 3)
      const replacement = result.outlines?.[0]
      if (!replacement) throw new Error('未返回可用的大纲候选')
      setOutlines((current) =>
        current.map((item) => (item.id === outline.id ? { ...replacement, id: outline.id } : item)),
      )
      setGeneratedAt(result.generatedAt || '')
      setSelectedId(outline.id)
      setStructure(null)
      setSceneScript(null)
    } catch (outlineError) {
      setError(outlineError.message)
    } finally {
      setGenerating(false)
    }
  }

  const useSelectedOutline = () => {
    if (!selectedOutline) {
      setError('请先选择一个大纲')
      return
    }
    setError('')
    onUseOutline(selectedOutline)
  }

  const generateStructure = async () => {
    if (!selectedOutline) {
      setError('请先选择一个大纲')
      return
    }
    if (!hasCredits('生成剧情结构', SCRIPT_OPERATION_CREDITS.structure)) return
    setStructuring(true)
    setError('')
    setSceneScript(null)
    try {
      setStructure(await onGenerateStructure(idea, selectedOutline, direction))
    } catch (structureError) {
      setError(structureError.message)
    } finally {
      setStructuring(false)
    }
  }

  const useStructure = () => {
    if (!structure) {
      setError('请先生成剧情结构')
      return
    }
    setError('')
    onUseStructure(structure)
  }

  const generateScenes = async () => {
    if (!selectedOutline || !structure) {
      setError('请先选择大纲并生成剧情结构')
      return
    }
    if (!hasCredits('生成分场剧本', SCRIPT_OPERATION_CREDITS.scenes)) return
    setSceneGenerating(true)
    setError('')
    try {
      setSceneScript(await onGenerateScenes(idea, selectedOutline, structure, direction, DEFAULT_SCENE_COUNT))
    } catch (sceneError) {
      setError(sceneError.message)
    } finally {
      setSceneGenerating(false)
    }
  }

  const useScenes = () => {
    if (!sceneScript) {
      setError('请先生成分场剧本')
      return
    }
    setError('')
    onUseScenes(sceneScript)
  }

  return (
    <section className="script-outline-panel" aria-busy={generating || structuring || sceneGenerating}>
      <div className="outline-input-column">
        <div className="outline-panel-head">
          <span className="eyebrow">大纲多方案</span>
          <h2>先定故事方向</h2>
        </div>
        <label className="outline-idea-field">
          <span>一句话想法</span>
          <textarea
            value={idea}
            rows={4}
            placeholder="例如：我想生成一个100分钟带有浪漫和悲情色彩的中国风武侠剧"
            onChange={(event) => setIdea(event.target.value)}
          />
        </label>
        <div className="outline-actions-row">
          <div className="outline-count-group" role="group" aria-label="大纲候选数量">
            {OUTLINE_COUNTS.map((value) => (
              <button
                type="button"
                key={value}
                className={count === value ? 'active' : ''}
                aria-pressed={count === value}
                disabled={generating || structuring || sceneGenerating}
                onClick={() => setCount(value)}
              >
                {value}
              </button>
            ))}
          </div>
          <button
            className="button primary outline-generate-button"
            disabled={!canGenerate}
            onClick={() => void generate()}
          >
            {generating ? (
              <LoaderCircle size={16} className="spin" />
            ) : outlines.length ? (
              <RefreshCcw size={16} />
            ) : (
              <Sparkles size={16} />
            )}
            {generating
              ? '正在生成大纲'
              : outlines.length
                ? `重新生成全部 · ${SCRIPT_OPERATION_CREDITS.outline} 积分`
                : `生成大纲候选 · ${SCRIPT_OPERATION_CREDITS.outline} 积分`}
          </button>
        </div>
        {selectedOutline && (
          <div className="outline-selected-panel">
            <span>已选择</span>
            <strong>{selectedOutline.title}</strong>
            <button
              type="button"
              className="button secondary"
              disabled={busy || generating || structuring || sceneGenerating}
              onClick={useSelectedOutline}
            >
              应用所选大纲到剧本
            </button>
            <button
              type="button"
              className="button primary"
              disabled={busy || generating || structuring || sceneGenerating}
              onClick={() => void generateStructure()}
            >
              {structuring ? <LoaderCircle size={16} className="spin" /> : <Sparkles size={16} />}
              {structuring
                ? '正在生成剧情结构'
                : structure
                  ? `重新生成剧情结构 · ${SCRIPT_OPERATION_CREDITS.structure} 积分`
                  : `生成剧情结构 · ${SCRIPT_OPERATION_CREDITS.structure} 积分`}
            </button>
            {structure && (
              <button
                type="button"
                className="button secondary"
                disabled={busy || generating || structuring || sceneGenerating}
                onClick={useStructure}
              >
                应用剧情结构到剧本
              </button>
            )}
            {structure && (
              <button
                type="button"
                className="button primary"
                disabled={busy || generating || structuring || sceneGenerating}
                onClick={() => void generateScenes()}
              >
                {sceneGenerating ? <LoaderCircle size={16} className="spin" /> : <Sparkles size={16} />}
                {sceneGenerating
                  ? '正在生成分场剧本'
                  : sceneScript
                    ? `重新生成分场剧本 · ${SCRIPT_OPERATION_CREDITS.scenes} 积分`
                    : `生成分场剧本 · ${SCRIPT_OPERATION_CREDITS.scenes} 积分`}
              </button>
            )}
            {sceneScript && (
              <button
                type="button"
                className="button secondary"
                disabled={busy || generating || structuring || sceneGenerating}
                onClick={useScenes}
              >
                应用分场剧本到剧本
              </button>
            )}
          </div>
        )}
        {error && (
          <p className="outline-error" role="alert">
            {error}
          </p>
        )}
      </div>

      <div className="outline-options-column">
        <div className="outline-options-head">
          <strong>候选方向</strong>
          {generatedAt && <span>{new Date(generatedAt).toLocaleTimeString('zh-CN', { hour12: false })}</span>}
        </div>
        <div className="outline-card-grid">
          {outlines.length ? (
            outlines.map((outline) => (
              <article
                className={selectedId === outline.id ? 'outline-card selected' : 'outline-card'}
                key={outline.id}
              >
                <div className="outline-card-top">
                  <span>{outline.estimatedDuration}</span>
                  {selectedId === outline.id && <CheckCircle2 size={16} />}
                </div>
                <h3>{outline.title}</h3>
                <p className="outline-logline">{outline.logline}</p>
                <dl>
                  <div>
                    <dt>主角</dt>
                    <dd>{outline.protagonist}</dd>
                  </div>
                  <div>
                    <dt>冲突</dt>
                    <dd>{outline.conflict}</dd>
                  </div>
                  <div>
                    <dt>基调</dt>
                    <dd>{outline.tone}</dd>
                  </div>
                  <div>
                    <dt>结局</dt>
                    <dd>{outline.ending}</dd>
                  </div>
                </dl>
                <p className="outline-summary">{outline.summary}</p>
                <div className="outline-card-actions">
                  <button
                    type="button"
                    className={selectedId === outline.id ? 'button primary' : 'button secondary'}
                    disabled={busy || generating || structuring || sceneGenerating}
                    onClick={() => {
                      setSelectedId(outline.id)
                      setStructure(null)
                      setSceneScript(null)
                      setError('')
                    }}
                  >
                    {selectedId === outline.id ? '已选择' : '选择大纲'}
                  </button>
                  <button
                    type="button"
                    className="button secondary"
                    disabled={!canGenerate}
                    onClick={() => void regenerateOutline(outline)}
                  >
                    <RefreshCcw size={14} /> 重生此项
                  </button>
                </div>
              </article>
            ))
          ) : (
            <div className="outline-empty-state">
              <Sparkles size={18} />
              <span>暂无候选</span>
            </div>
          )}
        </div>
        {structure && (
          <section className="outline-structure-panel">
            <div className="outline-structure-head">
              <span className="eyebrow">剧情结构</span>
              <h3>{structure.title}</h3>
            </div>
            <p>{structure.premise}</p>
            <div className="structure-main-plot">
              <strong>主线</strong>
              <span>{structure.mainPlot}</span>
            </div>
            <div className="structure-act-list">
              {structure.acts.map((act) => (
                <article key={act.id}>
                  <div>
                    <strong>{act.title}</strong>
                    <span>{act.estimatedMinutes}m</span>
                  </div>
                  <p>{act.summary}</p>
                  <small>{act.turningPoint}</small>
                </article>
              ))}
            </div>
            <div className="structure-compact-grid">
              <div>
                <strong>副线</strong>
                {structure.subplots.map((subplot) => (
                  <span key={subplot.id}>{subplot.title}</span>
                ))}
              </div>
              <div>
                <strong>角色弧光</strong>
                {structure.characterArcs.map((arc) => (
                  <span key={arc.character}>{arc.character}</span>
                ))}
              </div>
            </div>
            <div className="structure-next-step">
              <strong>下一步</strong>
              <span>{structure.nextStep}</span>
            </div>
          </section>
        )}
        {sceneScript && (
          <section className="outline-scenes-panel">
            <div className="outline-scenes-head">
              <span className="eyebrow">分场剧本</span>
              <h3>{sceneScript.title}</h3>
            </div>
            <div className="scene-script-list">
              {sceneScript.scenes.map((scene) => (
                <article key={scene.id}>
                  <div className="scene-script-card-head">
                    <strong>
                      {String(scene.order).padStart(2, '0')} · {scene.title}
                    </strong>
                    <span>{scene.estimatedMinutes}m</span>
                  </div>
                  <small>
                    {scene.actId}｜{scene.location}｜{scene.timeOfDay}
                  </small>
                  <p>{scene.plot}</p>
                  <div className="scene-script-tags">
                    {scene.characters.map((character) => (
                      <span key={character}>{character}</span>
                    ))}
                  </div>
                </article>
              ))}
            </div>
            <div className="structure-next-step">
              <strong>连续性</strong>
              <span>{sceneScript.continuityNotes}</span>
            </div>
          </section>
        )}
      </div>
    </section>
  )
}
