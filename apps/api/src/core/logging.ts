export type LogFields = Record<string, unknown>

export function logInfo(event: string, fields: LogFields = {}): void {
  writeLog('info', event, fields)
}

export function logWarn(event: string, fields: LogFields = {}): void {
  writeLog('warn', event, fields)
}

export function logError(event: string, fields: LogFields = {}): void {
  writeLog('error', event, fields)
}

function writeLog(level: 'info' | 'warn' | 'error', event: string, fields: LogFields): void {
  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    event,
    ...fields,
  })
  const stream = level === 'error' ? process.stderr : process.stdout
  stream.write(`${line}\n`)
}
