import { Download, LoaderCircle, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

export function ImagePreviewModal({ image, onClose }) {
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState('')

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
    setError('')
    try {
      await downloadImage(image.url, image.fileName || image.alt || '资产图片')
    } catch (downloadError) {
      setError(downloadError.message)
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
        {error && (
          <p className="image-preview-error" role="alert">
            {error}
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
  const extension = extensionFor(blob.type)
  const baseName = sanitizeFileName(requestedName).replace(/\.(png|jpe?g|webp|gif)$/i, '') || '资产图片'
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = `${baseName}.${extension}`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0)
}

function extensionFor(contentType) {
  if (contentType.includes('jpeg')) return 'jpg'
  if (contentType.includes('webp')) return 'webp'
  if (contentType.includes('gif')) return 'gif'
  return 'png'
}

function sanitizeFileName(value) {
  const reserved = '<>:"/\\|?*'
  return [...value]
    .map((character) => (character.charCodeAt(0) < 32 || reserved.includes(character) ? '-' : character))
    .join('')
    .trim()
}
