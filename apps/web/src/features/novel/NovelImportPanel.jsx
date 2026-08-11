import { useEffect, useRef, useState } from 'react'
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Eye,
  FileText,
  ListTree,
  LoaderCircle,
  RefreshCw,
  Sparkles,
  Upload,
  X,
} from 'lucide-react'
import {
  NOVEL_IMPORT_MAX_CONTENT_CHARS,
  NOVEL_IMPORT_MAX_FILE_BYTES,
  NOVEL_OPERATION_CREDITS,
  NOVEL_SPLIT_OVERLAP_CHAR_OPTIONS,
  NOVEL_SPLIT_TARGET_CHAR_OPTIONS,
} from '@seqora/contracts'
import { NovelDevelopmentPanel } from './NovelDevelopmentPanel'
import { decodeNovelFileText } from './textFileEncoding'

const MAX_CLIENT_FILE_LABEL = '5.66MB'
const INITIAL_VISIBLE_CHAPTERS = 3
const CHAPTER_PREVIEW_COLLAPSED_CHARS = 220
const ADAPTATION_TARGET_SECONDS_OPTIONS = [30, 60, 90, 120, 180]
const ADAPTATION_MODE_OPTIONS = [
  ['scene', '镜头场次'],
  ['opening', '开场钩子'],
  ['summary', '概要改编'],
]
const SPLIT_MODE_LABELS = {
  auto: '自动识别',
  heading: '规则章节',
  fixed: '固定分块',
}

export function NovelImportPanel({
  project,
  aspectRatio,
  disabled,
  developmentOnly = false,
  onImportNovel,
  onPreviewNovelSplit,
  onListNovels,
  onGetNovel,
  onGetNovelSummaries,
  onGenerateNovelSummaries,
  onGetNovelStoryBible,
  onGenerateNovelStoryBible,
  onSuggestNovelAssets,
  onGenerateChapterAdaptation,
  onCreateAsset,
  onImportAssets,
  onUpload,
  onUseAdaptedScript,
}) {
  const fileInput = useRef(null)
  const [name, setName] = useState(`${project.name} 原著`)
  const [fileName, setFileName] = useState('')
  const [format, setFormat] = useState('txt')
  const [encoding, setEncoding] = useState('')
  const [content, setContent] = useState('')
  const [splitMode, setSplitMode] = useState('auto')
  const [targetChars, setTargetChars] = useState(6_000)
  const [overlapChars, setOverlapChars] = useState(300)
  const [documents, setDocuments] = useState([])
  const [previewResult, setPreviewResult] = useState(null)
  const [result, setResult] = useState(null)
  const [visibleChapterCount, setVisibleChapterCount] = useState(INITIAL_VISIBLE_CHAPTERS)
  const [expandedChapterIds, setExpandedChapterIds] = useState(() => new Set())
  const [chapterBrowserOpen, setChapterBrowserOpen] = useState(false)
  const [selectedChapterIds, setSelectedChapterIds] = useState(() => new Set())
  const [adaptationTargetSeconds, setAdaptationTargetSeconds] = useState(60)
  const [adaptationMode, setAdaptationMode] = useState('scene')
  const [adaptationResult, setAdaptationResult] = useState(null)
  const [adaptationStatus, setAdaptationStatus] = useState('idle')
  const [adaptationError, setAdaptationError] = useState('')
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState('')

  const characterCount = content.replace(/\s/g, '').length
  const isImporting = status === 'importing'
  const isPreviewing = status === 'previewing'
  const isLoadingDocuments = status === 'loading-documents'
  const isAdapting = adaptationStatus === 'adapting'
  const isWritingAdaptedScript = adaptationStatus === 'writing'
  const hasContent = content.trim().length > 0
  const moduleDisabled = Boolean(disabled || developmentOnly)
  const controlsDisabled =
    moduleDisabled || isImporting || isPreviewing || isAdapting || isWritingAdaptedScript

  useEffect(() => {
    let cancelled = false
    setName(`${project.name} 原著`)
    setFileName('')
    setFormat('txt')
    setEncoding('')
    setContent('')
    setSplitMode('auto')
    setTargetChars(6_000)
    setOverlapChars(300)
    setPreviewResult(null)
    setResult(null)
    setVisibleChapterCount(INITIAL_VISIBLE_CHAPTERS)
    setExpandedChapterIds(new Set())
    setChapterBrowserOpen(false)
    setSelectedChapterIds(new Set())
    setAdaptationTargetSeconds(60)
    setAdaptationMode('scene')
    setAdaptationResult(null)
    setAdaptationStatus('idle')
    setAdaptationError('')
    setError('')
    if (developmentOnly) {
      setDocuments([])
      setStatus('idle')
      return undefined
    }
    setStatus('loading-documents')
    onListNovels()
      .then((nextDocuments) => {
        if (!cancelled) setDocuments(nextDocuments)
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError.message)
      })
      .finally(() => {
        if (!cancelled) setStatus('idle')
      })
    return () => {
      cancelled = true
    }
  }, [developmentOnly, project.id, project.name])

  useEffect(() => {
    setAdaptationResult(null)
    setAdaptationError('')
    setAdaptationStatus('idle')
    if (!result?.chapters?.length) {
      setSelectedChapterIds(new Set())
      return
    }
    setSelectedChapterIds(new Set([result.chapters[0].id]))
  }, [result?.document.id])

  const resetSplitOutcome = () => {
    setPreviewResult(null)
    setResult(null)
    setVisibleChapterCount(INITIAL_VISIBLE_CHAPTERS)
    setExpandedChapterIds(new Set())
    setChapterBrowserOpen(false)
    setSelectedChapterIds(new Set())
    setAdaptationResult(null)
    setAdaptationError('')
    setAdaptationStatus('idle')
  }

  const buildNovelPayload = (clientRequestId) => ({
    ...(clientRequestId ? { clientRequestId } : {}),
    name: name.trim() || fileName || `${project.name} 原著`,
    format,
    splitOptions: {
      mode: splitMode,
      targetChars,
      overlapChars,
    },
    content,
  })

  const handleFileSelected = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    setError('')
    resetSplitOutcome()
    try {
      if (file.size > NOVEL_IMPORT_MAX_FILE_BYTES) {
        throw new Error(`小说文件超过 ${MAX_CLIENT_FILE_LABEL}，请先拆成多个文件再导入`)
      }
      const decoded = decodeNovelFileText(await file.arrayBuffer())
      const text = decoded.text
      if (text.length > NOVEL_IMPORT_MAX_CONTENT_CHARS) {
        throw new Error(`小说正文超过 ${MAX_CLIENT_FILE_LABEL} 对应的处理上限，请先拆成多个文件再导入`)
      }
      const nextFormat = file.name.toLowerCase().endsWith('.md') ? 'markdown' : 'txt'
      setFileName(file.name)
      setFormat(nextFormat)
      setEncoding(decoded.encoding)
      setContent(text)
      setName((current) => {
        if (current.trim() && current !== `${project.name} 原著`) return current
        return file.name.replace(/\.(txt|md|markdown)$/iu, '').slice(0, 120) || `${project.name} 原著`
      })
    } catch (fileError) {
      setError(fileError.message)
    } finally {
      event.target.value = ''
    }
  }

  const handlePreviewSplit = async () => {
    if (!hasContent) {
      setError('请先选择 TXT 或 Markdown 小说文件')
      return
    }
    setStatus('previewing')
    setError('')
    try {
      const preview = await onPreviewNovelSplit(buildNovelPayload())
      setPreviewResult(preview)
      setResult(null)
      setVisibleChapterCount(INITIAL_VISIBLE_CHAPTERS)
      setExpandedChapterIds(new Set())
      setChapterBrowserOpen(false)
    } catch (previewError) {
      setError(previewError.message)
    } finally {
      setStatus('idle')
    }
  }

  const handleImport = async () => {
    if (!hasContent) {
      setError('请先选择 TXT 或 Markdown 小说文件')
      return
    }
    if (!previewResult?.coveragePassed) {
      setError('请先完成切分预览并通过覆盖校验')
      return
    }
    setStatus('importing')
    setError('')
    try {
      const imported = await onImportNovel(buildNovelPayload(crypto.randomUUID()))
      setResult(imported)
      setPreviewResult(null)
      setVisibleChapterCount(INITIAL_VISIBLE_CHAPTERS)
      setExpandedChapterIds(new Set())
      setChapterBrowserOpen(false)
      setDocuments((current) => [
        imported.document,
        ...current.filter((document) => document.id !== imported.document.id),
      ])
    } catch (importError) {
      setError(importError.message)
    } finally {
      setStatus('idle')
    }
  }

  const handleViewDocument = async (documentId) => {
    setStatus('loading-documents')
    setError('')
    try {
      setResult(await onGetNovel(documentId))
      setVisibleChapterCount(INITIAL_VISIBLE_CHAPTERS)
      setExpandedChapterIds(new Set())
      setChapterBrowserOpen(false)
    } catch (viewError) {
      setError(viewError.message)
    } finally {
      setStatus('idle')
    }
  }

  const activeSplit = result
    ? {
        state: 'imported',
        name: result.document.name,
        characterCount: result.document.characterCount,
        chapterCount: result.document.chapterCount,
        coveragePassed: true,
        warnings: [],
        chapters: result.chapters,
      }
    : previewResult
      ? {
          state: 'preview',
          name: previewResult.name,
          characterCount: previewResult.characterCount,
          chapterCount: previewResult.chapterCount,
          coveragePassed: previewResult.coveragePassed,
          warnings: previewResult.warnings,
          chapters: previewResult.chapters,
        }
      : null
  const visibleChapters = activeSplit?.chapters.slice(0, visibleChapterCount) ?? []
  const selectedChapters = result?.chapters.filter((chapter) => selectedChapterIds.has(chapter.id)) ?? []
  const effectiveSplitMode =
    result?.chapters[0]?.splitMode ??
    previewResult?.splitMode ??
    previewResult?.chapters[0]?.splitMode ??
    splitMode

  const toggleChapterPreview = (chapterId) => {
    setExpandedChapterIds((current) => {
      const next = new Set(current)
      if (next.has(chapterId)) next.delete(chapterId)
      else next.add(chapterId)
      return next
    })
  }

  const toggleChapterSelection = (chapterId) => {
    setSelectedChapterIds((current) => {
      const next = new Set(current)
      if (next.has(chapterId)) {
        next.delete(chapterId)
      } else {
        if (next.size >= 6) {
          setAdaptationError('一次最多选择 6 个章节')
          return current
        }
        next.add(chapterId)
      }
      setAdaptationError('')
      return next
    })
    setAdaptationResult(null)
  }

  const handleGenerateChapterAdaptation = async () => {
    if (!result || !onGenerateChapterAdaptation) return
    if (!selectedChapters.length) {
      setAdaptationError('请先选择至少一个章节')
      return
    }
    setAdaptationStatus('adapting')
    setAdaptationError('')
    try {
      const adaptation = await onGenerateChapterAdaptation(result.document.id, {
        clientRequestId: crypto.randomUUID(),
        chapterIds: selectedChapters.map((chapter) => chapter.id),
        targetSeconds: adaptationTargetSeconds,
        mode: adaptationMode,
      })
      setAdaptationResult(adaptation)
    } catch (adaptError) {
      setAdaptationError(adaptError.message)
    } finally {
      setAdaptationStatus('idle')
    }
  }

  const handleUseAdaptedScript = async () => {
    if (!adaptationResult?.script || !onUseAdaptedScript) return
    setAdaptationStatus('writing')
    setAdaptationError('')
    try {
      await onUseAdaptedScript(adaptationResult.script, adaptationResult)
    } catch (writeError) {
      setAdaptationError(writeError.message)
    } finally {
      setAdaptationStatus('idle')
    }
  }

  return (
    <section
      className={`novel-import-panel${developmentOnly ? ' is-development-only' : ''}`}
      data-development-only={developmentOnly ? 'true' : 'false'}
      aria-disabled={developmentOnly || undefined}
    >
      <div className="novel-import-head">
        <div className="novel-import-title">
          <span className="novel-import-symbol">
            <BookOpen size={17} />
          </span>
          <div>
            <span className="eyebrow">小说改编</span>
            <h2>小说上传与章节切分</h2>
          </div>
        </div>
        <p>导入长篇小说原文，先把章节边界整理出来，再进入后续摘要、故事概要和剧本改编。</p>
      </div>

      {developmentOnly && (
        <div className="novel-development-banner" role="status">
          <BookOpen size={15} />
          <div>
            <strong>小说上传与章节功能开发中</strong>
            <span>当前仅展示规划布局，上传、切分、章节选择和视频改编暂未开放。</span>
          </div>
        </div>
      )}

      <div className="novel-import-grid">
        <button
          className="novel-file-button"
          type="button"
          disabled={controlsDisabled}
          onClick={() => fileInput.current?.click()}
        >
          <Upload size={18} />
          <strong>{fileName || '选择小说文件'}</strong>
          <span>
            {fileName
              ? `${format.toUpperCase()} · ${characterCount} 字 · ${encoding.toUpperCase()}`
              : 'TXT / Markdown'}
          </span>
        </button>
        <input
          ref={fileInput}
          className="hidden-input"
          type="file"
          disabled={controlsDisabled}
          accept=".txt,.md,.markdown,text/plain,text/markdown"
          onChange={handleFileSelected}
        />
        <label className="novel-name-field">
          <span>作品名称</span>
          <input
            value={name}
            disabled={controlsDisabled}
            maxLength={120}
            onChange={(event) => {
              resetSplitOutcome()
              setName(event.target.value)
            }}
          />
        </label>
        <button
          className="button primary novel-import-action"
          disabled={controlsDisabled || !hasContent}
          onClick={() => void handlePreviewSplit()}
        >
          {isPreviewing ? <LoaderCircle size={16} className="spin" /> : <Eye size={16} />}
          {isPreviewing ? '正在预览' : '预览切分'}
        </button>
      </div>

      <div className="novel-split-settings">
        <label>
          <span>切分方式</span>
          <select
            value={splitMode}
            disabled={controlsDisabled}
            onChange={(event) => {
              resetSplitOutcome()
              setSplitMode(event.target.value)
            }}
          >
            <option value="auto">自动识别</option>
            <option value="heading">规则章节</option>
            <option value="fixed">固定分块</option>
          </select>
        </label>
        <label>
          <span>分块大小</span>
          <select
            value={targetChars}
            disabled={controlsDisabled}
            onChange={(event) => {
              resetSplitOutcome()
              setTargetChars(Number(event.target.value))
            }}
          >
            {NOVEL_SPLIT_TARGET_CHAR_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {value} 字
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>自动重叠</span>
          <select
            value={overlapChars}
            disabled={controlsDisabled}
            onChange={(event) => {
              resetSplitOutcome()
              setOverlapChars(Number(event.target.value))
            }}
          >
            {NOVEL_SPLIT_OVERLAP_CHAR_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {value} 字
              </option>
            ))}
          </select>
        </label>
        <small>长章节会按目标字数继续分块，原文不改写，重叠只作为后续摘要上下文。</small>
      </div>

      {hasContent && !activeSplit && (
        <div className="novel-local-preview">
          <FileText size={15} />
          <span>{content.replace(/\s+/g, ' ').trim().slice(0, 140)}</span>
        </div>
      )}

      {activeSplit && (
        <div className="novel-result">
          <div className="novel-result-summary">
            <div>
              <span className="eyebrow">{activeSplit.state === 'imported' ? '已导入' : '预览切分'}</span>
              <strong>{activeSplit.name}</strong>
            </div>
            <div>
              <span>{activeSplit.characterCount} 字</span>
              <span>{activeSplit.chapterCount} 章/段</span>
              <span>{SPLIT_MODE_LABELS[effectiveSplitMode] ?? '自动识别'}</span>
              {activeSplit.coveragePassed && <span>覆盖校验通过</span>}
            </div>
          </div>
          {activeSplit.warnings.length > 0 && (
            <div className="novel-split-warnings">
              {activeSplit.warnings.map((warning) => (
                <span key={warning}>{warning}</span>
              ))}
            </div>
          )}
          {previewResult && !result && (
            <div className="novel-preview-approval">
              <div>
                <CheckCircle2 size={16} />
                <span>预览 ID {previewResult.previewId} · 确认后才会写入项目</span>
              </div>
              <button
                className="button primary"
                type="button"
                disabled={controlsDisabled || !previewResult.coveragePassed}
                onClick={() => void handleImport()}
              >
                {isImporting ? <LoaderCircle size={16} className="spin" /> : <ListTree size={16} />}
                {isImporting ? '正在导入' : '确认导入'}
              </button>
            </div>
          )}
          {result && (
            <div className="novel-adaptation-panel" aria-busy={isAdapting || isWritingAdaptedScript}>
              <div className="novel-adaptation-head">
                <div>
                  <span className="eyebrow">章节改编入口</span>
                  <strong>选择章节 → 生成视频改编剧本 → 写入剧本页</strong>
                </div>
                <span>{selectedChapters.length} / 6 章</span>
              </div>
              <div className="novel-adaptation-controls">
                <label>
                  <span>目标时长</span>
                  <select
                    value={adaptationTargetSeconds}
                    disabled={controlsDisabled}
                    onChange={(event) => {
                      setAdaptationTargetSeconds(Number(event.target.value))
                      setAdaptationResult(null)
                    }}
                  >
                    {ADAPTATION_TARGET_SECONDS_OPTIONS.map((seconds) => (
                      <option key={seconds} value={seconds}>
                        {seconds} 秒
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>改编模式</span>
                  <select
                    value={adaptationMode}
                    disabled={controlsDisabled}
                    onChange={(event) => {
                      setAdaptationMode(event.target.value)
                      setAdaptationResult(null)
                    }}
                  >
                    {ADAPTATION_MODE_OPTIONS.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="button primary"
                  type="button"
                  disabled={
                    controlsDisabled ||
                    !selectedChapters.length ||
                    !onGenerateChapterAdaptation ||
                    isWritingAdaptedScript
                  }
                  onClick={() => void handleGenerateChapterAdaptation()}
                >
                  {isAdapting ? (
                    <LoaderCircle size={16} className="spin" />
                  ) : adaptationResult ? (
                    <RefreshCw size={16} />
                  ) : (
                    <Sparkles size={16} />
                  )}
                  {isAdapting
                    ? '正在生成改编'
                    : `${adaptationResult ? '重新生成' : '生成视频改编剧本'} · ${NOVEL_OPERATION_CREDITS.chapterAdaptation} 积分`}
                </button>
              </div>
              {adaptationResult && (
                <div className="novel-adaptation-result">
                  <div>
                    <strong>已生成改编剧本</strong>
                    <span>
                      {adaptationResult.chapters.length} 章 · {adaptationResult.targetSeconds} 秒 ·
                      可继续资产建议/分镜
                    </span>
                  </div>
                  <pre>{adaptationResult.script.slice(0, 900)}</pre>
                  {adaptationResult.warnings?.length > 0 && (
                    <div className="novel-adaptation-warnings">
                      {adaptationResult.warnings.map((warning) => (
                        <span key={warning}>{warning}</span>
                      ))}
                    </div>
                  )}
                  <button
                    className="button secondary"
                    type="button"
                    disabled={disabled || isWritingAdaptedScript || !onUseAdaptedScript}
                    onClick={() => void handleUseAdaptedScript()}
                  >
                    {isWritingAdaptedScript ? (
                      <LoaderCircle size={16} className="spin" />
                    ) : (
                      <ArrowRight size={16} />
                    )}
                    {isWritingAdaptedScript ? '正在写入剧本页' : '写入剧本页并继续资产建议'}
                  </button>
                </div>
              )}
              {adaptationError && (
                <p className="operation-error novel-import-error" role="alert">
                  {adaptationError}
                </p>
              )}
            </div>
          )}
          <div className="novel-chapter-list">
            {visibleChapters.map((chapter) => {
              const expanded = expandedChapterIds.has(chapter.id)
              const preview = chapter.preview || '本章暂无预览'
              const collapsed =
                preview.length > CHAPTER_PREVIEW_COLLAPSED_CHARS
                  ? `${preview.slice(0, CHAPTER_PREVIEW_COLLAPSED_CHARS)}...`
                  : preview
              const canExpand = preview.length > CHAPTER_PREVIEW_COLLAPSED_CHARS || chapter.previewTruncated
              const selected = selectedChapterIds.has(chapter.id)
              return (
                <article
                  key={chapter.id}
                  className={[expanded ? 'expanded' : '', selected ? 'selected' : '']
                    .filter(Boolean)
                    .join(' ')}
                >
                  <div>
                    {result && (
                      <label className="novel-chapter-select">
                        <input
                          type="checkbox"
                          checked={selected}
                          disabled={controlsDisabled}
                          onChange={() => toggleChapterSelection(chapter.id)}
                        />
                        <span>选择</span>
                      </label>
                    )}
                    <strong>
                      {String(chapter.order).padStart(2, '0')} · {chapter.title}
                    </strong>
                    <span>{chapter.characterCount} 字</span>
                  </div>
                  <p>{expanded ? preview : collapsed}</p>
                  <div className="novel-chapter-actions">
                    <small>
                      {chapter.crossesChapterBoundary
                        ? '跨章节'
                        : chapter.sourceChapterTitle
                          ? `所属：${chapter.sourceChapterTitle}`
                          : '所属章节待识别'}
                      {' · '}
                      {chapter.sourceStartOffset}-{chapter.sourceEndOffset}
                      {chapter.overlapBeforeChars || chapter.overlapAfterChars
                        ? ` · 重叠 ${chapter.overlapBeforeChars}/${chapter.overlapAfterChars}`
                        : ''}
                      {chapter.previewTruncated ? ' · 仅展示前 3000 字' : ''}
                    </small>
                    {canExpand && (
                      <button type="button" onClick={() => toggleChapterPreview(chapter.id)}>
                        {expanded ? '收起预览' : '展开预览'}
                      </button>
                    )}
                  </div>
                </article>
              )
            })}
          </div>
          {activeSplit.chapters.length > visibleChapters.length && (
            <button type="button" className="novel-result-more" onClick={() => setChapterBrowserOpen(true)}>
              查看全部 {activeSplit.chapters.length} 章/分块
            </button>
          )}
        </div>
      )}

      {chapterBrowserOpen && activeSplit && (
        <div className="novel-browser-backdrop" role="presentation">
          <section className="novel-browser-modal" role="dialog" aria-modal="true" aria-label="全部章节预览">
            <div className="novel-browser-head">
              <div>
                <span className="eyebrow">
                  {activeSplit.state === 'imported' ? '已导入章节' : '切分预览'}
                </span>
                <h3>{activeSplit.name}</h3>
                <p>
                  共 {activeSplit.chapters.length} 章/分块 · 页面仅保留前 {INITIAL_VISIBLE_CHAPTERS}{' '}
                  个卡片，完整内容在这里浏览
                </p>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label="关闭章节预览"
                onClick={() => setChapterBrowserOpen(false)}
              >
                <X size={17} />
              </button>
            </div>
            <div className="novel-browser-list novel-browser-list-chapters">
              {activeSplit.chapters.map((chapter) => {
                const selected = selectedChapterIds.has(chapter.id)
                const preview = chapter.preview || '本章暂无预览'
                return (
                  <article key={chapter.id} className={selected ? 'selected' : ''}>
                    <div className="novel-browser-card-head">
                      {result && (
                        <label className="novel-chapter-select">
                          <input
                            type="checkbox"
                            checked={selected}
                            disabled={controlsDisabled}
                            onChange={() => toggleChapterSelection(chapter.id)}
                          />
                          <span>选择</span>
                        </label>
                      )}
                      <strong>
                        {String(chapter.order).padStart(2, '0')} · {chapter.title}
                      </strong>
                      <span>{chapter.characterCount} 字</span>
                    </div>
                    <p>{preview}</p>
                    <small>
                      {chapter.crossesChapterBoundary
                        ? '跨章节'
                        : chapter.sourceChapterTitle
                          ? `所属：${chapter.sourceChapterTitle}`
                          : '所属章节待识别'}
                      {' · '}
                      {chapter.sourceStartOffset}-{chapter.sourceEndOffset}
                      {chapter.overlapBeforeChars || chapter.overlapAfterChars
                        ? ` · 重叠 ${chapter.overlapBeforeChars}/${chapter.overlapAfterChars}`
                        : ''}
                      {chapter.previewTruncated ? ' · 仅展示前 3000 字' : ''}
                    </small>
                  </article>
                )
              })}
            </div>
          </section>
        </div>
      )}

      <div className="novel-document-strip" aria-busy={isLoadingDocuments}>
        <span>已导入</span>
        {isLoadingDocuments ? (
          <small>
            <LoaderCircle size={13} className="spin" /> 加载中
          </small>
        ) : documents.length ? (
          documents.slice(0, 4).map((document) => (
            <button key={document.id} type="button" onClick={() => void handleViewDocument(document.id)}>
              {document.name} · {document.chapterCount} 章
            </button>
          ))
        ) : (
          <small>暂无小说文件</small>
        )}
      </div>

      {error && (
        <p className="operation-error novel-import-error" role="alert">
          {error}
        </p>
      )}

      {result && (
        <NovelDevelopmentPanel
          document={result.document}
          disabled={moduleDisabled}
          onGetSummaries={onGetNovelSummaries}
          onGenerateSummaries={onGenerateNovelSummaries}
          onGetStoryBible={onGetNovelStoryBible}
          onGenerateStoryBible={onGenerateNovelStoryBible}
          onSuggestAssets={onSuggestNovelAssets}
          aspectRatio={aspectRatio}
          onUpload={onUpload}
          onCreateAsset={onCreateAsset}
          onImportAssets={onImportAssets}
        />
      )}
    </section>
  )
}
