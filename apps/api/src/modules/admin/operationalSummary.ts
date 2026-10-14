import type { DailyOperationalSummary } from '../../core/observability/metrics.js'

export type OperationalStatusCountRow = {
  created: number
  completed: number
  failed: number
  cancelled: number
}

export function operationalStatusCounts(
  row: OperationalStatusCountRow | undefined,
): DailyOperationalSummary['generationTasks'] {
  const created = row?.created ?? 0
  const completed = row?.completed ?? 0
  const failed = row?.failed ?? 0
  const cancelled = row?.cancelled ?? 0
  const terminal = completed + failed + cancelled
  return {
    created,
    completed,
    failed,
    cancelled,
    terminal,
    successRate: terminal > 0 ? completed / terminal : null,
  }
}

export function startOfChinaDay(now = new Date()): string {
  const chinaOffsetMs = 8 * 60 * 60 * 1_000
  const chinaNow = new Date(now.getTime() + chinaOffsetMs)
  return new Date(
    Date.UTC(chinaNow.getUTCFullYear(), chinaNow.getUTCMonth(), chinaNow.getUTCDate()) - chinaOffsetMs,
  ).toISOString()
}
