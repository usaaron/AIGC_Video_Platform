import type { AppConfig } from '../../config.js'

export type EmailMessage = {
  to: string
  subject: string
  text: string
  html?: string
  purpose?:
    | 'registration_code'
    | 'email_verification'
    | 'password_reset'
    | 'invitation'
    | 'billing_reconciliation_alert'
  idempotencyKey?: string
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
    private readonly timeoutMs = 15_000,
    private readonly maxRetries = 2,
    private readonly retryBaseDelayMs = 250,
  ) {}

  async send(message: EmailMessage): Promise<void> {
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          signal: AbortSignal.timeout(this.timeoutMs),
          headers: {
            authorization: `Bearer ${this.apiKey}`,
            'content-type': 'application/json',
            ...(message.idempotencyKey ? { 'Idempotency-Key': message.idempotencyKey } : {}),
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
        if (response.ok) return
        const body = await response.text().catch(() => '')
        if (!isRetryableEmailStatus(response.status) || attempt >= this.maxRetries) {
          throw new Error(`Resend email delivery failed (${response.status}): ${body.slice(0, 300)}`)
        }
      } catch (error) {
        if (attempt >= this.maxRetries || !isRetryableEmailError(error)) throw error
      }
      await delay(this.retryBaseDelayMs * 2 ** attempt)
    }
  }
}

export function createMailer(config: AppConfig): Mailer {
  if (config.EMAIL_PROVIDER === 'none') return new NoopMailer()
  if (config.EMAIL_PROVIDER === 'console') return new ConsoleMailer()
  return new ResendMailer(
    config.RESEND_API_KEY,
    config.EMAIL_FROM,
    config.EMAIL_REPLY_TO || null,
    config.EMAIL_REQUEST_TIMEOUT_MS,
    config.EMAIL_MAX_RETRIES,
    config.EMAIL_RETRY_BASE_DELAY_MS,
  )
}

export function tokenUrl(baseUrl: string, token: string): string {
  if (baseUrl.includes('{token}')) return baseUrl.replaceAll('{token}', encodeURIComponent(token))
  const separator = baseUrl.includes('?') ? '&' : '?'
  return `${baseUrl}${separator}token=${encodeURIComponent(token)}`
}

function isRetryableEmailStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500
}

function isRetryableEmailError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'AbortError' || error.name === 'TimeoutError' || error.name === 'TypeError')
  )
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds))
}
