import {
  ChevronLeft,
  ChevronRight,
  Check,
  Download,
  Copy,
  FileText,
  ImagePlus,
  LoaderCircle,
  BookmarkPlus,
  Minus,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { downloadImage, downloadImagesAsZip } from './imageDownload'

export function ImagePreviewModal({
  image: singleImage,
  images: providedImages,
  currentIndex = 0,
  onNavigate,
  onClose,
  onRedo,
  onEdit,
  onUseAsReference,
  onDelete,
  onDownloadGroup,
  groupFileName = '序幕-image2-结果',
  batchPrompt = '',
  batchOriginalPrompt = '',
}) {
  const MIN_ZOOM = 0.5
  const MAX_ZOOM = 3
  const ZOOM_STEP = 0.25
  const images = providedImages?.length ? providedImages : singleImage ? [singleImage] : []
  const activeIndex = Math.min(Math.max(currentIndex, 0), Math.max(images.length - 1, 0))
  const image = images[activeIndex]
  const [zoom, setZoom] = useState(1)
  const [downloadMode, setDownloadMode] = useState(null)
  const [actionMode, setActionMode] = useState(null)
  const [message, setMessage] = useState(null)
  const [dragging, setDragging] = useState(false)
  const [showPromptPanel, setShowPromptPanel] = useState(false)
  const [copiedPromptKey, setCopiedPromptKey] = useState(null)
  const [copyingPromptKey, setCopyingPromptKey] = useState(null)
  const canvasRef = useRef(null)
  const mediaRef = useRef(null)
  const dragRef = useRef(null)
  const zoomAnchorRef = useRef(null)
  const hasPromptInfo = Boolean(batchPrompt || batchOriginalPrompt)
  const promptPanelId = 'image-preview-prompt-panel'

  const clampZoom = (value) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value))

  const captureZoomAnchor = (clientX, clientY) => {
    const canvas = canvasRef.current
    const media = mediaRef.current
    if (!canvas || !media) return null

    const mediaWidth = media.offsetWidth
    const mediaHeight = media.offsetHeight
    if (!mediaWidth || !mediaHeight) return null

    const canvasRect = canvas.getBoundingClientRect()
    const localX = canvas.scrollLeft + (clientX - canvasRect.left)
    const localY = canvas.scrollTop + (clientY - canvasRect.top)

    return {
      clientX,
      clientY,
      focusX: (localX - media.offsetLeft) / mediaWidth,
      focusY: (localY - media.offsetTop) / mediaHeight,
    }
  }

  const getCanvasCenter = () => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    return {
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
    }
  }

  const applyZoom = (updater, clientX, clientY) => {
    const anchor = captureZoomAnchor(clientX, clientY)
    setZoom((currentZoom) => {
      const nextZoom = clampZoom(updater(currentZoom))
      if (nextZoom === currentZoom) {
        zoomAnchorRef.current = null
        return currentZoom
      }
      zoomAnchorRef.current = anchor
      return nextZoom
    })
  }

  const navigate = (delta) => {
    if (!onNavigate || images.length < 2) return
    const nextIndex = Math.min(Math.max(activeIndex + delta, 0), images.length - 1)
    if (nextIndex !== activeIndex) {
      setMessage(null)
      onNavigate(nextIndex)
    }
  }

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        if (showPromptPanel) {
          setShowPromptPanel(false)
          return
        }
        onClose()
      }
      if (event.key === 'ArrowLeft') navigate(-1)
      if (event.key === 'ArrowRight') navigate(1)
    }
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose, activeIndex, images.length, onNavigate, showPromptPanel])

  useEffect(() => {
    setZoom(1)
    setMessage(null)
    setShowPromptPanel(false)
    setCopiedPromptKey(null)
    setCopyingPromptKey(null)
    zoomAnchorRef.current = null
    requestAnimationFrame(() => {
      const canvas = canvasRef.current
      if (!canvas) return
      canvas.scrollLeft = Math.max(0, (canvas.scrollWidth - canvas.clientWidth) / 2)
      canvas.scrollTop = Math.max(0, (canvas.scrollHeight - canvas.clientHeight) / 2)
    })
  }, [image?.url])

  useEffect(() => {
    if (!copiedPromptKey) return undefined
    const timer = window.setTimeout(() => setCopiedPromptKey(null), 1400)
    return () => window.clearTimeout(timer)
  }, [copiedPromptKey])

  useEffect(() => {
    const anchor = zoomAnchorRef.current
    if (!anchor) return undefined
    zoomAnchorRef.current = null
    requestAnimationFrame(() => {
      const canvas = canvasRef.current
      const media = mediaRef.current
      if (!canvas || !media) return
      const canvasRect = canvas.getBoundingClientRect()
      const nextScrollLeft =
        media.offsetLeft + media.offsetWidth * anchor.focusX - (anchor.clientX - canvasRect.left)
      const nextScrollTop =
        media.offsetTop + media.offsetHeight * anchor.focusY - (anchor.clientY - canvasRect.top)
      const maxScrollLeft = Math.max(0, canvas.scrollWidth - canvas.clientWidth)
      const maxScrollTop = Math.max(0, canvas.scrollHeight - canvas.clientHeight)
      canvas.scrollLeft = Math.min(maxScrollLeft, Math.max(0, nextScrollLeft))
      canvas.scrollTop = Math.min(maxScrollTop, Math.max(0, nextScrollTop))
    })
  }, [zoom])

  if (!image) return null

  const handleDownload = async () => {
    setDownloadMode('single')
    setMessage(null)
    try {
      const result = await downloadImage(image.url, image.fileName || image.alt || '资产图片')
      setMessage({
        type: result.duplicate ? 'warning' : 'success',
        text: result.duplicate
          ? `已开始下载 ${result.fileName}。检测到本浏览器曾下载过同名文件，浏览器可能会自动追加编号。`
          : `已开始下载 ${result.fileName}。`,
      })
    } catch (downloadError) {
      setMessage({
        type: 'error',
        text: downloadError instanceof Error ? downloadError.message : '图片下载失败，请稍后重试',
      })
    } finally {
      setDownloadMode(null)
    }
  }

  const handleDownloadGroup = async () => {
    setDownloadMode('group')
    setMessage(null)
    try {
      const result = onDownloadGroup
        ? await onDownloadGroup(images)
        : await downloadImagesAsZip(images, groupFileName)
      setMessage({
        type: result.failedCount ? 'warning' : 'success',
        text: result.failedCount
          ? `已打包 ${result.successCount} 张图片，另有 ${result.failedCount} 张暂时无法读取。`
          : `已打包 ${result.successCount} 张图片，开始下载 ${result.fileName}。`,
      })
    } catch (downloadError) {
      setMessage({
        type: 'error',
        text: downloadError instanceof Error ? downloadError.message : '整组下载失败，请稍后重试',
      })
    } finally {
      setDownloadMode(null)
    }
  }

  const runImageAction = async (mode, callback) => {
    setActionMode(mode)
    setMessage(null)
    try {
      await callback(image)
      onClose()
    } catch (actionError) {
      setMessage({
        type: 'error',
        text: actionError instanceof Error ? actionError.message : '操作失败，请稍后重试',
      })
    } finally {
      setActionMode(null)
    }
  }

  const handleDelete = () => {
    if (!onDelete) return
    if (!window.confirm('删除当前图片？图片会从结果记录中移除，已消耗积分不会退回。')) return
    void runImageAction('delete', onDelete)
  }

  const handleCopyPrompt = async (text, key) => {
    const promptText = typeof text === 'string' ? text : ''
    if (!promptText.trim()) {
      setMessage({
        type: 'warning',
        text: '提示词为空，无法复制。',
      })
      return
    }
    setCopyingPromptKey(key)
    setMessage(null)
    try {
      const copied = await copyTextToClipboard(promptText)
      if (!copied) {
        throw new Error('复制失败，请重试')
      }
      setCopiedPromptKey(key)
    } catch (copyError) {
      setCopiedPromptKey(null)
      setMessage({
        type: 'error',
        text: copyError instanceof Error ? copyError.message : '复制失败，请重试',
      })
    } finally {
      setCopyingPromptKey(null)
    }
  }

  const handlePointerDown = (event) => {
    if (zoom <= 1 || event.button !== 0 || event.target?.closest?.('button')) return
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.setPointerCapture?.(event.pointerId)
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: canvas.scrollLeft,
      scrollTop: canvas.scrollTop,
    }
    setDragging(true)
  }

  const handlePointerMove = (event) => {
    const drag = dragRef.current
    const canvas = canvasRef.current
    if (!drag || drag.pointerId !== event.pointerId || !canvas) return
    canvas.scrollLeft = drag.scrollLeft - (event.clientX - drag.startX)
    canvas.scrollTop = drag.scrollTop - (event.clientY - drag.startY)
  }

  const stopDragging = (event) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    canvasRef.current?.releasePointerCapture?.(event.pointerId)
    dragRef.current = null
    setDragging(false)
  }

  const handleWheel = (event) => {
    if (event.target?.closest?.('button')) return
    event.preventDefault()
    const step = Math.max(0.08, Math.min(ZOOM_STEP, Math.abs(event.deltaY) / 240))
    const direction = event.deltaY > 0 ? -1 : 1
    const anchor = captureZoomAnchor(event.clientX, event.clientY)
    setZoom((currentZoom) => {
      const nextZoom = clampZoom(currentZoom + direction * step)
      if (nextZoom === currentZoom) {
        zoomAnchorRef.current = null
        return currentZoom
      }
      zoomAnchorRef.current = anchor
      return nextZoom
    })
  }

  const isBusy = Boolean(downloadMode || actionMode)
  const zoomPercent = Math.round(zoom * 100)

  return createPortal(
    <div
      className="image-preview-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={`${image.alt || '资产图片'}预览`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="image-preview-dialog" onMouseDown={(event) => event.stopPropagation()}>
        <header className="image-preview-head">
          <div>
            <span className="eyebrow">图片预览</span>
            <strong>{image.alt || '资产图片'}</strong>
          </div>
          <button
            className="image-preview-close"
            type="button"
            aria-label="关闭预览"
            title="关闭"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>

        <div className="image-preview-commandbar" role="toolbar" aria-label="图片操作">
          <div className="image-preview-command-group">
            {onRedo && (
              <button
                className="button secondary"
                type="button"
                disabled={isBusy}
                onClick={() => runImageAction('redo', onRedo)}
              >
                {actionMode === 'redo' ? (
                  <LoaderCircle size={15} className="spin" />
                ) : (
                  <RefreshCw size={15} />
                )}
                {actionMode === 'redo' ? '重做中' : '按原参数重做'}
              </button>
            )}
            {onEdit && (
              <button
                className="button secondary"
                type="button"
                disabled={isBusy}
                onClick={() => runImageAction('edit', onEdit)}
              >
                {actionMode === 'edit' ? (
                  <LoaderCircle size={15} className="spin" />
                ) : (
                  <ImagePlus size={15} />
                )}
                {actionMode === 'edit' ? '准备中' : '作为主体编辑'}
              </button>
            )}
            {onUseAsReference && (
              <button
                className="button secondary"
                type="button"
                disabled={isBusy}
                onClick={() => runImageAction('reference', onUseAsReference)}
              >
                {actionMode === 'reference' ? (
                  <LoaderCircle size={15} className="spin" />
                ) : (
                  <BookmarkPlus size={15} />
                )}
                {actionMode === 'reference' ? '准备中' : '设为引用图'}
              </button>
            )}
            <button className="button secondary" type="button" disabled={isBusy} onClick={handleDownload}>
              {downloadMode === 'single' ? (
                <LoaderCircle size={15} className="spin" />
              ) : (
                <Download size={15} />
              )}
              {downloadMode === 'single' ? '下载中' : '下载当前'}
            </button>
            {images.length > 1 && (
              <button
                className="button secondary"
                type="button"
                disabled={isBusy}
                onClick={handleDownloadGroup}
              >
                {downloadMode === 'group' ? (
                  <LoaderCircle size={15} className="spin" />
                ) : (
                  <Download size={15} />
                )}
                {downloadMode === 'group' ? '打包中' : '下载整组'}
              </button>
            )}
            {onDelete && (
              <button
                className="button secondary danger"
                type="button"
                disabled={isBusy}
                onClick={handleDelete}
              >
                {actionMode === 'delete' ? <LoaderCircle size={15} className="spin" /> : <Trash2 size={15} />}
                {actionMode === 'delete' ? '删除中' : '删除图片'}
              </button>
            )}
            {hasPromptInfo && (
              <button
                className="button secondary image-preview-prompt-toggle"
                type="button"
                disabled={isBusy}
                aria-expanded={showPromptPanel}
                aria-controls={promptPanelId}
                onClick={() => setShowPromptPanel((current) => !current)}
              >
                <FileText size={15} />
                {showPromptPanel ? '隐藏提示词' : '查看提示词'}
              </button>
            )}
          </div>

          <div className="image-preview-zoom-controls" aria-label="缩放">
            <button
              className="image-preview-icon-button"
              type="button"
              aria-label="缩小"
              title="缩小"
              disabled={isBusy || zoom <= MIN_ZOOM}
              onClick={() => {
                const center = getCanvasCenter()
                if (!center) {
                  setZoom((value) => Math.max(MIN_ZOOM, value - ZOOM_STEP))
                  return
                }
                applyZoom((value) => value - ZOOM_STEP, center.clientX, center.clientY)
              }}
            >
              <Minus size={15} />
            </button>
            <button
              className="image-preview-zoom-reset"
              type="button"
              disabled={isBusy}
              onClick={() => {
                const center = getCanvasCenter()
                if (!center) {
                  setZoom(1)
                  return
                }
                applyZoom(() => 1, center.clientX, center.clientY)
              }}
            >
              {zoomPercent}%
            </button>
            <button
              className="image-preview-icon-button"
              type="button"
              aria-label="放大"
              title="放大"
              disabled={isBusy || zoom >= MAX_ZOOM}
              onClick={() => {
                const center = getCanvasCenter()
                if (!center) {
                  setZoom((value) => Math.min(MAX_ZOOM, value + ZOOM_STEP))
                  return
                }
                applyZoom((value) => value + ZOOM_STEP, center.clientX, center.clientY)
              }}
            >
              <Plus size={15} />
            </button>
            <button
              className="image-preview-icon-button"
              type="button"
              aria-label="重置缩放"
              title="重置缩放"
              disabled={isBusy || zoom === 1}
              onClick={() => {
                const center = getCanvasCenter()
                if (!center) {
                  setZoom(1)
                  return
                }
                applyZoom(() => 1, center.clientX, center.clientY)
              }}
            >
              <RotateCcw size={14} />
            </button>
          </div>
        </div>

        <div className="image-preview-stage">
          {images.length > 1 && (
            <button
              className="image-preview-nav previous"
              type="button"
              aria-label="上一张"
              title="上一张"
              disabled={isBusy || activeIndex === 0}
              onClick={() => navigate(-1)}
            >
              <ChevronLeft size={24} />
            </button>
          )}
          <div
            ref={canvasRef}
            className={`image-preview-canvas ${zoom > 1 ? 'drag-enabled' : ''} ${dragging ? 'dragging' : ''}`}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={stopDragging}
            onPointerCancel={stopDragging}
            onPointerLeave={stopDragging}
            onWheel={handleWheel}
          >
            <div
              ref={mediaRef}
              className="image-preview-media"
              style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }}
            >
              <img src={image.url} alt={image.alt || '资产图片'} draggable={false} />
            </div>
          </div>
          {images.length > 1 && (
            <button
              className="image-preview-nav next"
              type="button"
              aria-label="下一张"
              title="下一张"
              disabled={isBusy || activeIndex === images.length - 1}
              onClick={() => navigate(1)}
            >
              <ChevronRight size={24} />
            </button>
          )}
        </div>

        {showPromptPanel && hasPromptInfo && (
          <div
            className="image-preview-prompt-panel"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setShowPromptPanel(false)
            }}
          >
            <div
              id={promptPanelId}
              className="image-preview-prompt-dialog"
              role="dialog"
              aria-modal="true"
              aria-label="提示词弹窗"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <header className="image-preview-prompt-head">
                <div>
                  <span className="eyebrow">提示词</span>
                  <strong>查看本批生成用语</strong>
                  <small>复制最终提示词或原始提示词，不会离开当前预览。</small>
                </div>
                <div className="image-preview-prompt-actions">
                  <button
                    className="image-preview-close"
                    type="button"
                    aria-label="关闭提示词"
                    title="关闭"
                    onClick={() => setShowPromptPanel(false)}
                  >
                    <X size={18} />
                  </button>
                </div>
              </header>
              <div className="image-preview-prompt-body">
                {batchPrompt && (
                  <section className="image-preview-prompt-card">
                    <div className="image-preview-prompt-head">
                      <div>
                        <span>最终提示词</span>
                        <small>本批实际发送给模型的提示词</small>
                      </div>
                      <button
                        className="image-preview-prompt-copy"
                        type="button"
                        disabled={isBusy || copyingPromptKey === 'final'}
                        onClick={() => handleCopyPrompt(batchPrompt, 'final')}
                      >
                        {copyingPromptKey === 'final' ? (
                          <LoaderCircle size={13} className="spin" />
                        ) : copiedPromptKey === 'final' ? (
                          <Check size={13} />
                        ) : (
                          <Copy size={13} />
                        )}
                        {copyingPromptKey === 'final'
                          ? '复制中'
                          : copiedPromptKey === 'final'
                            ? '已复制'
                            : '复制'}
                      </button>
                    </div>
                    <textarea readOnly value={batchPrompt} rows={5} />
                  </section>
                )}
                {batchOriginalPrompt && batchOriginalPrompt !== batchPrompt && (
                  <section className="image-preview-prompt-card subtle">
                    <div className="image-preview-prompt-head">
                      <div>
                        <span>原始提示词</span>
                        <small>用户输入的初始版本</small>
                      </div>
                      <button
                        className="image-preview-prompt-copy"
                        type="button"
                        disabled={isBusy || copyingPromptKey === 'original'}
                        onClick={() => handleCopyPrompt(batchOriginalPrompt, 'original')}
                      >
                        {copyingPromptKey === 'original' ? (
                          <LoaderCircle size={13} className="spin" />
                        ) : copiedPromptKey === 'original' ? (
                          <Check size={13} />
                        ) : (
                          <Copy size={13} />
                        )}
                        {copyingPromptKey === 'original'
                          ? '复制中'
                          : copiedPromptKey === 'original'
                            ? '已复制'
                            : '复制'}
                      </button>
                    </div>
                    <textarea readOnly value={batchOriginalPrompt} rows={5} />
                  </section>
                )}
              </div>
            </div>
          </div>
        )}
        {(images.length > 1 || message) && (
          <footer className="image-preview-foot">
            {images.length > 1 && (
              <span>
                {activeIndex + 1} / {images.length}
              </span>
            )}
            {message && (
              <p
                className={`image-preview-message ${message.type}`}
                role={message.type === 'error' ? 'alert' : 'status'}
                aria-live="polite"
              >
                {message.text}
              </p>
            )}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  )
}

async function copyTextToClipboard(text) {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    if (typeof navigator.clipboard.readText === 'function') {
      try {
        return (await navigator.clipboard.readText()) === text
      } catch {
        return true
      }
    }
    return true
  }

  if (typeof document === 'undefined') {
    throw new Error('浏览器暂不支持复制')
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', 'true')
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  textarea.style.top = '0'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()
  const success = document.execCommand?.('copy')
  document.body.removeChild(textarea)
  if (!success) {
    return false
  }
  if (typeof navigator !== 'undefined' && navigator.clipboard?.readText) {
    try {
      return (await navigator.clipboard.readText()) === text
    } catch {
      return true
    }
  }
  return true
}
