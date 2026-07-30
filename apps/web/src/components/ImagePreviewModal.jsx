import { Download, LoaderCircle, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { hasDownloadedImageName, imageDownloadFileName, rememberDownloadedImageName } from './imageDownload'

export function ImagePreviewModal({ image, onClose }) {
  const [downloading, setDownloading] = useState(false)
  const [downloadMessage, setDownloadMessage] = useState(null)

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  const handleDownload = async () => {
    setDownloading(true)
    setDownloadMessage(null)
    try {
      const result = await downloadImage(image.url, image.fileName || image.alt || '资产图片')
      setDownloadMessage({
        type: result.duplicate ? 'warning' : 'success',
        text: result.duplicate
          ? `已开始下载 ${result.fileName}。检测到本浏览器曾下载过同名文件，浏览器可能会自动追加编号，或在保存时提示覆盖。`
          : `已开始下载 ${result.fileName}。`,
      })
    } catch (downloadError) {
      setDownloadMessage({
        type: 'error',
        text: downloadError instanceof Error ? downloadError.message : '图片下载失败，请稍后重试',
      })
    } finally {
      setDownloading(false)
    }
  }

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
          <div className="image-preview-actions">
            <button
              className="button secondary"
              type="button"
              disabled={downloading}
              onClick={handleDownload}
            >
              {downloading ? <LoaderCircle size={16} className="spin" /> : <Download size={16} />}
              {downloading ? '下载中' : '下载到本地'}
            </button>
            <button className="button secondary" type="button" onClick={onClose}>
              <X size={16} />
              关闭
            </button>
          </div>
        </header>
        <div className="image-preview-canvas">
          <img src={image.url} alt={image.alt || '资产图片'} />
        </div>
        {downloadMessage && (
          <p
            className={`image-preview-message ${downloadMessage.type}`}
            role={downloadMessage.type === 'error' ? 'alert' : 'status'}
            aria-live="polite"
          >
            {downloadMessage.text}
          </p>
        )}
      </div>
    </div>,
    document.body,
  )
}

async function downloadImage(url, requestedName) {
  const response = await fetch(url, { credentials: 'include' })
  if (!response.ok) throw new Error('图片下载失败，请稍后重试')
  const blob = await response.blob()
  const fileName = imageDownloadFileName(requestedName, blob.type)
  const duplicate = hasDownloadedImageName(fileName)
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  rememberDownloadedImageName(fileName)
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000)
  return { duplicate, fileName }
}
