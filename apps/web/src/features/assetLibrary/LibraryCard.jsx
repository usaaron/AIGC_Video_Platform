import { useState } from 'react'
import {
  ArchiveRestore,
  Download,
  Expand,
  FileText,
  ImageOff,
  Music2,
  Sparkles,
  Trash2,
  Video,
} from 'lucide-react'
import { LIBRARY_LABELS, libraryText } from './libraryPresentation'

export function LibraryCard({ item, mode, busy, onPreview, onImport, onDelete, onRestore }) {
  const [broken, setBroken] = useState(false)
  const isImage = item.contentType?.startsWith('image/')
  const Icon =
    item.kind === 'prompt-template'
      ? Sparkles
      : item.contentType?.startsWith('audio/')
        ? Music2
        : item.contentType?.startsWith('video/')
          ? Video
          : FileText
  return (
    <article className="library-card" aria-label={item.title}>
      <button
        type="button"
        className={`library-card-cover ${isImage ? 'image' : item.kind}`}
        onClick={() => onPreview(item)}
        aria-label={`预览 ${item.title}`}
      >
        {isImage && !broken ? (
          <img src={item.previewUrl} alt={item.title} loading="lazy" onError={() => setBroken(true)} />
        ) : (
          <div className="library-cover-content">
            {isImage ? (
              <>
                <ImageOff size={30} />
                <span>图片暂不可用</span>
              </>
            ) : (
              <>
                <Icon size={28} strokeWidth={1.4} />
                {item.contentType?.startsWith('audio/') ? (
                  <div className="library-waveform" aria-hidden="true">
                    {Array.from({ length: 21 }, (_, i) => (
                      <i key={i} style={{ height: `${14 + ((i * 13) % 43)}px` }} />
                    ))}
                  </div>
                ) : (
                  <p>{libraryText(item).slice(0, 600) || item.title}</p>
                )}
              </>
            )}
          </div>
        )}
        <span className="library-cover-label">{LIBRARY_LABELS[item.kind] || '素材'}</span>
        <span className="library-cover-open">
          <Expand size={15} /> 预览
        </span>
        {item.duplicateOfItemId && <span className="library-copy-label">副本</span>}
      </button>
      <div className="library-card-info">
        <h2 title={item.title}>{item.title}</h2>
        <p title={item.sourceProjectName || '我的模板'}>
          {item.sourceProjectName || (item.kind === 'prompt-template' ? '我的模板' : '账号资产')}
          <span>v{item.currentVersion}</span>
        </p>
      </div>
      <div className="library-card-actions">
        {mode === 'trash' ? (
          <button className="button secondary" type="button" disabled={busy} onClick={() => onRestore(item)}>
            <ArchiveRestore size={14} />
            恢复
          </button>
        ) : (
          <>
            <a className="button secondary" href={item.downloadUrl} download>
              <Download size={14} />
              下载
            </a>
            {onImport && (item.kind === 'script' || /^(image|audio)\//u.test(item.contentType)) && (
              <button
                className="button secondary"
                type="button"
                disabled={busy}
                onClick={() => onImport(item)}
              >
                导入当前项目
              </button>
            )}
            {onDelete && (
              <button
                className="icon-button"
                type="button"
                disabled={busy}
                aria-label={`移入回收站 ${item.title}`}
                title="移入回收站"
                onClick={() => onDelete(item)}
              >
                <Trash2 size={15} />
              </button>
            )}
          </>
        )}
      </div>
    </article>
  )
}
