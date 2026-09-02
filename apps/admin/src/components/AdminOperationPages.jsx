import {
  AlertTriangle,
  Building2,
  Check,
  Crown,
  Filter,
  FileText,
  LoaderCircle,
  MailPlus,
  PencilLine,
  Power,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  UsersRound,
  X,
} from 'lucide-react'
import {
  canManageBillingAccount,
  canManageMembership,
  canUpdateMembershipPlan,
  filterRows,
  formatDate,
  planName,
  statusName,
  organizationTypeName,
} from '../adminConsole'
import {
  complianceCategoryLabels,
  tooltipProps,
  disabledButtonProps,
  DataSection,
  IdentityCell,
  ComplianceRiskTags,
  ComplianceReviewBadge,
  StatusBadge,
  complianceSourceName,
  StatusPair,
  RolePills,
  RoleEditor,
  EmptyRow,
} from './AdminUi'
import {
  summarizeInvitationStatuses,
  summarizeComplianceQueues,
  complianceQueueCards,
} from './adminViewHelpers'
import { canCreatePlatformInvitation, organizationInvitationRoleOptions } from './adminDomain'
import { ListPaginationRow, RowMoreMenu } from './AdminConsoleControls'
import { LoadingScreen } from './AppChrome'
import { consolePageSizeOptions } from './adminDomain'

export function MembershipsTable({
  memberships,
  session,
  canAdjustBilling,
  busy,
  onOpenDetail,
  onUpdateRole,
  onDisableMembership,
  onAdjust,
  onUpdatePlan,
}) {
  return (
    <DataSection title="账号归属查询" count={memberships.length}>
      <table className="data-table wide">
        <thead>
          <tr>
            <th>账号</th>
            <th>归属</th>
            <th>状态</th>
            <th>角色</th>
            <th>套餐</th>
            <th>积分</th>
            <th>更新时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {memberships.map((membership) => (
            <tr key={membership.id}>
              <td>
                <IdentityCell name={membership.name} detail={membership.email ?? membership.userId} />
              </td>
              <td>
                <IdentityCell name={membership.tenantName} detail={membership.tenantId} compact />
              </td>
              <td>
                <StatusPair
                  primary={membership.membershipStatus ?? membership.status}
                  secondary={membership.userStatus}
                />
              </td>
              <td>
                <RoleEditor
                  membership={membership}
                  session={session}
                  busy={busy === `member-role:${membership.id}`}
                  onUpdateRole={onUpdateRole}
                />
              </td>
              <td>{planName(membership.plan)}</td>
              <td>{membership.credits}</td>
              <td>{formatDate(membership.updatedAt)}</td>
              <td>
                <div className="row-actions">
                  <button
                    className="row-button"
                    type="button"
                    {...tooltipProps('查看该账号归属的详情、账单和关联 Session')}
                    onClick={() => onOpenDetail(membership)}
                  >
                    <FileText size={14} />
                    详情
                  </button>
                  <button
                    className="row-button"
                    type="button"
                    {...disabledButtonProps(
                      !canAdjustBilling || !canManageBillingAccount(session, membership),
                      !canAdjustBilling ? '当前身份不能调账' : '当前身份不能调整该账号归属的积分',
                      '更改该账号归属的积分余额',
                    )}
                    onClick={() => onAdjust(membership)}
                  >
                    <PencilLine size={14} />
                    调账
                  </button>
                  <button
                    className="row-button"
                    type="button"
                    {...disabledButtonProps(
                      !canUpdateMembershipPlan(session, membership),
                      '当前身份不能修改该账号归属的套餐',
                      '修改套餐，必要时发放会员积分',
                    )}
                    onClick={() => onUpdatePlan(membership)}
                  >
                    <Crown size={14} />
                    改套餐/冲会员
                  </button>
                  <RowMoreMenu title="打开更多账号归属操作">
                    <button
                      className="row-button danger"
                      type="button"
                      {...disabledButtonProps(
                        membership.status !== 'active' ||
                          !canManageMembership(session, membership) ||
                          busy === `member-disable:${membership.id}`,
                        membership.status !== 'active'
                          ? '该归属已经不是启用状态'
                          : !canManageMembership(session, membership)
                            ? '当前身份不能移除该账号归属'
                            : '正在移除该账号归属',
                        '移除该账号与当前组织/空间的归属关系',
                      )}
                      onClick={() => onDisableMembership(membership)}
                    >
                      {busy === `member-disable:${membership.id}` ? (
                        <LoaderCircle size={14} className="spin" />
                      ) : (
                        <Power size={14} />
                      )}
                      移除
                    </button>
                  </RowMoreMenu>
                </div>
              </td>
            </tr>
          ))}
          <EmptyRow visible={!memberships.length} columns={8} />
        </tbody>
      </table>
    </DataSection>
  )
}

export function ComplianceReviewPage({
  prompts,
  allPrompts,
  meta,
  generatedAt,
  filters,
  loading,
  error,
  busy,
  currentUserId,
  onFilterChange,
  onClear,
  onRefresh,
  onSample,
  onPageOffsetChange,
  onOpenDetail,
  onOpenUser,
  onOpenOrganization,
  onReview,
  onWarn,
  onDisableUser,
}) {
  const offset = filters.sample ? 0 : meta.offset
  const from = meta.total ? offset + 1 : 0
  const to = Math.min(offset + meta.limit, meta.total)
  const hasPrevious = offset > 0
  const hasNext = offset + meta.limit < meta.total && !filters.sample
  const riskCount = allPrompts.filter((item) => item.riskTags.length > 0).length
  const queueSummary = summarizeComplianceQueues(allPrompts)
  const compliancePaginationSummary = [
    loading
      ? '正在读取审查样本'
      : filters.sample
        ? `随机抽查 ${allPrompts.length} 条 / 匹配 ${meta.total} 条`
        : `审查分页 ${from}-${to} / ${meta.total}`,
    generatedAt ? formatDate(generatedAt) : '',
    filters.category !== 'all' ? `当前风险筛选 ${prompts.length} 条` : '',
    filters.queue !== 'all' ? `队列筛选 ${prompts.length} 条` : '',
    riskCount ? `风险命中 ${riskCount} 条` : '',
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="compliance-page">
      <section className="compliance-queue-grid" aria-label="审查队列">
        {complianceQueueCards(queueSummary).map((card) => (
          <button
            key={card.id}
            type="button"
            className={filters.queue === card.id ? 'compliance-queue-card active' : 'compliance-queue-card'}
            onClick={() => onFilterChange({ queue: card.id }, { resetOffset: false })}
          >
            <card.icon size={16} />
            <span>{card.label}</span>
            <strong>{card.value}</strong>
          </button>
        ))}
      </section>
      <section className="server-list-controls compliance-controls">
        <div className="server-filter-row">
          <label>
            <Search size={14} />
            <input
              value={filters.q}
              onChange={(event) => onFilterChange({ q: event.target.value })}
              placeholder="搜索 prompt、用户、组织或任务"
            />
          </label>
          <label>
            <UsersRound size={14} />
            <input
              value={filters.userId}
              onChange={(event) => onFilterChange({ userId: event.target.value })}
              placeholder="指定用户 ID"
            />
          </label>
          <label>
            <Building2 size={14} />
            <input
              value={filters.tenantId}
              onChange={(event) => onFilterChange({ tenantId: event.target.value })}
              placeholder="指定组织/空间 ID"
            />
          </label>
          <label>
            <FileText size={14} />
            <select
              value={filters.source}
              onChange={(event) => onFilterChange({ source: event.target.value })}
            >
              <option value="">全部来源</option>
              <option value="generation_task">生成任务</option>
              <option value="ai_job">AI Job</option>
            </select>
          </label>
          <label>
            <ShieldAlert size={14} />
            <select
              value={filters.category}
              onChange={(event) => onFilterChange({ category: event.target.value }, { resetOffset: false })}
            >
              <option value="all">全部风险</option>
              <option value="none">无命中</option>
              {Object.entries(complianceCategoryLabels).map(([category, label]) => (
                <option key={category} value={category}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <ShieldCheck size={14} />
            <select
              value={filters.queue}
              onChange={(event) => onFilterChange({ queue: event.target.value }, { resetOffset: false })}
            >
              <option value="all">全部队列</option>
              <option value="high-risk">高风险</option>
              <option value="pending">待审查</option>
              <option value="warned">已警告</option>
              <option value="reviewed">已审查</option>
              <option value="disabled">已封号</option>
            </select>
          </label>
          <label>
            <FileText size={14} />
            <select
              value={filters.limit}
              onChange={(event) => onFilterChange({ limit: Number(event.target.value) })}
            >
              {consolePageSizeOptions.map((size) => (
                <option key={size} value={size}>
                  每页 {size}
                </option>
              ))}
            </select>
          </label>
          <button className="row-button" type="button" onClick={onClear}>
            <X size={14} />
            清空筛选
          </button>
          <button className="row-button" type="button" disabled={loading} onClick={onRefresh}>
            {loading ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />}
            刷新
          </button>
          <button className="primary-button" type="button" disabled={loading} onClick={onSample}>
            {loading ? <LoaderCircle size={14} className="spin" /> : <Filter size={14} />}
            随机抽查
          </button>
        </div>
        <ListPaginationRow
          summary={compliancePaginationSummary}
          loading={loading}
          hasPrevious={hasPrevious}
          hasNext={hasNext}
          onPrevious={() => onPageOffsetChange(Math.max(0, offset - meta.limit))}
          onNext={() => onPageOffsetChange(offset + meta.limit)}
        />
      </section>

      {error && <div className="notice error">{error}</div>}

      <DataSection title="提示词审查" count={prompts.length}>
        <table className="data-table wide compliance-table">
          <thead>
            <tr>
              <th>账号</th>
              <th>归属</th>
              <th>提示词预览</th>
              <th>风险</th>
              <th>审查</th>
              <th>来源</th>
              <th>时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {prompts.map((item) => {
              const actionBusy = busy.startsWith(`compliance:${item.id}`)
              const accountBusy = busy === `user:${item.userId}`
              return (
                <tr key={item.id}>
                  <td>
                    <IdentityCell name={item.name} detail={item.email ?? item.userId} />
                  </td>
                  <td>
                    <IdentityCell
                      name={item.tenantName ?? item.tenantId}
                      detail={organizationTypeName(item.organizationType ?? 'standard')}
                      compact
                    />
                  </td>
                  <td>
                    <div className="prompt-preview">
                      <strong>{item.label}</strong>
                      <span>{item.promptPreview || '-'}</span>
                    </div>
                  </td>
                  <td>
                    <ComplianceRiskTags tags={item.riskTags} />
                  </td>
                  <td>
                    <ComplianceReviewBadge item={item} />
                  </td>
                  <td>
                    <div className="source-stack">
                      <strong>{complianceSourceName(item.source)}</strong>
                      <small>
                        {item.kind} · {item.status}
                      </small>
                    </div>
                  </td>
                  <td>{formatDate(item.createdAt)}</td>
                  <td>
                    <div className="row-actions">
                      <button
                        className="row-button"
                        type="button"
                        {...tooltipProps('查看提示词、风险标签和审查动作历史')}
                        onClick={() => onOpenDetail(item)}
                      >
                        <FileText size={14} />
                        详情
                      </button>
                      <button
                        className="row-button"
                        type="button"
                        {...disabledButtonProps(actionBusy, '正在记录审查动作', '标记该提示词已人工审查')}
                        onClick={() => onReview(item)}
                      >
                        {actionBusy ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />}
                        已审查
                      </button>
                      <RowMoreMenu title="打开更多审查操作">
                        <button
                          className="row-button"
                          type="button"
                          {...tooltipProps('打开该提示词所属账号详情')}
                          onClick={() => onOpenUser(item)}
                        >
                          <UsersRound size={14} />
                          账号
                        </button>
                        <button
                          className="row-button"
                          type="button"
                          {...tooltipProps('打开该提示词所属组织或空间详情')}
                          onClick={() => onOpenOrganization(item)}
                        >
                          <Building2 size={14} />
                          归属
                        </button>
                        <button
                          className="row-button"
                          type="button"
                          {...disabledButtonProps(actionBusy, '正在记录审查动作', '给该账号发送合规警告')}
                          onClick={() => onWarn(item)}
                        >
                          <AlertTriangle size={14} />
                          警告
                        </button>
                        <button
                          className="row-button danger"
                          type="button"
                          {...disabledButtonProps(
                            item.userStatus !== 'active' || item.userId === currentUserId || accountBusy,
                            item.userStatus !== 'active'
                              ? '账号已禁用'
                              : item.userId === currentUserId
                                ? '不能封禁当前登录账号'
                                : '正在更新账号状态',
                          )}
                          onClick={() => onDisableUser(item)}
                        >
                          {accountBusy ? <LoaderCircle size={14} className="spin" /> : <Power size={14} />}
                          封号
                        </button>
                      </RowMoreMenu>
                    </div>
                  </td>
                </tr>
              )
            })}
            <EmptyRow visible={!prompts.length && !loading} columns={8} />
          </tbody>
        </table>
      </DataSection>
      <section className="list-pagination-footer" aria-label="合规审查底部分页">
        <ListPaginationRow
          summary={compliancePaginationSummary}
          loading={loading}
          hasPrevious={hasPrevious}
          hasNext={hasNext}
          onPrevious={() => onPageOffsetChange(Math.max(0, offset - meta.limit))}
          onNext={() => onPageOffsetChange(offset + meta.limit)}
        />
      </section>
    </div>
  )
}

export function InvitationsPage({
  organizations,
  selectedOrganization,
  selectedOrganizationId,
  platformInvitations,
  platformLoading,
  platformError,
  invitations,
  loading,
  error,
  session,
  busy,
  query,
  platformStatusFilter,
  onPlatformStatusFilterChange,
  statusFilter,
  onStatusFilterChange,
  onSelectOrganization,
  onCreatePlatformInvitation,
  onCreateOrganizationInvitation,
  onBatchOrganizationInvitation,
  onRefreshPlatform,
  onRevokePlatform,
  onRefresh,
  onReissue,
  onRevoke,
}) {
  const canCreateMemberInvitation = canCreatePlatformInvitation(session)
  const organizationRoles = organizationInvitationRoleOptions(session, selectedOrganization)
  const canCreateOrganizationMember =
    selectedOrganization?.status === 'active' && organizationRoles.includes('organization_member')
  const canCreateOrganizationAdmin =
    selectedOrganization?.status === 'active' && organizationRoles.includes('organization_admin')
  const organizationInactiveReason =
    selectedOrganization && selectedOrganization.status !== 'active' ? '企业组织已禁用，不能创建邀请' : ''
  const statusCounts = summarizeInvitationStatuses(invitations)
  const visibleInvitations = filterRows(
    statusFilter === 'all'
      ? invitations
      : invitations.filter((invitation) => invitation.status === statusFilter),
    query,
  )
  const platformStatusCounts = summarizeInvitationStatuses(platformInvitations)
  const visiblePlatformInvitations = filterRows(
    platformStatusFilter === 'all'
      ? platformInvitations
      : platformInvitations.filter((invitation) => invitation.status === platformStatusFilter),
    query,
  )

  return (
    <div className="invitation-page-layout">
      <DataSection title="普通成员邀请" count={visiblePlatformInvitations.length}>
        <div className="inline-filter-bar invitation-page-toolbar">
          <label>
            <Filter size={14} />
            <select
              value={platformStatusFilter}
              onChange={(event) => onPlatformStatusFilterChange(event.target.value)}
            >
              <option value="all">全部状态 · {platformInvitations.length}</option>
              <option value="pending">待接受 · {platformStatusCounts.pending}</option>
              <option value="accepted">已接受 · {platformStatusCounts.accepted}</option>
              <option value="revoked">已撤销 · {platformStatusCounts.revoked}</option>
              <option value="expired">已过期 · {platformStatusCounts.expired}</option>
            </select>
          </label>
          <button
            className="primary-button"
            type="button"
            {...disabledButtonProps(
              !canCreateMemberInvitation || busy === 'create-invitation',
              !canCreateMemberInvitation ? '当前身份不能邀请成员' : '正在创建邀请',
            )}
            onClick={onCreatePlatformInvitation}
          >
            {busy === 'create-invitation' ? (
              <LoaderCircle size={14} className="spin" />
            ) : (
              <MailPlus size={14} />
            )}
            邀请成员
          </button>
          <button
            className="row-button"
            type="button"
            {...disabledButtonProps(platformLoading, '正在刷新普通成员邀请')}
            onClick={onRefreshPlatform}
          >
            {platformLoading ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />}
            刷新列表
          </button>
        </div>
        <section className="organization-detail-head invitation-page-head">
          <IdentityCell name="普通成员注册" detail="platform_registration" />
          <div>
            <span>待接受</span>
            <strong>{platformStatusCounts.pending}</strong>
          </div>
          <div>
            <span>已接受</span>
            <strong>{platformStatusCounts.accepted}</strong>
          </div>
          <span className="invitation-scope-badge">个人空间</span>
        </section>
        {platformError && <div className="notice error">{platformError}</div>}
        {platformLoading && !platformInvitations.length ? (
          <LoadingScreen compact label="正在读取普通成员邀请" />
        ) : (
          <InvitationCards
            invitations={visiblePlatformInvitations}
            busy={busy}
            revokeBusyPrefix="platform-invitation-revoke"
            onRevoke={onRevokePlatform}
          />
        )}
        <p className="modal-hint">
          普通成员邀请只创建平台 member 账号；受邀人注册后自动获得个人空间，不进入企业组织列表。
        </p>
      </DataSection>

      <DataSection title="企业组织邀请" count={visibleInvitations.length}>
        <div className="inline-filter-bar invitation-page-toolbar">
          <label>
            <Building2 size={14} />
            <select
              value={selectedOrganizationId}
              onChange={(event) => onSelectOrganization(event.target.value)}
              {...disabledButtonProps(!organizations.length, '暂无当前身份可管理的企业组织')}
            >
              {organizations.map((organization) => (
                <option key={organization.id} value={organization.id}>
                  {organization.name} · {organization.id}
                </option>
              ))}
            </select>
          </label>
          <label>
            <Filter size={14} />
            <select value={statusFilter} onChange={(event) => onStatusFilterChange(event.target.value)}>
              <option value="all">全部状态 · {invitations.length}</option>
              <option value="pending">待接受 · {statusCounts.pending}</option>
              <option value="accepted">已接受 · {statusCounts.accepted}</option>
              <option value="revoked">已撤销 · {statusCounts.revoked}</option>
              <option value="expired">已过期 · {statusCounts.expired}</option>
            </select>
          </label>
          <button
            className="primary-button"
            type="button"
            {...disabledButtonProps(
              !canCreateOrganizationMember || busy === 'create-invitation',
              organizationInactiveReason ||
                (!canCreateOrganizationMember ? '当前身份不能邀请组织成员' : '正在创建邀请'),
            )}
            onClick={() => onCreateOrganizationInvitation('organization_member')}
          >
            {busy === 'create-invitation' ? (
              <LoaderCircle size={14} className="spin" />
            ) : (
              <MailPlus size={14} />
            )}
            邀请组织成员
          </button>
          <button
            className="row-button"
            type="button"
            {...disabledButtonProps(
              !canCreateOrganizationAdmin || busy === 'create-invitation',
              organizationInactiveReason ||
                (!canCreateOrganizationAdmin ? '当前身份不能邀请组织管理员' : '正在创建邀请'),
            )}
            onClick={() => onCreateOrganizationInvitation('organization_admin')}
          >
            {busy === 'create-invitation' ? <LoaderCircle size={14} className="spin" /> : <Crown size={14} />}
            邀请组织管理员
          </button>
          <button
            className="row-button"
            type="button"
            {...disabledButtonProps(
              !canCreateOrganizationMember || busy === 'batch-organization-invitations',
              organizationInactiveReason ||
                (!canCreateOrganizationMember ? '当前身份不能批量邀请组织成员' : '正在批量邀请'),
            )}
            onClick={() => onBatchOrganizationInvitation('organization_member')}
          >
            {busy === 'batch-organization-invitations' ? (
              <LoaderCircle size={14} className="spin" />
            ) : (
              <MailPlus size={14} />
            )}
            批量邀请成员
          </button>
          <button
            className="row-button"
            type="button"
            {...disabledButtonProps(
              !selectedOrganization || loading,
              !selectedOrganization ? '请先选择企业组织' : '正在刷新组织邀请',
            )}
            onClick={onRefresh}
          >
            {loading ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />}
            刷新列表
          </button>
        </div>
        {selectedOrganization ? (
          <section className="organization-detail-head invitation-page-head">
            <IdentityCell name={selectedOrganization.name} detail={selectedOrganization.id} />
            <div>
              <span>待接受</span>
              <strong>{statusCounts.pending}</strong>
            </div>
            <div>
              <span>已接受</span>
              <strong>{statusCounts.accepted}</strong>
            </div>
            <StatusBadge status={selectedOrganization.status} />
          </section>
        ) : (
          <p className="panel-empty">暂无可管理的企业组织。</p>
        )}
        {error && <div className="notice error">{error}</div>}
        {loading && !invitations.length ? (
          <LoadingScreen compact label="正在读取邀请列表" />
        ) : (
          <InvitationCards
            invitations={visibleInvitations}
            canReissueInvitation={(invitation) =>
              selectedOrganization?.status === 'active' &&
              invitation.roles.every((role) => organizationRoles.includes(role))
            }
            busy={busy}
            onReissue={onReissue}
            onRevoke={onRevoke}
          />
        )}
        <p className="modal-hint">明文邀请码只在创建或重新生成后显示一次；历史列表只保存状态和时间。</p>
      </DataSection>
    </div>
  )
}

export function InvitationCards({
  invitations,
  canReissueInvitation = (_invitation) => false,
  busy,
  reissueBusyPrefix = 'invitation-reissue',
  revokeBusyPrefix = 'invitation-revoke',
  onReissue = null,
  onRevoke,
}) {
  return (
    <div className="invitation-list">
      {invitations.map((invitation) => (
        <article key={invitation.id} className="invitation-card">
          <header>
            <div>
              <strong>{invitation.email}</strong>
              <small>{invitation.id}</small>
            </div>
            <InvitationStatusBadge status={invitation.status} />
          </header>
          <div className="invitation-card-grid">
            <div>
              <span>身份</span>
              <RolePills roles={invitation.roles} />
            </div>
            <div>
              <span>创建时间</span>
              <strong>{formatDate(invitation.createdAt)}</strong>
            </div>
            <div>
              <span>过期时间</span>
              <strong>{formatDate(invitation.expiresAt)}</strong>
            </div>
            <div>
              <span>完成时间</span>
              <strong>{invitation.acceptedAt ? formatDate(invitation.acceptedAt) : '-'}</strong>
            </div>
            <div>
              <span>撤销时间</span>
              <strong>{invitation.revokedAt ? formatDate(invitation.revokedAt) : '-'}</strong>
            </div>
          </div>
          <footer>
            {onReissue && (
              <button
                className="row-button"
                type="button"
                disabled={
                  !canReissueInvitation(invitation) ||
                  invitation.status === 'accepted' ||
                  busy === `${reissueBusyPrefix}:${invitation.id}`
                }
                onClick={() => onReissue(invitation)}
              >
                {busy === `${reissueBusyPrefix}:${invitation.id}` ? (
                  <LoaderCircle size={14} className="spin" />
                ) : (
                  <RefreshCw size={14} />
                )}
                重新生成
              </button>
            )}
            <button
              className="row-button danger"
              type="button"
              disabled={invitation.status !== 'pending' || busy === `${revokeBusyPrefix}:${invitation.id}`}
              onClick={() => onRevoke(invitation)}
            >
              {busy === `${revokeBusyPrefix}:${invitation.id}` ? (
                <LoaderCircle size={14} className="spin" />
              ) : (
                <Power size={14} />
              )}
              撤销
            </button>
          </footer>
        </article>
      ))}
      {!invitations.length && <p className="panel-empty">暂无邀请记录。</p>}
    </div>
  )
}

export function InvitationStatusBadge({ status }) {
  const labels = {
    pending: '待接受',
    accepted: '已接受',
    revoked: '已撤销',
    expired: '已过期',
  }
  return <span className={`invitation-status-badge ${status}`}>{labels[status] ?? statusName(status)}</span>
}
