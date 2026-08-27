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
    expect(html).toContain('剧本大师')
    expect(html.match(/已启用/g)).toHaveLength(2)
    expect(html.match(/开发中/g)).toHaveLength(1)
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
