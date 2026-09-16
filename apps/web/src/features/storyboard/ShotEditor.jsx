import { ShotReferenceGallery } from './ShotReferenceGallery'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { LoaderCircle, RotateCcw, Upload, Video, X } from 'lucide-react'
import { IconButton } from '../../components/ui'
import { AssetAwareTextarea } from '../assets/AssetShortcutBar'
import { normalizedVideoDuration, shotReferenceImages, validateShotReferences } from '@seqora/prompting'
import { insertPromptAtCursor } from '../assets/promptInsertion'
import { adjustPromptHighlights, mergePromptHighlights } from '../assets/promptHighlights'
import { ShotAssetShortcuts } from './ShotAssetShortcuts'
import { ShotPromptTemplates } from './ShotPromptTemplates'
import { ShotLibraryAssets } from './ShotLibraryAssets'
import './shotEditor.css'

export function ShotEditor({
  projectId,
  shot,
  shots = [],
  minDuration = 4,
  assets = [],
  tasks = [],
  canGenerate = false,
  onUpload,
  onClose,
  onSave,
}) {
  const orderedShots = [...shots].sort((left, right) => left.order - right.order)
  const [insertionIndex, setInsertionIndex] = useState(orderedShots.length)
  const title = shot.title || `镜头 ${orderedShots.length + 1}`
  const framing = shot.framing || '中景'
  const [duration, setDuration] = useState(normalizedVideoDuration(shot.duration, minDuration))
  const [prompt, setPrompt] = useState(shot.prompt || '')
  const [templateHighlights, setTemplateHighlights] = useState([])
  const promptArea = useRef(null)
  const negativePrompt = shot.negativePrompt || ''
  const continuityNote = shot.continuityNote || ''
  const [referenceImages, setReferenceImages] = useState(() => shotReferenceImages(shot))
  const [scriptEpisodeId, setScriptEpisodeId] = useState(shot.scriptEpisodeId || null)
  const [episodeNumber, setEpisodeNumber] = useState(shot.episodeNumber || 1)
  const [episodeTitle, setEpisodeTitle] = useState(shot.episodeTitle || `第 ${shot.episodeNumber || 1} 集`)
  const [episodeKind, setEpisodeKind] = useState(shot.episodeKind || 'standard')
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState('')
  const [error, setError] = useState('')
  const saveLock = useRef(false)
  const dialogRef = useRef(null)
  const busy = uploading || Boolean(saving)
  useEffect(() => {
    const dialog = dialogRef.current
    dialog.showModal()
    return () => dialog.close()
  }, [])
  const close = () => {
    if (!busy && !saveLock.current) onClose()
  }
  const changePrompt = (next) => {
    setTemplateHighlights((current) => adjustPromptHighlights(prompt, next, current))
    setPrompt(next)
  }
  const insertPrompt = (text, template = false) => {
    insertPromptAtCursor(promptArea.current, prompt, text, (next, edit) => {
      if (next.length > 5000) throw new Error('插入后超过 5,000 字，请缩短提示词或选取更短的文本后再插入。')
      setTemplateHighlights((current) =>
        mergePromptHighlights([
          ...adjustPromptHighlights(prompt, next, current, edit),
          ...(template ? [{ start: edit.insertedStart, end: edit.insertedEnd }] : []),
        ]),
      )
      setPrompt(next)
      setError('')
    })
  }
  const save = async (generate) => {
    if (busy || saveLock.current) return
    if (generate && !canGenerate) return
    if (generate && !prompt.trim()) {
      setError('请先填写画面提示词。')
      return
    }
    saveLock.current = true
    setSaving(generate ? 'generate' : 'save')
    setError('')
    try {
      validateShotReferences(prompt, referenceImages.length)
      await onSave(
        {
          title,
          framing,
          duration: Number(duration),
          prompt,
          negativePrompt,
          continuityNote,
          imageUrl:
            shot.selectedImageTaskId || shot.imageUrl?.startsWith('/api/v1/generation/tasks/')
              ? shot.imageUrl
              : referenceImages[0]?.url || null,
          referenceImages,
          scriptEpisodeId,
          episodeBreakBefore: Boolean(shot.episodeBreakBefore),
          episodeNumber: Number(episodeNumber),
          episodeTitle: episodeTitle.trim() || `第 ${episodeNumber} 集`,
          episodeKind,
          continuityMode: shot.id
            ? shot.continuityMode || 'continue'
            : insertionIndex === 0
              ? 'independent'
              : shot.continuityMode || 'continue',
          ...(shot.id
            ? {}
            : { insertAfterShotId: insertionIndex === 0 ? null : orderedShots[insertionIndex - 1]?.id }),
        },
        generate,
      )
    } catch (failure) {
      setError(failure.message || '保存失败，请重试。')
    } finally {
      saveLock.current = false
      setSaving('')
    }
  }
  const insertionLabel =
    insertionIndex === 0
      ? '最前面'
      : insertionIndex >= orderedShots.length
        ? '末尾'
        : `第 ${insertionIndex} 镜之后`

  const changeInsertionIndex = (value) => {
    const nextIndex = Math.max(0, Math.min(orderedShots.length, Number(value)))
    setInsertionIndex(nextIndex)
    const previous = nextIndex > 0 ? orderedShots[nextIndex - 1] : null
    const next = orderedShots[nextIndex] || null
    const episode = previous || next
    if (episode) {
      setScriptEpisodeId(episode.scriptEpisodeId || null)
      setEpisodeNumber(episode.episodeNumber || 1)
      setEpisodeTitle(episode.episodeTitle || `第 ${episode.episodeNumber || 1} 集`)
      setEpisodeKind('standard')
    }
  }

  const addReferenceImages = (incoming) => {
    const next = [...referenceImages]
    for (const image of incoming) if (!next.some((item) => item.url === image.url)) next.push(image)
    if (next.length > 9) throw new Error('每个镜头最多使用 9 张参考图。')
    setReferenceImages(next)
    setError('')
  }
  const removeReferenceImage = (index) => {
    if ([...prompt.matchAll(/【图(\d+)】/gu)].some((match) => Number(match[1]) === index + 1)) {
      setError(`请先移除提示词中的【图${index + 1}】引用，再删除这张图片。`)
      return
    }
    changePrompt(
      prompt.replace(/【图(\d+)】/gu, (token, number) =>
        Number(number) > index + 1 ? `【图${Number(number) - 1}】` : token,
      ),
    )
    setReferenceImages((images) => images.filter((_, position) => position !== index))
    setError('')
  }

  return createPortal(
    <dialog
      ref={dialogRef}
      className="shot-editor-dialog"
      aria-labelledby="shot-editor-title"
      onCancel={(event) => {
        if (event.target !== event.currentTarget) return
        event.preventDefault()
        close()
      }}
    >
      <form
        className="modal storyboard-shot-editor"
        onSubmit={(event) => {
          event.preventDefault()
          if (event.target !== event.currentTarget) return
          void save(event.nativeEvent.submitter?.value === 'generate')
        }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-head storyboard-shot-editor-head">
          <div>
            <span className="eyebrow">分镜</span>
            <h2 id="shot-editor-title">{shot.id ? '编辑镜头' : '添加镜头'}</h2>
            <p className="shot-editor-subtitle">{title} · 调整画面，试出更满意的一版</p>
          </div>
          <div className="storyboard-shot-editor-head-actions">
            <label className="shot-duration-control">
              <span>时长</span>
              <span>
                <input
                  type="number"
                  min={minDuration}
                  max="15"
                  required
                  disabled={busy}
                  value={duration}
                  aria-label="镜头时长（秒）"
                  onChange={(event) => setDuration(event.target.value)}
                />
                <em>秒</em>
              </span>
            </label>
            <IconButton label="关闭" type="button" disabled={busy} onClick={close}>
              <X size={20} />
            </IconButton>
          </div>
        </div>
        <div className="shot-editor-workspace">
          <section className="shot-editor-reference-panel">
            <ShotReferenceGallery
              images={referenceImages}
              assets={assets}
              tasks={tasks}
              disabled={busy}
              onUpload={onUpload}
              onUploading={setUploading}
              onAdd={addReferenceImages}
              onRemove={removeReferenceImage}
            />
            <fieldset className="shot-reference-video" disabled aria-label="参考视频（开发中）">
              <legend>
                参考视频 <span>开发中</span>
              </legend>
              <p>
                <Video size={20} /> 视频参考即将开放
              </p>
              <div>
                <button type="button" className="button secondary">
                  <Upload size={15} /> 本地上传
                </button>
                <button type="button" className="button secondary">
                  输入 URL
                </button>
              </div>
            </fieldset>
          </section>
          <section className="shot-editor-prompt-panel">
            <ShotAssetShortcuts
              referenceImages={referenceImages}
              shot={shot}
              assets={assets}
              tasks={tasks}
              prompt={prompt}
              disabled={busy}
              onInsert={(text) => {
                try {
                  insertPrompt(text)
                } catch (failure) {
                  setError(failure.message)
                }
              }}
            />
            <div className="shot-prompt-label">
              <label className="field-label" htmlFor="shot-visual-prompt">
                画面提示词
              </label>
              <button
                type="button"
                className="button secondary"
                disabled={busy || prompt === (shot.prompt || '')}
                onClick={() => {
                  setPrompt(shot.prompt || '')
                  setTemplateHighlights([])
                  setError('')
                }}
              >
                <RotateCcw size={14} />
                还原提示词
              </button>
            </div>
            <AssetAwareTextarea
              className="shot-editor-prompt-input"
              inputRef={promptArea}
              assets={assets}
              tasks={tasks}
              value={prompt}
              highlights={templateHighlights}
              id="shot-visual-prompt"
              maxLength={5000}
              disabled={busy}
              onChange={(event) => changePrompt(event.target.value)}
              aria-label="画面提示词"
            />
            {templateHighlights.length > 0 && (
              <span className="shot-template-legend">深绿色文字：本次引用的提示词模板</span>
            )}
            <span className="shot-prompt-count">{prompt.length.toLocaleString()} / 5,000</span>
            <ShotPromptTemplates
              title={title}
              prompt={prompt}
              disabled={busy}
              onInsert={(text) => insertPrompt(text, true)}
            >
              <ShotLibraryAssets
                projectId={projectId}
                disabled={busy}
                referenceCount={referenceImages.length}
                onImage={(image) => addReferenceImages([image])}
                onInsert={insertPrompt}
              />
            </ShotPromptTemplates>
          </section>
        </div>
        {!shot.id && (
          <label className="shot-insertion-control compact">
            <span>
              <strong>插入位置</strong>
              <em>{insertionLabel}</em>
            </span>
            <input
              type="range"
              min="0"
              max={orderedShots.length}
              step="1"
              value={insertionIndex}
              disabled={busy}
              aria-label="新分镜插入位置"
              onChange={(event) => changeInsertionIndex(event.target.value)}
            />
          </label>
        )}
        {error && (
          <p className="operation-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions shot-editor-footer">
          <span>{canGenerate ? '生成新版 18 积分 · 保留已有版本' : '保存分镜不扣积分'}</span>
          <button type="button" className="button secondary" disabled={busy} onClick={close}>
            取消
          </button>
          <button
            className={`button ${canGenerate ? 'secondary' : 'primary'}`}
            type="submit"
            value="save"
            disabled={busy}
          >
            {saving === 'save' && <LoaderCircle size={16} className="spin" />} 保存分镜
          </button>
          {canGenerate && (
            <button
              className="button primary"
              type="submit"
              value="generate"
              disabled={busy || !prompt.trim()}
            >
              {saving === 'generate' ? <LoaderCircle size={16} className="spin" /> : <Video size={16} />}{' '}
              保存并生成新版
            </button>
          )}
        </div>
      </form>
    </dialog>,
    document.body,
  )
}
