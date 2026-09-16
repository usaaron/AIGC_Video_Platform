import { useEffect, useState } from 'react'
import { ArchiveRestore, Copy, Download, LoaderCircle, Pencil, Sparkles } from 'lucide-react'
import { LibraryDialog } from './LibraryDialog'
import { formatBytes, LIBRARY_LABELS, libraryPrompt, libraryText } from './libraryPresentation'

export function LibraryPreview({
  item,
  onClose,
  onLoadText,
  onLoadVersions,
  onToast,
  onEditTemplate,
  onSavePrompt,
  onImport,
  onPermanentDelete,
  busy,
}) {
  const [text, setText] = useState(libraryText(item))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [versions, setVersions] = useState([])
  const [versionError, setVersionError] = useState('')
  const [versionLoading, setVersionLoading] = useState(true)
  const [attempt, setAttempt] = useState(0)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const isText = /^(text\/|application\/json)/u.test(item.contentType)
  const isTemplate = item.kind === 'prompt-template'
  const prompt = libraryPrompt(item)
  useEffect(() => {
    const controller = new AbortController()
    if (isText) {
      setLoading(true)
      setError('')
      Promise.resolve(onLoadText(item.id, controller.signal, item.currentVersion))
        .then((value) => {
          if (!controller.signal.aborted) setText(value)
        })
        .catch((failure) => {
          if (!controller.signal.aborted) setError(failure.message)
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false)
        })
    }
    setVersionLoading(true)
    setVersionError('')
    Promise.resolve(onLoadVersions(item.id))
      .then((result) => {
        if (!controller.signal.aborted) setVersions(result.versions || [])
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setVersionError(failure.message)
      })
      .finally(() => {
        if (!controller.signal.aborted) setVersionLoading(false)
      })
    return () => controller.abort()
  }, [item.id, isText, attempt])
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(isTemplate ? text : prompt || text)
      onToast?.('已复制')
    } catch {
      onToast?.('复制失败，请手动选择内容复制')
    }
  }
  return (
    <LibraryDialog title={item.title} onClose={onClose} className="library-preview-dialog">
      <div className="library-preview-layout">
        <div className="library-preview-content">
          {item.contentType.startsWith('image/') ? (
            <img src={item.previewUrl} alt={item.title} />
          ) : item.contentType.startsWith('video/') ? (
            <video controls preload="metadata" src={item.previewUrl} aria-label={item.title} />
          ) : item.contentType.startsWith('audio/') ? (
            <div className="library-audio-preview">
              <span>音频试听</span>
              <audio controls preload="metadata" src={item.previewUrl} aria-label={item.title} />
            </div>
          ) : loading ? (
            <p role="status">
              <LoaderCircle className="spin" size={18} /> 正在读取全文…
            </p>
          ) : error ? (
            <div role="alert">
              <p>{error}</p>
              <button className="button secondary" onClick={() => setAttempt((value) => value + 1)}>
                重新加载
              </button>
            </div>
          ) : (
            <pre>{text || '此素材暂无文字预览，请下载查看。'}</pre>
          )}
        </div>
        <aside className="library-preview-details">
          <span className="eyebrow">{LIBRARY_LABELS[item.kind]}</span>
          <p>
            {item.sourceProjectName || '账号资产库'} · {formatBytes(item.sizeBytes)}
          </p>
          <p>{new Date(item.createdAt).toLocaleString('zh-CN')}</p>
          {item.description && <p>{item.description}</p>}
          {!item.deletedAt && (
            <div className="library-preview-actions">
              <a className="button primary" href={item.downloadUrl} download>
                <Download size={15} />
                下载{isTemplate ? '模板' : '原文件'}
              </a>
              <a className="button secondary" href={item.packageUrl} download>
                下载素材包
              </a>
              {onImport && (item.kind === 'script' || /^(image|audio)\//u.test(item.contentType)) && (
                <button className="button secondary" disabled={busy} onClick={() => onImport(item)}>
                  <ArchiveRestore size={15} />
                  导入当前项目
                </button>
              )}
              {(isText || prompt) && (
                <button className="button secondary" disabled={loading || Boolean(error)} onClick={copy}>
                  <Copy size={15} />
                  复制{isTemplate ? '提示词' : prompt ? '生成提示词' : '正文'}
                </button>
              )}
              {isTemplate && (
                <button
                  className="button secondary"
                  disabled={loading || Boolean(error)}
                  onClick={() => onEditTemplate(item, text)}
                >
                  <Pencil size={15} />
                  编辑模板
                </button>
              )}
              {prompt && !isTemplate && (
                <button className="button secondary" onClick={() => onSavePrompt(item, prompt)}>
                  <Sparkles size={15} />
                  存为提示词模板
                </button>
              )}
            </div>
          )}
          {prompt && (
            <details>
              <summary>生成提示词</summary>
              <p className="library-prompt-text">{prompt}</p>
            </details>
          )}
          <div className="library-version-list">
            <h3>版本记录</h3>
            {versionLoading ? (
              <span role="status">正在读取版本…</span>
            ) : versionError ? (
              <p role="alert">{versionError}</p>
            ) : (
              versions.map((version) => (
                <a href={version.downloadUrl} key={version.id} download>
                  <span>v{version.version}</span>
                  <small>{new Date(version.createdAt).toLocaleDateString('zh-CN')}</small>
                  <Download size={14} />
                </a>
              ))
            )}
          </div>
          {item.deletedAt && item.sourceSnapshot?.automatic !== true && onPermanentDelete && (
            <div className="library-permanent-delete">
              {confirmDelete ? (
                <>
                  <p>永久删除后无法恢复，确认删除这项资产？</p>
                  <button className="button danger" disabled={busy} onClick={() => onPermanentDelete(item)}>
                    确认永久删除
                  </button>
                </>
              ) : (
                <button className="button secondary" onClick={() => setConfirmDelete(true)}>
                  永久删除
                </button>
              )}
            </div>
          )}
        </aside>
      </div>
    </LibraryDialog>
  )
}
