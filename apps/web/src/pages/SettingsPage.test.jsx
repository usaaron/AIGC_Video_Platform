import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SettingsPage } from './SettingsPage'

const baseAccount = {
  id: 'user-1',
  name: '林夏',
  email: 'linxia@example.com',
  tenantId: 'organization-personal',
  organizationId: 'organization-personal',
  roles: ['member'],
  plan: 'free',
  credits: 2000,
  emailVerified: true,
}

const billing = {
  plan: 'free',
  credits: 1988,
  concurrency: 1,
  unlimitedConcurrency: false,
  monthlyUsage: {
    consumedCredits: 12,
    refundedCredits: 0,
    netCredits: 12,
    generationCount: 3,
  },
}

const noop = () => {}

describe('account center', () => {
  it('presents an individual creator as current account data with billing', () => {
    const html = renderToStaticMarkup(
      <SettingsPage
        account={baseAccount}
        billing={billing}
        organizations={[]}
        sessions={[]}
        onLoadAccountScope={noop}
        onChangePassword={noop}
        onLogout={noop}
      />,
    )

    expect(html).toContain('账号中心')
    expect(html).toContain('积分与用量')
    expect(html).toContain('当前账号数据')
    expect(html).not.toContain('组织：个人')
    expect(html).not.toContain('个人空间')
    expect(html).not.toContain('个人创作空间')
    expect(html).not.toContain('切换组织/空间')
    expect(html).not.toContain('邀请组织成员')
  })

  it('only exposes organization invitations for an organization administrator', () => {
    const html = renderToStaticMarkup(
      <SettingsPage
        account={{ ...baseAccount, roles: ['organization_admin'] }}
        billing={billing}
        organizations={[
          {
            organization: { id: 'organization-personal', name: '星门影业' },
            membership: { roles: ['organization_admin'] },
          },
        ]}
        sessions={[]}
        onLoadAccountScope={noop}
        onInviteOrganizationMember={noop}
        onChangePassword={noop}
        onLogout={noop}
      />,
    )

    expect(html).toContain('组织空间')
    expect(html).toContain('星门影业')
    expect(html).toContain('邀请组织成员')
    expect(html).toContain('发送邀请')
  })

  it('shows the organization switcher only when the account has multiple scopes including a team', () => {
    const html = renderToStaticMarkup(
      <SettingsPage
        account={baseAccount}
        billing={billing}
        organizations={[
          {
            organization: { id: 'organization-personal', name: '林夏 的个人空间' },
            membership: { roles: ['member'], organizationType: 'personal' },
          },
          {
            organization: { id: 'organization-team', name: '星门影业' },
            membership: { roles: ['organization_member'], organizationType: 'enterprise' },
          },
        ]}
        sessions={[]}
        onLoadAccountScope={noop}
        onChangePassword={noop}
        onLogout={noop}
      />,
    )

    expect(html).toContain('切换组织/空间')
    expect(html).toContain('当前账号数据')
    expect(html).toContain('星门影业')
    expect(html).toContain('组织空间')
    expect(html).not.toContain('林夏 的个人空间')
  })
})
