import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { authErrorMessage, registrationEntryFromSearch } from './LoginPage'
import { RequiredPasswordChangePage } from './RequiredPasswordChangePage'

describe('login guidance', () => {
  it('opens invitation links in registration mode with the token prefilled', () => {
    const token = 'invite-token-'.padEnd(32, '1')

    expect(registrationEntryFromSearch(`?token=${encodeURIComponent(token)}`)).toEqual({
      mode: 'register',
      token,
    })
    expect(registrationEntryFromSearch('?source=email')).toEqual({ mode: 'login', token: '' })
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
    expect(
      authErrorMessage(
        { code: 'INVITATION_ACCOUNT_PASSWORD_INVALID' },
        { isRegistering: true },
      ),
    ).toBe('该邮箱已有账号。这里需要输入原登录密码；如果忘记密码，请先重置密码。')
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
})
