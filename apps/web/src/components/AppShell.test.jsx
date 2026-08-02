import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AppSidebar } from './AppShell'

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
