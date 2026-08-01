import type { AppConfig } from '../../config.js'

export type EmailMessage = {
  to: string
  subject: string
  text: string
  html?: string
}

export interface Mailer {
  send(message: EmailMessage): Promise<void>
}

export class NoopMailer implements Mailer {
  async send(_message: EmailMessage): Promise<void> {}
}

export class ConsoleMailer implements Mailer {
  async send(message: EmailMessage): Promise<void> {
    process.stdout.write(`[email:console] ${JSON.stringify(message)}\n`)
  }
}

export class ResendMailer implements Mailer {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly replyTo: string | null = null,
  ) {}

  async send(message: EmailMessage): Promise<void> {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: this.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
        ...(this.replyTo ? { reply_to: this.replyTo } : {}),
      }),
    })
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`Resend email delivery failed (${response.status}): ${body.slice(0, 300)}`)
    }
  }
}

export function createMailer(config: AppConfig): Mailer {
  if (config.EMAIL_PROVIDER === 'none') return new NoopMailer()
  if (config.EMAIL_PROVIDER === 'console') return new ConsoleMailer()
  return new ResendMailer(config.RESEND_API_KEY, config.EMAIL_FROM, config.EMAIL_REPLY_TO || null)
}

export function tokenUrl(baseUrl: string, token: string): string {
  if (baseUrl.includes('{token}')) return baseUrl.replaceAll('{token}', encodeURIComponent(token))
  const separator = baseUrl.includes('?') ? '&' : '?'
  return `${baseUrl}${separator}token=${encodeURIComponent(token)}`
}

