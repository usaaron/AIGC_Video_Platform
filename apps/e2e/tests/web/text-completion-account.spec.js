import { expect, test } from '@playwright/test'
import { openTextCompletion } from './text-completion.fixture.js'

// Replace only the browser test entry. App, AuthProvider, GenerationPage, and
// the API client remain production modules so reconciliation crosses the real
// account boundary without navigation or a forced App remount.
function accountRefreshEntry(reactModule, reactDomModule) {
  return [
    'import React from ' + JSON.stringify(reactModule),
    'import ReactDOM from ' + JSON.stringify(reactDomModule),
    "import { AuthProvider, useAuth } from '/src/components/AuthProvider.jsx'",
    "import App from '/src/App.jsx'",
    "import '/src/index.css'",
    "import '/src/styles/studio.css'",
    'function AccountRefreshHarness() {',
    '  const { session, loading, refresh } = useAuth()',
    '  if (loading || !session) return React.createElement("p", null, "Loading test session")',
    '  return React.createElement(React.Fragment, null,',
    '    React.createElement("button", { type: "button", "data-testid": "refresh-test-account", onClick: () => void refresh() }, "刷新测试账号"),',
    '    React.createElement("output", { "data-testid": "current-test-account" }, session.account.id),',
    '    React.createElement(App))',
    '}',
    'ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(AuthProvider, null, React.createElement(AccountRefreshHarness)))',
  ].join('\n')
}

for (const width of [1440, 390]) {
  test.describe('文本来源账号隔离 ' + width, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 })
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.route('**/src/main.jsx', async (route) => {
        const productionEntry = await (await route.fetch()).text()
        const reactModule = productionEntry.match(/from\s+["']([^"']*\/react\.js[^"']*)["']/)?.[1]
        const reactDomModule = productionEntry.match(
          /from\s+["']([^"']*\/react-dom_client\.js[^"']*)["']/,
        )?.[1]
        if (!reactModule || !reactDomModule) throw new Error('Production React entry modules were not found')
        await route.fulfill({
          status: 200,
          contentType: 'application/javascript',
          body: accountRefreshEntry(reactModule, reactDomModule),
        })
      })
    })

    for (const phase of ['pending', 'ready']) {
      test(phase + ' 来源查询在同组织同项目切换账号后失效', async ({ page }, testInfo) => {
        const result = await openTextCompletion(page, testInfo, { hold: phase === 'pending' })
        const originalShell = await page.locator('.app-shell').elementHandle()
        const initialProjectId = result.task.projectId
        const initialTenantId = result.state.session.account.tenantId
        const initialUpdatedAt = result.task.updatedAt
        await expect(page.getByTestId('current-test-account')).toHaveText('user-1')
        if (phase === 'pending') await expect.poll(result.pendingCount).toBe(1)
        else {
          await expect(result.dialog.getByTestId('text-completion-receipt')).toHaveAttribute(
            'data-reason',
            'verified',
          )
          await expect(result.dialog.getByTestId('text-completion-details')).toBeVisible()
        }

        result.state.session = {
          ...result.state.session,
          account: { ...result.state.session.account, id: 'user-2', name: '同组织另一个账号' },
        }
        // This test-only control invokes the real AuthProvider.refresh while
        // the same App and project stay mounted behind the source dialog.
        await page.getByTestId('refresh-test-account').evaluate((button) => button.click())
        await expect(page.getByTestId('current-test-account')).toHaveText('user-2')
        await expect(result.dialog).toHaveCount(0)
        expect(await originalShell.evaluate((node) => node === document.querySelector('.app-shell'))).toBe(
          true,
        )
        await expect(page.locator('.app-shell')).toHaveAttribute('data-workspace', 'generate')
        expect(result.state.session.account.tenantId).toBe(initialTenantId)
        expect(result.task.projectId).toBe(initialProjectId)
        expect(result.task.updatedAt).toBe(initialUpdatedAt)
        expect(result.queries).toHaveLength(1)

        if (phase === 'pending') {
          result.release()
          await expect.poll(() => result.replies.includes(1)).toBe(true)
          await expect(result.dialog).toHaveCount(0)
        }

        // A fresh read under the new account is allowed. The old account's
        // displayed receipt and in-flight query are never reused.
        result.controls.reason = 'missing-receipt'
        await result.trigger.click()
        await expect(result.dialog.getByTestId('text-completion-receipt')).toHaveAttribute(
          'data-reason',
          'missing-receipt',
        )
        await expect(result.dialog.getByTestId('text-completion-details')).toHaveCount(0)
        expect(result.queries).toHaveLength(2)
        expect(result.writes).toEqual([])
        expect(result.downloads).toEqual([])
        expect(result.externalRequests).toEqual([])
      })
    }
  })
}
