import { ArrowLeft, Download } from 'lucide-react'
import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { videoDownloadUrl } from '../features/film/videoDownload'

export function VideoPreviewModal({ video, onClose }) {
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

  const fileName = video.fileName || video.alt || '序幕TV成片'

  return createPortal(
    <div
      className="image-preview-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={`${video.alt || '生成视频'}预览`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        className="image-preview-dialog video-preview-dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="image-preview-head">
          <div>
            <span className="eyebrow">视频预览</span>
            <strong>{video.alt || '生成视频'}</strong>
          </div>
          <div className="image-preview-actions">
            <a className="button primary" href={videoDownloadUrl(video.url, fileName)}>
              <Download size={16} />
              下载到手机
            </a>
            <button className="button secondary" type="button" onClick={onClose}>
              <ArrowLeft size={16} />
              返回工作台
            </button>
          </div>
        </header>
        <div className="image-preview-canvas video-preview-canvas">
          <video src={video.url} controls playsInline preload="metadata" />
        </div>
      </div>
    </div>,
    document.body,
  )
}
