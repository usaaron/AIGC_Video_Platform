import {
  Building2,
  CreditCard,
  Crown,
  FileText,
  KeyRound,
  LoaderCircle,
  MailPlus,
  PencilLine,
  Plus,
  Power,
  ShieldCheck,
  Trash2,
  UserPlus,
} from 'lucide-react'
import {
  canAddExistingOrganizationMember,
  canCreateOrganization,
  canCreateOrganizationUser,
  canDisableOrganization,
  canManageBillingAccount,
  canManageOrganization,
  canManageUsers,
  canReadOrganizationBilling,
  canTransferOrganizationAdmin,
  canUpdateMembershipPlan,
  classifyOrganization,
  formatDate,
  planName,
  organizationTypeName,
} from '../adminConsole'
import {
  tooltipProps,
  disabledButtonProps,
  DataSection,
  IdentityCell,
  StatusBadge,
  PasswordResetBadge,
  StatusPair,
  RolePills,
  RoleEditor,
  OrganizationTypeBadge,
  EmptyRow,
} from './AdminUi'
import { canCreatePlatformInvitation, organizationInvitationRoleOptions } from './adminDomain'
import { RowMoreMenu } from './AdminConsoleControls'

export function UsersTable({
  users,
  currentUserId,
  canManage,
  busy,
  onOpenDetail,
  onSetStatus,
  onDeleteUser,
  onOpenPasswordReset,
  onForcePasswordReset,
}) {
  return (
    <DataSection title="用户列表" count={users.length}>
      <table className="data-table wide">
        <thead>
          <tr>
            <th>用户</th>
            <th>状态</th>
            <th>安全</th>
            <th>角色</th>
            <th>账号归属</th>
            <th>更新时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => {
            const deleted = user.status === 'deleted'
            return (
              <tr key={user.id}>
                <td>
                  <IdentityCell name={user.name} detail={user.email ?? user.id} />
                </td>
                <td>
                  <StatusBadge status={user.status} />
                </td>
                <td>
                  <PasswordResetBadge required={user.passwordResetRequired} />
                </td>
                <td>
                  <RolePills roles={user.roles} />
                </td>
                <td>
                  {user.activeMembershipCount} / {user.membershipCount}
                </td>
                <td>{formatDate(user.updatedAt)}</td>
                <td>
                  <div className="row-actions">
                    <button
                      className="row-button"
                      type="button"
                      {...tooltipProps('查看用户详情、所属组织、账单和 Session')}
                      onClick={() => onOpenDetail(user)}
                    >
                      <FileText size={14} />
                      详情
                    </button>
                    <button
                      className="row-button"
                      type="button"
                      disabled={
                        !canManage || user.id === currentUserId || deleted || busy === `password:${user.id}`
                      }
                      {...tooltipProps(
                        !canManage
                          ? '当前身份不能设置临时密码'
                          : user.id === currentUserId
                            ? '不能给当前登录账号设置临时密码'
                            : deleted
                              ? '账号已删除，不能设置临时密码'
                              : busy === `password:${user.id}`
                                ? '正在设置临时密码'
                                : '设置新的临时密码，并可要求用户下次登录修改',
                      )}
                      onClick={() => onOpenPasswordReset(user)}
                    >
                      {busy === `password:${user.id}` ? (
                        <LoaderCircle size={14} className="spin" />
                      ) : (
                        <KeyRound size={14} />
                      )}
                      重置临时密码
                    </button>
                    <RowMoreMenu title="打开更多用户操作">
                      <button
                        className="row-button danger"
                        type="button"
                        disabled={
                          !canManage ||
                          user.id === currentUserId ||
                          deleted ||
                          user.passwordResetRequired ||
                          busy === `force-password:${user.id}`
                        }
                        {...tooltipProps(
                          !canManage
                            ? '当前身份不能强制用户改密'
                            : user.id === currentUserId
                              ? '不能强制当前登录账号改密'
                              : deleted
                                ? '账号已删除，不能强制改密'
                                : user.passwordResetRequired
                                  ? '用户已经需要下次登录改密'
                                  : busy === `force-password:${user.id}`
                                    ? '正在设置强制改密'
                                    : '要求用户下次登录必须修改密码',
                        )}
                        onClick={() => onForcePasswordReset(user)}
                      >
                        {busy === `force-password:${user.id}` ? (
                          <LoaderCircle size={14} className="spin" />
                        ) : (
                          <ShieldCheck size={14} />
                        )}
                        强制改密
                      </button>
                      <button
                        className={user.status === 'active' ? 'row-button danger' : 'row-button'}
                        type="button"
                        disabled={
                          !canManage || user.id === currentUserId || deleted || busy === `user:${user.id}`
                        }
                        {...tooltipProps(
                          !canManage
                            ? '当前身份不能变更账号状态'
                            : user.id === currentUserId
                              ? '不能禁用或启用当前登录账号'
                              : deleted
                                ? '账号已删除，不能变更状态'
                                : busy === `user:${user.id}`
                                  ? '正在更新账号状态'
                                  : user.status === 'active'
                                    ? '禁用账号，阻止继续登录和使用'
                                    : '启用账号，恢复登录和使用',
                        )}
                        onClick={() => onSetStatus(user)}
                      >
                        {busy === `user:${user.id}` ? (
                          <LoaderCircle size={14} className="spin" />
                        ) : (
                          <Power size={14} />
                        )}
                        {deleted ? '已删除' : user.status === 'active' ? '禁用' : '启用'}
                      </button>
                      <button
                        className="row-button danger"
                        type="button"
                        disabled={
                          !canManage ||
                          user.id === currentUserId ||
                          deleted ||
                          busy === `delete-user:${user.id}`
                        }
                        {...tooltipProps(
                          !canManage
                            ? '当前身份不能删除账号'
                            : user.id === currentUserId
                              ? '不能删除当前登录账号'
                              : deleted
                                ? '账号已删除'
                                : busy === `delete-user:${user.id}`
                                  ? '正在删除账号'
                                  : '删除账号，需要两次确认，并禁用该用户所有归属和登录 Session',
                        )}
                        onClick={() => onDeleteUser(user)}
                      >
                        {busy === `delete-user:${user.id}` ? (
                          <LoaderCircle size={14} className="spin" />
                        ) : (
                          <Trash2 size={14} />
                        )}
                        删除账号
                      </button>
                    </RowMoreMenu>
                  </div>
                </td>
              </tr>
            )
          })}
          <EmptyRow visible={!users.length} columns={7} />
        </tbody>
      </table>
    </DataSection>
  )
}

export function PersonalAccountsTable({
  memberships,
  session,
  currentUserId,
  canManage,
  canAdjustBilling,
  busy,
  onOpenDetail,
  onUpdateRole,
  onAdjust,
  onUpdatePlan,
  onOpenPasswordReset,
  onSetStatus,
  onDeleteUser,
  onCreateUser,
  onCreateInvitation,
}) {
  const createUserDisabled = !canManageUsers(session) || busy === 'create-user'
  const createUserDisabledReason = !canManageUsers(session) ? '当前身份不能直接创建账号' : '正在创建账号'
  const createInvitationDisabled = !canCreatePlatformInvitation(session) || busy === 'create-invitation'
  const createInvitationDisabledReason = !canCreatePlatformInvitation(session)
    ? '当前身份不能邀请成员'
    : '正在创建邀请'

  return (
    <DataSection title="个人账号" count={memberships.length}>
      <div className="section-actions leading-actions">
        <button
          className="row-button"
          type="button"
          {...disabledButtonProps(createUserDisabled, createUserDisabledReason)}
          onClick={() => onCreateUser()}
        >
          {busy === 'create-user' ? <LoaderCircle size={14} className="spin" /> : <Plus size={14} />}
          直接创建账号
        </button>
        <button
          className="primary-button"
          type="button"
          {...disabledButtonProps(createInvitationDisabled, createInvitationDisabledReason)}
          onClick={() => onCreateInvitation()}
        >
          {busy === 'create-invitation' ? (
            <LoaderCircle size={14} className="spin" />
          ) : (
            <MailPlus size={14} />
          )}
          邀请成员
        </button>
      </div>
      <table className="data-table wide">
        <thead>
          <tr>
            <th>账号</th>
            <th>身份</th>
            <th>归属</th>
            <th>套餐</th>
            <th>积分</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {memberships.map((membership) => {
            const userTarget = userTargetForMembership(membership)
            const accountBusy = busy === `user:${membership.userId}`
            const passwordBusy = busy === `password:${membership.userId}`
            const canAdjustTarget = canAdjustBilling && canManageBillingAccount(session, membership)
            const canUpdatePlan = canUpdateMembershipPlan(session, membership)
            const passwordDisabled = !canManage || passwordBusy
            const accountDisabled = !canManage || membership.userId === currentUserId || accountBusy
            const deleteBusy = busy === `delete-user:${membership.userId}`
            const deleted = membership.userStatus === 'deleted'
            return (
              <tr key={membership.id}>
                <td>
                  <IdentityCell name={membership.name} detail={membership.email ?? membership.userId} />
                </td>
                <td>
                  <RoleEditor
                    membership={membership}
                    session={session}
                    busy={busy === `member-role:${membership.id}`}
                    onUpdateRole={onUpdateRole}
                  />
                </td>
                <td>
                  <IdentityCell
                    name={membership.tenantName}
                    detail={organizationTypeName(classifyOrganization(membership).type)}
                    compact
                  />
                </td>
                <td>{planName(membership.plan)}</td>
                <td>{membership.credits}</td>
                <td>
                  <StatusPair
                    primary={membership.userStatus}
                    secondary={membership.membershipStatus ?? membership.status}
                  />
                </td>
                <td>
                  <div className="row-actions">
                    <button
                      className="row-button"
                      type="button"
                      {...tooltipProps('查看该账号归属的详情、账单和最近操作')}
                      onClick={() => onOpenDetail(membership)}
                    >
                      <FileText size={14} />
                      详情
                    </button>
                    <button
                      className="row-button"
                      type="button"
                      {...disabledButtonProps(
                        !canAdjustTarget,
                        !canAdjustBilling ? '当前身份不能调账' : '当前身份不能调整该账号归属的账单',
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
                        !canUpdatePlan,
                        '当前身份不能修改该账号归属的套餐',
                        '修改套餐，必要时发放会员积分',
                      )}
                      onClick={() => onUpdatePlan(membership)}
                    >
                      <Crown size={14} />
                      改套餐/冲会员
                    </button>
                    <RowMoreMenu title="打开更多个人账号操作">
                      <button
                        className="row-button"
                        type="button"
                        {...disabledButtonProps(
                          passwordDisabled || deleted,
                          !canManage ? '当前身份不能设置密码' : deleted ? '账号已删除' : '正在设置密码',
                          '设置新的登录密码或临时密码',
                        )}
                        onClick={() => onOpenPasswordReset(userTarget)}
                      >
                        {passwordBusy ? <LoaderCircle size={14} className="spin" /> : <KeyRound size={14} />}
                        设置密码
                      </button>
                      <button
                        className="row-button danger"
                        type="button"
                        {...disabledButtonProps(
                          accountDisabled || deleted,
                          !canManage
                            ? '当前身份不能变更账号状态'
                            : deleted
                              ? '已删除账号不能重新启用'
                              : membership.userId === currentUserId
                                ? '不能禁用或启用当前登录账号'
                                : '正在更新账号状态',
                          membership.userStatus === 'active'
                            ? '禁用账号，阻止继续登录和使用'
                            : '启用账号，恢复登录和使用',
                        )}
                        onClick={() => onSetStatus(userTarget)}
                      >
                        {accountBusy ? <LoaderCircle size={14} className="spin" /> : <Power size={14} />}
                        {membership.userStatus === 'active' ? '禁用账号' : '启用账号'}
                      </button>
                      <button
                        className="row-button danger"
                        type="button"
                        {...disabledButtonProps(
                          !canManage || membership.userId === currentUserId || deleted || deleteBusy,
                          !canManage
                            ? '当前身份不能删除账号'
                            : membership.userId === currentUserId
                              ? '不能删除当前登录账号'
                              : deleted
                                ? '账号已删除'
                                : '正在删除账号',
                          '删除账号，需要两次确认，并禁用该用户所有归属和登录 Session',
                        )}
                        onClick={() => onDeleteUser(userTarget)}
                      >
                        {deleteBusy ? <LoaderCircle size={14} className="spin" /> : <Trash2 size={14} />}
                        删除账号
                      </button>
                    </RowMoreMenu>
                  </div>
                </td>
              </tr>
            )
          })}
          <EmptyRow visible={!memberships.length} columns={7} />
        </tbody>
      </table>
    </DataSection>
  )
}

export function userTargetForMembership(membership) {
  return {
    id: membership.userId,
    name: membership.name,
    email: membership.email,
    status: membership.userStatus,
  }
}

export function OrganizationsTable({
  organizations,
  session,
  busy,
  onOpenDetail,
  onCreateOrganization,
  onCreateOrganizationWithAdmin,
  onRename,
  onDisable,
  onTransferOrganizationAdmin,
  onCreateUser,
  onAddExistingMember,
  onCreateInvitation,
  onManageInvitations,
  onOpenOrganizationBilling,
}) {
  const visibleOrganizations = organizations
  const canCreateNewOrganization = canCreateOrganization(session)
  const createOrganizationDisabled = !canCreateNewOrganization || busy === 'create-organization'
  const createOrganizationReason = !canCreateNewOrganization
    ? '只有 owner 或 super_admin 可以创建企业组织'
    : '正在创建企业组织'
  const createWithAdminDisabled = !canCreateNewOrganization || busy === 'create-organization-with-admin'
  const createWithAdminReason = !canCreateNewOrganization
    ? '只有 owner 或 super_admin 可以创建企业组织'
    : '正在创建企业组织和管理员'

  return (
    <DataSection title="企业组织列表" count={visibleOrganizations.length}>
      <div className="section-actions leading-actions">
        <button
          className="primary-button"
          type="button"
          {...disabledButtonProps(createOrganizationDisabled, createOrganizationReason)}
          onClick={onCreateOrganization}
        >
          {busy === 'create-organization' ? (
            <LoaderCircle size={14} className="spin" />
          ) : (
            <Building2 size={14} />
          )}
          创建企业组织
        </button>
        <button
          className="row-button"
          type="button"
          {...disabledButtonProps(createWithAdminDisabled, createWithAdminReason)}
          onClick={onCreateOrganizationWithAdmin}
        >
          {busy === 'create-organization-with-admin' ? (
            <LoaderCircle size={14} className="spin" />
          ) : (
            <Crown size={14} />
          )}
          创建企业组织+首个管理员
        </button>
      </div>
      <table className="data-table wide">
        <thead>
          <tr>
            <th>组织</th>
            <th>类型</th>
            <th>状态</th>
            <th>成员</th>
            <th>组织管理员</th>
            <th>创建者</th>
            <th>更新时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {visibleOrganizations.map((organization) => {
            const organizationType = classifyOrganization(organization)
            const invitationRoles = organizationInvitationRoleOptions(session, organization)
            const canManageTarget = canManageOrganization(session, organization)
            const canReadBillingPool = canReadOrganizationBilling(session, organization)
            const canRenameTarget = canManageTarget
            const canCreateTarget =
              organization.status === 'active' && canCreateOrganizationUser(session, organization)
            const canAddExistingTarget = canAddExistingOrganizationMember(session, organization)
            const canTransferTarget =
              canTransferOrganizationAdmin(session, organization) &&
              organization.activeOrganizationAdminCount >= 1
            const canDisableTarget =
              organization.status === 'active' && canDisableOrganization(session, organization)
            const canInviteOrganizationMember =
              organization.status === 'active' && invitationRoles.includes('organization_member')
            const canInviteOrganizationAdmin =
              organization.status === 'active' && invitationRoles.includes('organization_admin')
            const inactiveReason = organization.status !== 'active' ? '企业组织已禁用，不能执行该操作' : ''
            return (
              <tr key={organization.id}>
                <td>
                  <IdentityCell name={organization.name} detail={organization.id} />
                </td>
                <td>
                  <OrganizationTypeBadge organizationType={organizationType} />
                </td>
                <td>
                  <StatusBadge status={organization.status} />
                </td>
                <td>
                  {organization.activeMembershipCount} / {organization.membershipCount}
                </td>
                <td>{organization.activeOrganizationAdminCount}</td>
                <td>{organization.createdByEmail ?? organization.createdByName ?? '-'}</td>
                <td>{formatDate(organization.updatedAt)}</td>
                <td>
                  <div className="row-actions">
                    <button
                      className="row-button"
                      type="button"
                      {...tooltipProps('查看企业组织详情、成员、账单和审计记录')}
                      onClick={() => onOpenDetail(organization)}
                    >
                      <FileText size={14} />
                      详情
                    </button>
                    <button
                      className="row-button"
                      type="button"
                      {...disabledButtonProps(
                        !canReadBillingPool,
                        organizationType.type !== 'enterprise'
                          ? '只有企业组织有共享积分池'
                          : '当前身份不能查看该组织共享积分池',
                        '查看或调整该企业组织的共享积分池',
                      )}
                      onClick={() => onOpenOrganizationBilling(organization)}
                    >
                      <CreditCard size={14} />
                      组织共享池
                    </button>
                    <button
                      className="row-button"
                      type="button"
                      {...disabledButtonProps(
                        !canCreateTarget,
                        inactiveReason || '当前身份不能在该组织内直接创建账号',
                        '在该企业组织内直接创建一个新账号',
                      )}
                      onClick={() => onCreateUser(organization.id)}
                    >
                      <Plus size={14} />
                      直接创建组织账号
                    </button>
                    <RowMoreMenu title="打开更多组织操作">
                      <button
                        className="row-button"
                        type="button"
                        {...disabledButtonProps(
                          !canAddExistingTarget || busy === 'add-existing-member',
                          inactiveReason ||
                            (!canAddExistingTarget ? '当前身份不能把已有账号加入该组织' : '正在加入已有账号'),
                          '把一个已有账号加入该企业组织',
                        )}
                        onClick={() => onAddExistingMember(organization.id)}
                      >
                        {busy === 'add-existing-member' ? (
                          <LoaderCircle size={14} className="spin" />
                        ) : (
                          <UserPlus size={14} />
                        )}
                        加入已有账号
                      </button>
                      <button
                        className="row-button"
                        type="button"
                        {...disabledButtonProps(
                          !canInviteOrganizationMember || busy === 'create-invitation',
                          inactiveReason ||
                            (!canInviteOrganizationMember ? '当前身份不能邀请组织成员' : '正在创建邀请'),
                          '创建组织成员邀请链接',
                        )}
                        onClick={() => onCreateInvitation(organization.id, 'organization_member')}
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
                          !canInviteOrganizationAdmin || busy === 'create-invitation',
                          inactiveReason ||
                            (!canInviteOrganizationAdmin ? '当前身份不能邀请组织管理员' : '正在创建邀请'),
                          '创建组织管理员邀请链接',
                        )}
                        onClick={() => onCreateInvitation(organization.id, 'organization_admin')}
                      >
                        {busy === 'create-invitation' ? (
                          <LoaderCircle size={14} className="spin" />
                        ) : (
                          <Crown size={14} />
                        )}
                        邀请组织管理员
                      </button>
                      <button
                        className="row-button"
                        type="button"
                        {...disabledButtonProps(
                          !canRenameTarget || busy === `organization-rename:${organization.id}`,
                          !canRenameTarget ? '当前身份不能重命名该组织' : '正在重命名组织',
                          '重命名该企业组织',
                        )}
                        onClick={() => onRename(organization)}
                      >
                        {busy === `organization-rename:${organization.id}` ? (
                          <LoaderCircle size={14} className="spin" />
                        ) : (
                          <PencilLine size={14} />
                        )}
                        改名
                      </button>
                      <button
                        className="row-button"
                        type="button"
                        {...disabledButtonProps(
                          !canManageTarget,
                          '当前身份不能管理该组织邀请',
                          '查看、刷新或撤销该组织邀请',
                        )}
                        onClick={() => onManageInvitations(organization)}
                      >
                        <MailPlus size={14} />
                        邀请管理
                      </button>
                      <button
                        className="row-button"
                        type="button"
                        {...disabledButtonProps(
                          !canTransferTarget || busy === `organization-admin-change:${organization.id}`,
                          !canTransferOrganizationAdmin(session, organization)
                            ? '只有平台管理员可以更换组织负责人'
                            : organization.activeOrganizationAdminCount < 1
                              ? '该组织没有可更换的组织管理员'
                              : '正在更换组织负责人',
                          '把组织负责人转给另一个组织成员',
                        )}
                        onClick={() => onTransferOrganizationAdmin(organization)}
                      >
                        {busy === `organization-admin-change:${organization.id}` ? (
                          <LoaderCircle size={14} className="spin" />
                        ) : (
                          <ShieldCheck size={14} />
                        )}
                        更换组织负责人
                      </button>
                      <button
                        className="row-button danger"
                        type="button"
                        {...disabledButtonProps(
                          !canDisableTarget || busy === `organization-disable:${organization.id}`,
                          inactiveReason ||
                            (!canDisableOrganization(session, organization)
                              ? '只有 owner 可以禁用企业组织'
                              : '正在禁用组织'),
                          '禁用该企业组织，阻止继续使用',
                        )}
                        onClick={() => onDisable(organization)}
                      >
                        {busy === `organization-disable:${organization.id}` ? (
                          <LoaderCircle size={14} className="spin" />
                        ) : (
                          <Power size={14} />
                        )}
                        禁用
                      </button>
                    </RowMoreMenu>
                  </div>
                </td>
              </tr>
            )
          })}
          <EmptyRow visible={!visibleOrganizations.length} columns={8} />
        </tbody>
      </table>
    </DataSection>
  )
}
