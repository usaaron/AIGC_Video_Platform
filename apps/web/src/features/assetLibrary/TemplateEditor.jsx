import { useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import { LibraryDialog } from './LibraryDialog'

export function TemplateEditor({ draft, onClose, onSave }) {
  const [title, setTitle] = useState(draft.title || '')
  const [content, setContent] = useState(draft.content || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async (event) => {
    event.preventDefault()
    event.stopPropagation()
    if (busy || !title.trim() || !content.trim()) return
    setBusy(true)
    setError('')
    try {
      await onSave(
        {
          sourceType: 'prompt-template',
          kind: 'prompt-template',
          title: title.trim(),
          content: content.trim(),
        },
        draft.id,
      )
    } catch (failure) {
      setError(failure.message)
      setBusy(false)
    }
  }
  return (
    <LibraryDialog
      title={draft.id ? '编辑提示词模板' : '新建提示词模板'}
      onClose={() => {
        if (!busy) onClose()
      }}
      className="library-template-dialog"
    >
      <form onSubmit={submit}>
        <p>把常用的风格、人物和镜头描写保存下来，下次创作时直接复制使用。</p>
        <label>
          模板名称
          <input
            autoFocus
            required
            maxLength={160}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="例如：电影感人物近景"
          />
        </label>
        <label>
          提示词内容
          <textarea
            required
            maxLength={20000}
            rows={12}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder="写下需要保留的画面描述、风格与约束…"
          />
        </label>
        <span className="library-template-count">{content.length.toLocaleString()} / 20,000</span>
        {error && <p role="alert">{error}</p>}
        <footer>
          <button type="button" className="button secondary" disabled={busy} onClick={onClose}>
            取消
          </button>
          <button className="button primary" disabled={busy || !title.trim() || !content.trim()}>
            {busy && <LoaderCircle size={15} className="spin" />}保存模板
          </button>
        </footer>
      </form>
    </LibraryDialog>
  )
}
