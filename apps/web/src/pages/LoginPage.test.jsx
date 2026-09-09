import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AuthProvider } from '../components/AuthProvider'
import { AuthLayout } from '../components/AuthLayout'
import { EmailVerificationPage } from './EmailVerificationPage'
import { authErrorMessage, LoginPage, registrationEntryFromSearch } from './LoginPage'
import { RequiredPasswordChangePage } from './RequiredPasswordChangePage'

describe('login guidance', () => {
  it('renders the 序幕TV brand, account controls and theme switch', () => {
    const html = renderToStaticMarkup(
      <AuthProvider>
        <LoginPage />
      </AuthProvider>,
    )

    expect(html).toContain('序幕TV')
    expect(html).toContain('欢迎回来')
    expect(html).toContain('进入工作台')
    expect(html).toContain('切换浅色模式')
    expect(html).toContain('<h1 class="auth-title">序幕TV</h1>')
    expect(html).toContain('src="/studio/alpine.jpg"')
    expect(html).toContain('src="/studio/forest.jpg"')
    expect(html).toContain('aria-label="暂停背景动画"')
    expect(html).toContain('autoComplete="current-password"')
    expect(html).toContain('type="email"')
  })

  it('keeps account recovery pages free of automatic background motion', () => {
    const html = renderToStaticMarkup(
      <AuthLayout>
        <h2>账号安全</h2>
      </AuthLayout>,
    )

    expect(html).toContain('序幕TV')
    expect(html).toContain('切换浅色模式')
    expect(html).not.toContain('auth-cinematic-background')
    expect(html).not.toContain('暂停背景动画')
  })

  it('opens invitation links in registration mode with the token prefilled', () => {
    const token = 'invite-token-'.padEnd(32, '1')

    expect(registrationEntryFromSearch(`?token=${encodeURIComponent(token)}`)).toEqual({
      mode: 'register',
      token,
    })
    expect(registrationEntryFromSearch('?source=email')).toEqual({ mode: 'login', token: '' })
    expect(registrationEntryFromSearch('', '/register')).toEqual({ mode: 'register', token: '' })
  })

  it('shows a specific message for invalid credentials', () => {
    expect(authErrorMessage({ code: 'INVALID_CREDENTIALS' })).toBe('邮箱或密码错误')
  })

  it('explains registration-code failures', () => {
    expect(authErrorMessage({ code: 'REGISTRATION_CODE_INVALID' }, { isRegistering: true })).toBe(
      '验证码错误，请检查后重试',
    )
    expect(authErrorMessage({ code: 'REGISTRATION_CODE_EXPIRED' }, { isRegistering: true })).toBe(
      '验证码已过期，请重新发送',
    )
  })

  it('explains that an invited existing account needs its original password', () => {
    expect(authErrorMessage({ code: 'INVITATION_ACCOUNT_PASSWORD_INVALID' }, { isRegistering: true })).toBe(
      '该邮箱已有账号。这里需要输入原登录密码；如果忘记密码，请先重置密码。',
    )
  })

  it('explains when the API cannot be reached', () => {
    expect(authErrorMessage(new TypeError('Failed to fetch'))).toBe(
      '无法连接登录服务，请确认 API 已启动后重试',
    )
  })

  it('renders the mandatory first-login password change', () => {
    const html = renderToStaticMarkup(
      <RequiredPasswordChangePage
        account={{ email: 'member5@seqora.local' }}
        onChangePassword={() => {}}
        onLogout={() => {}}
      />,
    )

    expect(html).toContain('修改临时密码')
    expect(html).toContain('member5@seqora.local')
    expect(html).toContain('必须完成此步骤')
  })

  it('keeps email verification in the shared branded shell with a neutral loading state', () => {
    const html = renderToStaticMarkup(<EmailVerificationPage />)

    expect(html).toContain('序幕TV')
    expect(html).toContain('切换浅色模式')
    expect(html).toContain('auth-result-icon checking')
    expect(html).not.toContain('auth-result-icon error')
  })
})
