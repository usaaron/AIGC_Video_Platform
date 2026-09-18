import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AppHeader, AppSidebar } from './AppShell'

const sidebarProps = {
  activeStep: 'settings',
  mobileNav: false,
  billing: { plan: 'free', credits: 0 },
  assetCount: 0,
  creativeEnabled: true,
  onNavigate: () => {},
  onClose: () => {},
}

describe('app shell account entry', () => {
  it('keeps organization accounts out of personal purchase navigation', () => {
    const billing = { plan: 'free', credits: 320, billingScope: 'organization' }
    const sidebar = renderToStaticMarkup(<AppSidebar {...sidebarProps} billing={billing} />)
    const header = renderToStaticMarkup(<AppHeader billing={billing} runningJobs={[]} />)
    expect(sidebar).toContain('组织共享积分')
    expect(sidebar).not.toContain('会员中心')
    expect(sidebar).not.toContain('积分充值')
    expect(header).toContain('组织账户')
    expect(header).toContain('组织共享积分账单')
    expect(header).not.toContain('免费版')
  })

  it('places the function stack between the project library and creative flow', () => {
    const html = renderToStaticMarkup(
      <AppSidebar {...sidebarProps} canOpenAdminAccounts={false} adminConsoleUrl="http://localhost:5174/" />,
    )

    const projectLibrary = html.indexOf('项目库')
    const functionStack = html.indexOf('aria-label="功能栈"')
    const creativeFlow = html.indexOf('aria-label="创作流程"')

    expect(projectLibrary).toBeGreaterThanOrEqual(0)
    expect(functionStack).toBeGreaterThan(projectLibrary)
    expect(creativeFlow).toBeGreaterThan(functionStack)
    expect(html).toContain('一句成片')
    expect(html).toContain('生图大师')
    expect(html).not.toContain('剧本大师')
    expect(html.match(/已启用/g)).toHaveLength(1)
    expect(html).toContain('筹备中')
    expect(html).not.toContain('独立模块')
  })

  it('hides the admin console link from ordinary members', () => {
    const html = renderToStaticMarkup(
      <AppSidebar {...sidebarProps} canOpenAdminAccounts={false} adminConsoleUrl="http://localhost:5174/" />,
    )

    expect(html).not.toContain('管理后台')
    expect(html).not.toContain('http://localhost:5174/')
  })

  it('shows the admin console link for elevated account managers', () => {
    const html = renderToStaticMarkup(
      <AppSidebar {...sidebarProps} canOpenAdminAccounts adminConsoleUrl="http://localhost:5174/" />,
    )

    expect(html).toContain('管理后台')
    expect(html).toContain('href="http://localhost:5174/"')
  })
})
