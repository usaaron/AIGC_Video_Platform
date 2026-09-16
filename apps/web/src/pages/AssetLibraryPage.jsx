import { useEffect, useRef, useState } from 'react'
import { CopyCheck, LoaderCircle, PackageOpen, Plus, RefreshCw, Search } from 'lucide-react'
import { PageHeader } from '../components/ui'
import { LibraryCard } from '../features/assetLibrary/LibraryCard'
import { LibraryPreview } from '../features/assetLibrary/LibraryPreview'
import { TemplateEditor } from '../features/assetLibrary/TemplateEditor'
import {
  categoryCount,
  LIBRARY_CATEGORIES,
  LIBRARY_LABELS,
  matchesCategory,
} from '../features/assetLibrary/libraryPresentation'
import '../features/assetLibrary/assetLibrary.css'

export function AssetLibraryPage({
  currentProject,
  onToast,
  onLoadItems,
  onSyncExternal,
  onLoadStats,
  onLoadDuplicates,
  onDedupe,
  onDelete,
  onRestore,
  onPermanentDelete,
  onLoadVersions,
  onImportToProject,
  onLoadText,
  onSaveTemplate,
}) {
  const [mode, setMode] = useState('active')
  const [category, setCategory] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [result, setResult] = useState({ items: [], total: 0, pageSize: 12 })
  const [stats, setStats] = useState(null)
  const [duplicates, setDuplicates] = useState([])
  const [preview, setPreview] = useState(null)
  const [template, setTemplate] = useState(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [revision, setRevision] = useState(0)
  const sequence = useRef(0)

  const load = async () => {
    const requestId = ++sequence.current
    setLoading(true)
    setError('')
    try {
      const [nextStats, nextResult] = await Promise.all([
        onLoadStats(),
        mode === 'duplicates'
          ? onLoadDuplicates()
          : onLoadItems({
              deleted: mode === 'trash' ? 'trashed' : 'active',
              category,
              q: query,
              page,
              pageSize: 12,
            }),
      ])
      if (requestId !== sequence.current) return
      setStats(nextStats)
      if (mode === 'duplicates') setDuplicates(nextResult.groups || [])
      else {
        const lastPage = Math.max(1, Math.ceil(nextResult.total / nextResult.pageSize))
        if (page > lastPage) {
          setPage(lastPage)
          return
        }
        setResult(nextResult)
      }
    } catch (failure) {
      if (requestId === sequence.current) setError(failure.message)
    } finally {
      if (requestId === sequence.current) setLoading(false)
    }
  }
  useEffect(() => {
    const timer = setTimeout(() => {
      void load()
    }, 180)
    return () => {
      clearTimeout(timer)
      sequence.current += 1
    }
  }, [mode, category, query, page, revision])
  useEffect(() => {
    let active = true
    Promise.resolve(onSyncExternal?.())
      .then(() => {
        if (active) setRevision((value) => value + 1)
      })
      .catch((failure) => {
        if (active) onToast?.(failure.message)
      })
    return () => {
      active = false
    }
  }, [])

  const refresh = async () => {
    setSyncing(true)
    try {
      await onSyncExternal?.()
    } catch (failure) {
      onToast?.(failure.message)
    } finally {
      setSyncing(false)
      setRevision((value) => value + 1)
    }
  }
  const action = async (operation, message, close = false) => {
    if (busy) return
    setBusy(true)
    try {
      await operation()
      if (close) setPreview(null)
      onToast?.(message)
      setRevision((value) => value + 1)
    } catch (failure) {
      onToast?.(failure.message)
    } finally {
      setBusy(false)
    }
  }
  const importItem =
    currentProject && onImportToProject
      ? (item) => action(() => onImportToProject(item.id, 'auto'), '资产已导入当前项目', true)
      : null
  const card = (item) => (
    <LibraryCard
      key={item.id}
      item={item}
      mode={mode}
      busy={busy}
      onPreview={setPreview}
      onImport={importItem}
      onDelete={(entry) => action(() => onDelete(entry.id), '资产已移入回收站', true)}
      onRestore={(entry) => action(() => onRestore(entry.id), '资产已恢复', true)}
    />
  )
  const groups = duplicates
    .filter((group) => matchesCategory(group.kind, category))
    .map((group) => ({
      ...group,
      items: group.items.filter((item) =>
        [item.title, item.sourceProjectName].join(' ').toLowerCase().includes(query.toLowerCase()),
      ),
    }))
    .filter((group) => group.items.length)
  const maxPage = Math.max(1, Math.ceil(result.total / result.pageSize))
  return (
    <section className="page asset-library-page">
      <PageHeader
        eyebrow="创作资源 · 账号资产库"
        title="每一份灵感，都有归处"
        description="汇集图片、音频与长短剧本，把好素材带进下一次创作。"
      >
        <button className="button secondary" type="button" disabled={syncing || busy} onClick={refresh}>
          <RefreshCw size={15} className={syncing ? 'spin' : ''} />
          刷新
        </button>
        <button className="button primary" type="button" onClick={() => setTemplate({})}>
          <Plus size={16} />
          新建提示词模板
        </button>
      </PageHeader>
      <nav className="library-categories" aria-label="资产分类">
        {[['', '全部'], ...LIBRARY_CATEGORIES].map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={category === key}
            className={category === key ? 'active' : ''}
            onClick={() => {
              setCategory(key)
              setPage(1)
            }}
          >
            {label}
            <span>{categoryCount(stats, key, mode === 'trash')}</span>
          </button>
        ))}
      </nav>
      <div className="library-toolbar">
        <label className="library-search">
          <Search size={16} />
          <input
            value={query}
            maxLength={200}
            onChange={(event) => {
              setQuery(event.target.value)
              setPage(1)
            }}
            placeholder="搜索素材、项目或提示词"
            aria-label="搜索资产"
          />
        </label>
        <div className="library-views" aria-label="资产状态">
          {[
            ['active', '全部资产'],
            ['duplicates', '重复项'],
            ['trash', '回收站'],
          ].map(([key, label]) => (
            <button
              type="button"
              key={key}
              aria-pressed={mode === key}
              className={mode === key ? 'active' : ''}
              onClick={() => {
                setMode(key)
                setPage(1)
                setPreview(null)
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="library-result-heading">
        <span>
          {mode === 'duplicates'
            ? `${groups.length} 组重复内容`
            : `${result.total} 项${category ? LIBRARY_LABELS[category] : '资产'}`}
        </span>
        <span>{currentProject ? `可导入：${currentProject.name}` : '选择项目后，可将素材导入创作'}</span>
      </div>
      {error ? (
        <div className="library-empty" role="alert">
          <PackageOpen size={30} />
          <h2>暂时无法读取资产库</h2>
          <p>{error}</p>
          <button className="button secondary" onClick={() => setRevision((value) => value + 1)}>
            重新加载
          </button>
        </div>
      ) : loading ? (
        <div className="library-empty" role="status">
          <LoaderCircle className="spin" size={28} />
          <p>正在整理你的素材…</p>
        </div>
      ) : mode === 'duplicates' ? (
        <>
          {groups.length ? (
            <>
              <div className="library-duplicate-action">
                <p>相同内容集中查看，去重会标记主资产和副本。</p>
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => action(onDedupe, '重复项已重新标记')}
                >
                  <CopyCheck size={16} />
                  标记重复项
                </button>
              </div>
              {groups.map((group) => (
                <section key={`${group.kind}:${group.contentHash}`} className="library-duplicate-group">
                  <h2>
                    {LIBRARY_LABELS[group.kind]} · {group.items.length} 项
                  </h2>
                  <div className="library-grid">{group.items.map(card)}</div>
                </section>
              ))}
            </>
          ) : (
            <div className="library-empty">
              <CopyCheck size={30} />
              <h2>没有重复的素材</h2>
              <p>你的创作资源井然有序。</p>
            </div>
          )}
        </>
      ) : result.items.length ? (
        <>
          <div className="library-grid">{result.items.map(card)}</div>
          <div className="library-pagination">
            <button className="button secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              上一页
            </button>
            <span>
              {page} / {maxPage}
            </span>
            <button className="button secondary" disabled={page >= maxPage} onClick={() => setPage(page + 1)}>
              下一页
            </button>
          </div>
        </>
      ) : (
        <div className="library-empty">
          <PackageOpen size={34} strokeWidth={1.3} />
          <h2>
            {query
              ? '没有找到匹配的素材'
              : mode === 'trash'
                ? '回收站是空的'
                : category === 'prompt-template'
                  ? '收藏你的第一条好提示词'
                  : '好素材，即将在这里相遇'}
          </h2>
          <p>
            {query
              ? '试试其他关键词，或切换素材分类。'
              : mode === 'trash'
                ? '移入回收站的素材可以恢复。'
                : category === 'prompt-template'
                  ? '新建模板，或在素材预览中收藏生成提示词。'
                  : '生成的图片、保存的剧本会自动汇集到这里。'}
          </p>
          {category === 'prompt-template' && mode === 'active' && (
            <button className="button secondary" onClick={() => setTemplate({})}>
              新建模板
            </button>
          )}
        </div>
      )}
      {preview && (
        <LibraryPreview
          key={`${preview.id}:${preview.currentVersion}`}
          item={preview}
          onClose={() => setPreview(null)}
          onToast={onToast}
          onLoadText={onLoadText}
          onLoadVersions={onLoadVersions}
          onImport={importItem}
          busy={busy}
          onPermanentDelete={(item) => action(() => onPermanentDelete(item.id), '资产记录已永久删除', true)}
          onEditTemplate={(item, content) => {
            setPreview(null)
            setTemplate({ id: item.id, title: item.title, content })
          }}
          onSavePrompt={(item, content) => {
            setPreview(null)
            setTemplate({ title: `${item.title} · 提示词`, content })
          }}
        />
      )}
      {template && (
        <TemplateEditor
          draft={template}
          onClose={() => setTemplate(null)}
          onSave={async (input, id) => {
            await onSaveTemplate(input, id)
            setTemplate(null)
            setCategory('prompt-template')
            setMode('active')
            setQuery('')
            setPage(1)
            setRevision((value) => value + 1)
            onToast?.('提示词模板已保存')
          }}
        />
      )}
    </section>
  )
}
