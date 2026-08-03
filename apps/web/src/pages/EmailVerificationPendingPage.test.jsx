import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { EmailVerificationPendingPage } from './EmailVerificationPendingPage'

describe('email verification pending page', () => {
  it('shows the registered email and recovery actions', () => {
    const markup = renderToStaticMarkup(
      <EmailVerificationPendingPage
        account={{ email: 'creator@example.com' }}
        onRefresh={async () => ({ account: { emailVerified: false } })}
        onLogout={async () => {}}
      />,
    )

    expect(markup).toContain('creator@example.com')
    expect(markup).toContain('我已完成验证')
    expect(markup).toContain('重新发送验证邮件')
    expect(markup).toContain('退出登录')
  })
})
