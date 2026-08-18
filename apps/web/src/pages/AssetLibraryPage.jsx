import { useEffect, useMemo, useState } from 'react'
import {
  ArchiveRestore,
  Boxes,
  Clapperboard,
  CopyCheck,
  Download,
  FileText,
  Image,
  LoaderCircle,
  Music,
  PackageOpen,
  RefreshCw,
  Search,
  Trash2,
  Video,
} from 'lucide-react'

const KIND_LABELS = {
  character: '角色',
  scene: '场景',
  prop: '物品',
  costume: '服装',
  audio: '音频',
  image: '图片',
  script: '剧本',
  video: '视频',
  'final-cut': '成片',
}

const KIND_ICONS = {
  audio: Music,
  image: Image,
  script: FileText,
  video: Video,
  'final-cut': Clapperboard,
}

export function AssetLibraryPage({
  currentProject,
  onToast,
  onLoadItems,
  onLoadStats,
  onLoadDuplicates,
  onDedupe,
  onDelete,
  onRestore,
  onPermanentDelete,
  onLoadVersions,
}) {
  const [tab, setTab] = useState('active')
  const [kind, setKind] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [itemsResult, setItemsResult] = useState({ items: [], total: 0, page: 1, pageSize: 12 })
  const [stats, setStats] = useState(null)
  const [duplicates, setDuplicates] = useState([])
  const [selectedItem, setSelectedItem] = useState(null)
  const [versions, setVersions] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      const [nextStats, nextItems, nextDuplicates] = await Promise.all([
        onLoadStats(),
        tab === 'duplicates'
          ? Promise.resolve(itemsResult)
          : onLoadItems({
              deleted: tab === 'trash' ? 'trashed' : 'active',
              kind,
              q: query,
              page,
              pageSize: 12,
            }),
        tab === 'duplicates' ? onLoadDuplicates() : Promise.resolve({ groups: duplicates }),
      ])
      setStats(nextStats)
      if (tab !== 'duplicates') setItemsResult(nextItems)
      if (tab === 'duplicates') setDuplicates(nextDuplicates.groups || [])
    } catch (error) {
      onToast?.(error.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, kind, query, page])

  const activeKinds = useMemo(() => stats?.byKind?.filter((item) => item.count > 0 || item.trashed > 0) || [], [stats])
  const maxPage = Math.max(1, Math.ceil((itemsResult.total || 0) / (itemsResult.pageSize || 12)))

  const openVersions = async (item) => {
    setSelectedItem(item)
    setVersions([])
    setBusy(`versions:${item.id}`)
    try {
      const result = await onLoadVersions(item.id)
      setVersions(result.versions || [])
    } catch (error) {
      onToast?.(error.message)
    } finally {
      setBusy('')
    }
  }

  const runAction = async (key, action, message) => {
    setBusy(key)
    try {
      await action()
      onToast?.(message)
      await load()
    } catch (error) {
      onToast?.(error.message)
    } finally {
      setBusy('')
    }
  }

  return (
    <section className="asset-library-page">
      <div className="asset-library-hero">
        <div>
          <p className="eyebrow">账号资产库</p>
          <h1>长期资产</h1>
          <p>保存、追溯和复用跨项目的图片、剧本、音频、视频和成片包。</p>
        </div>
        <button className="button secondary" type="button" onClick={() => void load()}>
          <RefreshCw size={15} /> 刷新
        </button>
      </div>

      <div className="library-stat-strip">
        <Metric label="可用资产" value={stats?.activeItems ?? 0} />
        <Metric label="回收站" value={stats?.trashedItems ?? 0} />
        <Metric label="重复项" value={stats?.duplicateItems ?? 0} />
        <Metric label="版本记录" value={stats?.versionCount ?? 0} />
      </div>

      <div className="library-toolbar">
        <div className="segmented-control">
          <button className={tab === 'active' ? 'active' : ''} onClick={() => setTab('active')} type="button">
            全部资产
          </button>
          <button className={tab === 'duplicates' ? 'active' : ''} onClick={() => setTab('duplicates')} type="button">
            重复项
          </button>
          <button className={tab === 'trash' ? 'active' : ''} onClick={() => setTab('trash')} type="button">
            回收站
          </button>
        </div>
        <label className="library-search">
          <Search size={15} />
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setPage(1)
            }}
            placeholder="标题、项目、提示词"
          />
        </label>
        <select
          className="library-kind-select"
          value={kind}
          onChange={(event) => {
            setKind(event.target.value)
            setPage(1)
          }}
        >
          <option value="">全部类别</option>
          {Object.entries(KIND_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      <div className="asset-library-layout">
        <div className="asset-library-main">
          {loading ? (
            <div className="library-empty">
              <LoaderCircle className="spin" size={22} />
              <span>正在整理资产库</span>
            </div>
          ) : tab === 'duplicates' ? (
            <DuplicateGroups
              groups={duplicates}
              busy={busy}
              onDedupe={() => runAction('dedupe', onDedupe, '重复项已重新标记')}
              onOpenVersions={openVersions}
            />
          ) : (
            <>
              <div className="library-item-list">
                {itemsResult.items.map((item) => (
                  <LibraryItemRow
                    key={item.id}
                    item={item}
                    mode={tab}
                    busy={busy}
                    onOpenVersions={openVersions}
                    onDelete={() => runAction(`delete:${item.id}`, () => onDelete(item.id), '资产已移入回收站')}
                    onRestore={() => runAction(`restore:${item.id}`, () => onRestore(item.id), '资产已恢复')}
                    onPermanentDelete={() =>
                      runAction(
                        `permanent:${item.id}`,
                        () => onPermanentDelete(item.id),
                        '资产记录已永久删除',
                      )
                    }
                  />
                ))}
              </div>
              {itemsResult.items.length === 0 && (
                <div className="library-empty">
                  <PackageOpen size={22} />
                  <span>{tab === 'trash' ? '回收站为空' : '还没有符合条件的资产'}</span>
                </div>
              )}
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
          )}
        </div>

        <aside className="asset-library-side">
          <div className="library-side-section">
            <h2>分类统计</h2>
            {activeKinds.map((item) => (
              <div className="library-kind-row" key={item.kind}>
                <span>{KIND_LABELS[item.kind] || item.kind}</span>
                <strong>{item.count}</strong>
              </div>
            ))}
            {activeKinds.length === 0 && <p>暂无分类数据</p>}
          </div>
          <div className="library-side-section">
            <h2>当前项目</h2>
            <p>{currentProject?.name || '未选择项目'}</p>
          </div>
          {selectedItem && (
            <div className="library-side-section version-drawer">
              <div className="library-version-heading">
                <h2>{selectedItem.title}</h2>
                <button className="icon-button" type="button" onClick={() => setSelectedItem(null)}>
                  ×
                </button>
              </div>
              <p>当前版本 v{selectedItem.currentVersion}</p>
              {busy === `versions:${selectedItem.id}` ? (
                <LoaderCircle className="spin" size={18} />
              ) : (
                versions.map((version) => (
                  <a className="library-version-row" href={version.downloadUrl} key={version.id}>
                    <span>v{version.version}</span>
                    <small>{new Date(version.createdAt).toLocaleString()}</small>
                    <Download size={14} />
                  </a>
                ))
              )}
            </div>
          )}
        </aside>
      </div>
    </section>
  )
}

function Metric({ label, value }) {
  return (
    <div className="library-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function DuplicateGroups({ groups, busy, onDedupe, onOpenVersions }) {
  if (!groups.length) {
    return (
      <div className="library-empty">
        <CopyCheck size={22} />
        <span>没有检测到重复资产</span>
      </div>
    )
  }
  return (
    <div className="library-duplicate-groups">
      <div className="library-duplicate-action">
        <p>检测到 {groups.length} 组内容重复的资产，可统一标记主资产和副本。</p>
        <button className="button primary" disabled={Boolean(busy)} onClick={onDedupe} type="button">
          {busy === 'dedupe' ? <LoaderCircle className="spin" size={15} /> : <Boxes size={15} />}
          执行去重
        </button>
      </div>
      {groups.map((group) => (
        <div className="library-duplicate-group" key={`${group.kind}:${group.contentHash}`}>
          <div className="library-duplicate-line" />
          <div className="library-duplicate-summary">
            <strong>{KIND_LABELS[group.kind] || group.kind}</strong>
            <span>{group.itemCount} 项相同内容</span>
            <span>可减少重复占用 {formatBytes(group.wastedBytes)}</span>
          </div>
          {group.items.map((item) => (
            <LibraryItemRow
              key={item.id}
              item={item}
              mode="duplicates"
              busy={busy}
              onOpenVersions={onOpenVersions}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

function LibraryItemRow({
  item,
  mode,
  busy,
  onOpenVersions,
  onDelete,
  onRestore,
  onPermanentDelete,
}) {
  const Icon = KIND_ICONS[item.kind] || PackageOpen
  return (
    <div className={`library-item-row ${item.duplicateOfItemId ? 'duplicate' : ''}`}>
      <div className="library-item-icon">
        <Icon size={18} />
      </div>
      <div className="library-item-main">
        <div className="library-item-title">
          <strong>{item.title}</strong>
          <span>{KIND_LABELS[item.kind] || item.kind}</span>
          {item.duplicateOfItemId && <em>副本</em>}
        </div>
        <div className="library-item-meta">
          <span>{item.sourceProjectName || '未标注项目'}</span>
          <span>{formatBytes(item.sizeBytes)}</span>
          <span>v{item.currentVersion}</span>
          <span>{new Date(item.createdAt).toLocaleDateString()}</span>
        </div>
      </div>
      <div className="library-item-actions">
        <button className="button secondary" type="button" onClick={() => onOpenVersions(item)}>
          版本
        </button>
        <a className="button secondary" href={item.downloadUrl}>
          <Download size={14} /> 下载
        </a>
        <a className="button secondary" href={item.packageUrl}>
          <PackageOpen size={14} /> 包
        </a>
        {mode === 'trash' ? (
          <>
            <button
              className="button secondary"
              disabled={busy === `restore:${item.id}`}
              onClick={onRestore}
              type="button"
            >
              <ArchiveRestore size={14} /> 恢复
            </button>
            <button
              className="button danger"
              disabled={busy === `permanent:${item.id}`}
              onClick={onPermanentDelete}
              type="button"
            >
              <Trash2 size={14} /> 永久删除
            </button>
          </>
        ) : (
          onDelete && (
            <button
              className="button secondary"
              disabled={busy === `delete:${item.id}`}
              onClick={onDelete}
              type="button"
            >
              <Trash2 size={14} /> 删除
            </button>
          )
        )}
      </div>
    </div>
  )
}

function formatBytes(value) {
  if (!Number.isFinite(value) || value <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let size = value
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024
    unit += 1
  }
  return `${size >= 10 || unit === 0 ? Math.round(size) : size.toFixed(1)} ${units[unit]}`
}
