type MemoryLogEntry = {
  level: string
  args: unknown[]
}
export class MemoryLogger {
  public readonly entries: MemoryLogEntry[] = []
  public level = 'info'
  public silent = false

  child(): MemoryLogger {
    return this
  }

  trace(...args: unknown[]): void {
    this.entries.push({ level: 'trace', args })
  }

  debug(...args: unknown[]): void {
    this.entries.push({ level: 'debug', args })
  }

  info(...args: unknown[]): void {
    this.entries.push({ level: 'info', args })
  }

  warn(...args: unknown[]): void {
    this.entries.push({ level: 'warn', args })
  }

  error(...args: unknown[]): void {
    this.entries.push({ level: 'error', args })
  }

  fatal(...args: unknown[]): void {
    this.entries.push({ level: 'fatal', args })
  }
}
