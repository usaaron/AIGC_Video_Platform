import { Building2, FileText, MoreHorizontal, Power, ShieldCheck, X } from 'lucide-react'
import { roleName, statusName } from '../adminConsole'
import { disabledButtonProps } from './AdminUi'
import { consolePageSizeOptions, consoleRoleFilterOptions, consoleStatusFilterOptions } from './adminDomain'

export function ConsoleServerControls({
  filters,
  query,
  loading,
  organizations,
  organizationPlaceholder,
  activeMeta,
  onFilterChange,
  onClear,
  onPageSizeChange,
  onPageOffsetChange,
}) {
  const limit = activeMeta?.limit ?? filters.limit
  const offset = activeMeta?.offset ?? filters.offset
  const total = activeMeta?.total ?? 0
  const from = total ? offset + 1 : 0
  const to = Math.min(offset + limit, total)
  const hasPrevious = offset > 0
  const hasNext = offset + limit < total
  const hasActiveList = Boolean(activeMeta)
  const summary = !hasActiveList
    ? '筛选会应用到用户、组织、成员、账单、Session 和审计列表'
    : loading
      ? '正在读取服务端列表'
      : `服务端分页 ${from}-${to} / ${total}`

  return (
    <section className="server-list-controls">
      <div className="server-filter-row">
        <label>
          <Building2 size={14} />
          <select
            value={filters.tenantId}
            onChange={(event) => onFilterChange({ tenantId: event.target.value })}
          >
            <option value="">{organizationPlaceholder}</option>
            {organizations.map((organization) => (
              <option key={organization.id} value={organization.id}>
                {organization.name} · {organization.id}
              </option>
            ))}
          </select>
        </label>
        <label>
          <ShieldCheck size={14} />
          <select value={filters.role} onChange={(event) => onFilterChange({ role: event.target.value })}>
            <option value="">全部身份</option>
            {consoleRoleFilterOptions.map((role) => (
              <option key={role} value={role}>
                {roleName(role)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <Power size={14} />
          <select value={filters.status} onChange={(event) => onFilterChange({ status: event.target.value })}>
            <option value="">全部状态</option>
            {consoleStatusFilterOptions.map((status) => (
              <option key={status} value={status}>
                {statusName(status)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <FileText size={14} />
          <select value={filters.limit} onChange={(event) => onPageSizeChange(event.target.value)}>
            {consolePageSizeOptions.map((size) => (
              <option key={size} value={size}>
                每页 {size}
              </option>
            ))}
          </select>
        </label>
        <button
          className="row-button"
          type="button"
          {...disabledButtonProps(
            !query && !filters.tenantId && !filters.role && !filters.status && filters.limit === 50,
            '当前没有可清空的筛选条件',
            '清空搜索、组织、身份、状态和分页筛选',
          )}
          onClick={onClear}
        >
          <X size={14} />
          清空筛选
        </button>
      </div>

      <ListPaginationRow
        summary={summary}
        loading={loading}
        hasPrevious={hasPrevious}
        hasNext={hasNext}
        onPrevious={hasActiveList ? () => onPageOffsetChange(Math.max(0, offset - limit)) : null}
        onNext={hasActiveList ? () => onPageOffsetChange(offset + limit) : null}
      />
    </section>
  )
}

export function ConsolePaginationFooter({ activeMeta, loading, onPageOffsetChange }) {
  if (!activeMeta) return null
  const limit = activeMeta.limit
  const offset = activeMeta.offset
  const total = activeMeta.total
  const from = total ? offset + 1 : 0
  const to = Math.min(offset + limit, total)
  const hasPrevious = offset > 0
  const hasNext = offset + limit < total

  return (
    <section className="list-pagination-footer" aria-label="列表底部分页">
      <ListPaginationRow
        summary={loading ? '正在读取服务端列表' : `服务端分页 ${from}-${to} / ${total}`}
        loading={loading}
        hasPrevious={hasPrevious}
        hasNext={hasNext}
        onPrevious={() => onPageOffsetChange(Math.max(0, offset - limit))}
        onNext={() => onPageOffsetChange(offset + limit)}
      />
    </section>
  )
}

export function ListPaginationRow({ summary, loading, hasPrevious, hasNext, onPrevious, onNext }) {
  const canPaginate = Boolean(onPrevious && onNext)
  return (
    <div className="server-pagination-row">
      <span>{summary}</span>
      {canPaginate && (
        <div>
          <button
            className="row-button"
            type="button"
            {...disabledButtonProps(
              !hasPrevious || loading,
              loading ? '正在读取服务端列表' : '已经是第一页',
              '查看上一页服务端数据',
            )}
            onClick={onPrevious}
          >
            上一页
          </button>
          <button
            className="row-button"
            type="button"
            {...disabledButtonProps(
              !hasNext || loading,
              loading ? '正在读取服务端列表' : '已经是最后一页',
              '查看下一页服务端数据',
            )}
            onClick={onNext}
          >
            下一页
          </button>
        </div>
      )}
    </div>
  )
}

export function RowMoreMenu({ title = '打开更多操作', children }) {
  return (
    <details className="row-more-menu">
      <summary title={title} aria-label={title}>
        <MoreHorizontal size={14} />
        <span>更多</span>
      </summary>
      <div>{children}</div>
    </details>
  )
}
