import { useRef, useState } from 'react'
import { BookOpenText, ChevronLeft, FileText, ImagePlus, Library, LoaderCircle } from 'lucide-react'
import { api } from '../../services/apiClient'
import { LibraryDialog } from '../assetLibrary/LibraryDialog'
import { useLibraryItems } from '../assetLibrary/useLibraryItems'
import { LIBRARY_LABELS } from '../assetLibrary/libraryPresentation'

const categories = [
  ['image', '图片'],
  ['character', '人物'],
  ['prop', '物品'],
  ['scene', '场景'],
  ['script', '剧本'],
]

export function ShotLibraryAssets({ projectId, disabled, imageUrl, onImage, onInsert }) {
  const [open, setOpen] = useState(false)
  const [category, setCategory] = useState('image')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [reload, setReload] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [script, setScript] = useState(null)
  const [selection, setSelection] = useState('')
  const submitting = useRef(false)
  const {
    result,
    loading,
    error: loadError,
  } = useLibraryItems({
    open,
    category: category === 'image' ? undefined : category,
    kind: category === 'image' ? 'image' : undefined,
    query,
    page,
    reload,
  })
  const choose = async (item) => {
    if (submitting.current) return
    submitting.current = true
    setBusy(true)
    setError('')
    try {
      if (item.kind === 'script') {
        const content = await api.libraryItemText(item.id, undefined, item.currentVersion)
        setScript({ title: item.title, content })
        setSelection('')
      } else {
        const result = await api.importLibraryItem(projectId, { itemId: item.id, target: 'media' })
        if (
          result.imported?.type !== 'media' ||
          result.imported.media?.kind !== 'image' ||
          !result.imported.media.url
        )
          throw new Error('该资产没有可用图片，请选择其他资产。')
        onImage(result.imported.media.url)
        setNotice(`已使用「${result.item.title}」作为参考图，保存分镜后生效`)
        setOpen(false)
      }
    } catch (failure) {
      setError(failure.message)
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }
  const insertScript = (text) => {
    try {
      if (!text.trim()) throw new Error('请选择需要插入的剧本文本。')
      onInsert(text)
      setNotice(`已将「${script.title}」文本插入画面提示词`)
      setOpen(false)
      setScript(null)
    } catch (failure) {
      setError(failure.message)
    }
  }
  return (
    <>
      <button
        type="button"
        className="button secondary shot-library-button"
        disabled={disabled || !projectId}
        onClick={() => {
          setOpen(true)
          setError('')
          setNotice('')
          setScript(null)
        }}
      >
        <Library size={16} /> 使用资产库资产
      </button>
      {notice && (
        <p className="shot-editor-notice" role="status">
          {notice}
        </p>
      )}
      {open && (
        <LibraryDialog
          title="使用资产库资产"
          className="shot-library-picker"
          onClose={() => {
            if (!submitting.current) setOpen(false)
          }}
        >
          <div className="shot-library-body">
            {script ? (
              <>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => {
                    setScript(null)
                    setError('')
                  }}
                >
                  <ChevronLeft size={16} /> 返回资产列表
                </button>
                <h3>{script.title}</h3>
                <p>选取或编辑本镜需要的段落，再插入画面提示词。修改仅用于本次引用。</p>
                <textarea
                  className="shot-library-script"
                  aria-label="剧本全文（可选取段落）"
                  value={script.content}
                  onChange={(event) => {
                    setScript({ ...script, content: event.target.value })
                    setSelection('')
                  }}
                  onSelect={(event) =>
                    setSelection(
                      event.currentTarget.value.slice(
                        event.currentTarget.selectionStart,
                        event.currentTarget.selectionEnd,
                      ),
                    )
                  }
                />
                <span className="shot-library-selection">
                  已选 {selection.length.toLocaleString()} 字 · 全文 {script.content.length.toLocaleString()}{' '}
                  字
                </span>
                {script.content.length > 5000 && <p>单镜提示词最多 5,000 字，请选取相关段落。</p>}
                {error && (
                  <p role="alert" className="operation-error">
                    {error}
                  </p>
                )}
                <footer className="shot-library-script-actions">
                  <button
                    type="button"
                    className="button secondary"
                    disabled={script.content.length > 5000 || !script.content.trim()}
                    onClick={() => insertScript(script.content)}
                  >
                    插入全文
                  </button>
                  <button
                    type="button"
                    className="button primary"
                    disabled={!selection.trim() || selection.length > 5000}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => insertScript(selection)}
                  >
                    插入选中文本
                  </button>
                </footer>
              </>
            ) : (
              <>
                <p>
                  图片会导入当前项目作为本镜参考图；剧本可选取段落写入提示词。
                  {imageUrl ? '使用新图片会替换当前参考图。' : ''}
                </p>
                <div className="shot-library-categories" role="group" aria-label="可用资产分类">
                  {categories.map(([value, label]) => (
                    <button
                      type="button"
                      className="button secondary"
                      key={value}
                      aria-pressed={category === value}
                      disabled={busy}
                      onClick={() => {
                        setCategory(value)
                        setPage(1)
                        setError('')
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <input
                  aria-label="搜索资产库"
                  placeholder="搜索资产名称或内容"
                  maxLength={200}
                  value={query}
                  disabled={busy}
                  onChange={(event) => {
                    setQuery(event.target.value)
                    setPage(1)
                    setError('')
                  }}
                />
                {(error || loadError) && (
                  <p className="operation-error" role="alert">
                    {error || loadError}
                    <button
                      type="button"
                      className="button secondary"
                      disabled={busy}
                      onClick={() => {
                        setError('')
                        setReload((value) => value + 1)
                      }}
                    >
                      重新加载
                    </button>
                  </p>
                )}
                {busy && (
                  <p role="status">
                    <LoaderCircle size={16} className="spin" /> 正在导入资产…
                  </p>
                )}
                {loading ? (
                  <p role="status">正在读取资产…</p>
                ) : (
                  !loadError && (
                    <div className="shot-library-grid">
                      {result.items.map((item) => {
                        const image = item.contentType.startsWith('image/')
                        const supported = image || item.kind === 'script'
                        return (
                          <article key={item.id}>
                            <div className="shot-library-cover">
                              {image ? (
                                <img src={item.previewUrl} alt={item.title} loading="lazy" />
                              ) : (
                                <>
                                  <FileText size={30} />
                                  <span>
                                    {item.sourceSnapshot?.contentPreview || item.description || '剧本全文'}
                                  </span>
                                </>
                              )}
                            </div>
                            <strong>{item.title}</strong>
                            <small>
                              {LIBRARY_LABELS[item.kind] || '资产'} · {item.sourceProjectName || '账号资产库'}
                            </small>
                            <button
                              type="button"
                              className="button secondary"
                              disabled={busy || !supported}
                              onClick={() => void choose(item)}
                            >
                              {image ? <ImagePlus size={15} /> : <BookOpenText size={15} />}
                              {image ? '用作参考图' : supported ? '选择剧本段落' : '暂不支持引用'}
                            </button>
                          </article>
                        )
                      })}
                    </div>
                  )
                )}
                {!loading && !loadError && !result.items.length && (
                  <p className="shot-library-empty">
                    {query ? '没有找到匹配的资产' : '此分类暂无已保存资产'}
                  </p>
                )}
                <div className="library-pagination">
                  <button
                    type="button"
                    className="button secondary"
                    disabled={loading || busy || page <= 1}
                    onClick={() => setPage((value) => value - 1)}
                  >
                    上一页
                  </button>
                  <span>
                    {page} / {Math.max(1, Math.ceil(result.total / result.pageSize))}
                  </span>
                  <button
                    type="button"
                    className="button secondary"
                    disabled={loading || busy || page * result.pageSize >= result.total}
                    onClick={() => setPage((value) => value + 1)}
                  >
                    下一页
                  </button>
                </div>
              </>
            )}
          </div>
        </LibraryDialog>
      )}
    </>
  )
}
