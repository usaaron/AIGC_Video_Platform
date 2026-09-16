import { useRef, useState } from 'react'
import { BookOpenText, LoaderCircle, Pencil, Plus, Save } from 'lucide-react'
import { api } from '../../services/apiClient'
import { LibraryDialog } from '../assetLibrary/LibraryDialog'
import { TemplateEditor } from '../assetLibrary/TemplateEditor'
import { useLibraryItems } from '../assetLibrary/useLibraryItems'
import '../assetLibrary/assetLibrary.css'

export function ShotPromptTemplates({ title, prompt, disabled, onInsert, children }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(null)
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [reload, setReload] = useState(0)
  const actionRef = useRef(false)
  const {
    result,
    loading,
    error: loadError,
  } = useLibraryItems({ open, category: 'prompt-template', query, page, reload })
  const choose = async (item, edit = false) => {
    if (actionRef.current) return
    actionRef.current = true
    setBusy(item.id)
    setError('')
    try {
      const content = await api.libraryItemText(item.id, undefined, item.currentVersion)
      if (edit) setDraft({ id: item.id, title: item.title, content })
      else {
        onInsert(content)
        setNotice(`已插入「${item.title}」，可继续编辑`)
      }
      setOpen(false)
    } catch (failure) {
      setError(failure.message)
    } finally {
      actionRef.current = false
      setBusy('')
    }
  }
  return (
    <>
      <div className="shot-prompt-template-toolbar">
        {children}
        <button
          type="button"
          className="button secondary shot-template-button"
          disabled={disabled}
          onClick={() => {
            setOpen(true)
            setNotice('')
            setError('')
          }}
        >
          <BookOpenText size={16} /> 使用提示词模板
        </button>
        <button
          type="button"
          className="button secondary shot-template-button"
          disabled={disabled || !prompt.trim()}
          onClick={() => {
            setDraft({ title: `${title} · 提示词`.slice(0, 160), content: prompt })
            setNotice('')
          }}
        >
          <Save size={16} /> 存为提示词模板
        </button>
      </div>
      {notice && (
        <p className="shot-editor-notice" role="status">
          {notice}
        </p>
      )}
      {open && (
        <LibraryDialog
          title="选择提示词模板"
          className="shot-template-picker"
          onClose={() => {
            if (!actionRef.current) setOpen(false)
          }}
        >
          <div className="shot-template-picker-body">
            <p>插入到画面提示词的光标位置，保留已有内容；修改后也可另存为模板。</p>
            <input
              aria-label="搜索提示词模板"
              placeholder="搜索模板名称或内容"
              value={query}
              disabled={Boolean(busy)}
              onChange={(event) => {
                setQuery(event.target.value)
                setPage(1)
              }}
            />
            {(error || loadError) && (
              <p role="alert">
                {error || loadError}
                <button
                  type="button"
                  className="button secondary"
                  disabled={Boolean(busy)}
                  onClick={() => {
                    setError('')
                    setReload((value) => value + 1)
                  }}
                >
                  重试
                </button>
              </p>
            )}
            {loading ? (
              <p role="status">
                <LoaderCircle size={16} className="spin" /> 正在读取模板…
              </p>
            ) : !error && !loadError && result.items.length ? (
              <div className="shot-template-list">
                {result.items.map((item) => (
                  <article key={item.id}>
                    <strong>
                      {item.title}
                      <small>v{item.currentVersion}</small>
                    </strong>
                    <p>{item.sourceSnapshot?.contentPreview || item.description}</p>
                    <div>
                      <button
                        type="button"
                        className="button primary"
                        disabled={Boolean(busy)}
                        onClick={() => void choose(item)}
                      >
                        <Plus size={15} />
                        插入模板
                      </button>
                      <button
                        type="button"
                        className="button secondary"
                        disabled={Boolean(busy)}
                        onClick={() => void choose(item, true)}
                      >
                        <Pencil size={15} />
                        编辑模板
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              !error &&
              !loadError && (
                <p>
                  {query
                    ? '没有找到匹配的模板'
                    : '还没有提示词模板。关闭此窗口后，可将当前提示词保存为模板。'}
                </p>
              )
            )}
            <div className="library-pagination">
              <button
                type="button"
                className="button secondary"
                disabled={loading || Boolean(busy) || page <= 1}
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
                disabled={loading || Boolean(busy) || page * result.pageSize >= result.total}
                onClick={() => setPage((value) => value + 1)}
              >
                下一页
              </button>
            </div>
          </div>
        </LibraryDialog>
      )}
      {draft && (
        <TemplateEditor
          draft={draft}
          onClose={() => setDraft(null)}
          onSave={async (input, id) => {
            if (id) await api.createLibraryItemVersion(id, input)
            else await api.createLibraryItem(input)
            setDraft(null)
            setNotice(id ? '模板已更新，历史版本保留' : '提示词模板已保存，可在资产库中查看')
          }}
        />
      )}
    </>
  )
}
