import type { AiJob } from '@seqora/contracts'
import { randomUUID } from 'node:crypto'
import type { AiJobRepository } from '../../modules/aiJobs/repository.js'
import { observabilityMetrics } from '../observability/metrics.js'
import { noopTaskRunnerLock, type TaskRunnerLock } from './taskRunnerLock.js'
import type { TaskDispatchContext, TaskDispatcher } from './taskDispatcher.js'

export type AiJobExecutionResult = {
  output?: Record<string, unknown>
}

export interface AiJobHandler {
  canHandle(job: AiJob): boolean
  execute(job: AiJob): Promise<AiJobExecutionResult>
}

type AiJobRunnerOptions = {
  handler?: AiJobHandler | null
  leaseTtlMs?: number
  concurrency?: number
  beforeTick?: () => Promise<void>
  taskRunnerLock?: TaskRunnerLock | null
}

export class AiJobRunner implements TaskDispatcher {
  private timer: NodeJS.Timeout | null = null
  private tickPromise: Promise<void> | null = null
  private readonly handler: AiJobHandler | null
  private readonly leaseOwnerId: string
  private readonly leaseTtlMs: number
  private readonly concurrency: number
  private readonly beforeTick: (() => Promise<void>) | null
  private readonly taskRunnerLock: TaskRunnerLock
  private readonly activeExecutions = new Set<string>()

  constructor(
    private readonly repository: AiJobRepository,
    options: AiJobRunnerOptions = {},
  ) {
    this.handler = options.handler ?? null
    this.leaseOwnerId = `ai-job-runner-${process.pid}-${randomUUID()}`
    this.leaseTtlMs = options.leaseTtlMs ?? 120_000
    this.concurrency = options.concurrency ?? 3
    this.beforeTick = options.beforeTick ?? null
    this.taskRunnerLock = options.taskRunnerLock ?? noopTaskRunnerLock
  }

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.tick(), 900)
    void this.tick()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  async dispatch(_task?: unknown, context?: TaskDispatchContext): Promise<void> {
    void this.tick(context).catch(() => {})
  }

  async tick(context?: TaskDispatchContext): Promise<void> {
    if (this.tickPromise) return this.tickPromise

    const tickPromise = this.taskRunnerLock.runExclusive(() => this.runTick(context)).then(() => undefined)
    this.tickPromise = tickPromise

    try {
      await tickPromise
    } finally {
      if (this.tickPromise === tickPromise) this.tickPromise = null
    }
  }

  async recoverInterrupted(): Promise<void> {
    await this.tick()
  }

  private async runTick(_context?: TaskDispatchContext): Promise<void> {
    await this.beforeTick?.()
    await this.repository.refundTerminalJobs()
    const available = Math.max(0, this.concurrency - this.activeExecutions.size)
    if (available <= 0) return
    const jobs = await this.repository.claimReadyJobs({
      ownerId: this.leaseOwnerId,
      leaseTtlMs: this.leaseTtlMs,
      limit: available,
    })
    const now = Date.now()
    for (const job of jobs) {
      if (this.activeExecutions.has(job.id)) continue
      observabilityMetrics.recordAiJobQueueWait({
        kind: job.kind,
        tenantId: job.tenantId,
        jobId: job.id,
        waitMs: durationSince(job.createdAt, now),
      })
      this.activeExecutions.add(job.id)
      void this.runExecution(job).finally(() => {
        this.activeExecutions.delete(job.id)
      })
    }
  }

  private async runExecution(job: AiJob): Promise<void> {
    const leaseToken = typeof job.leaseToken === 'string' ? job.leaseToken : ''
    if (!leaseToken) return
    const startedAt = Date.now()
    const stopHeartbeat = this.startLeaseHeartbeat(job.id, leaseToken)
    try {
      if (!this.handler?.canHandle(job)) {
        throw new Error(`AI job handler is not configured for kind ${job.kind}`)
      }
      const result = await this.handler.execute(job)
      await this.repository.complete(job.id, this.leaseOwnerId, leaseToken, result.output ?? {})
      observabilityMetrics.recordAiJobExecution({
        kind: job.kind,
        tenantId: job.tenantId,
        jobId: job.id,
        durationMs: Date.now() - startedAt,
        ok: true,
      })
      observabilityMetrics.recordAiJobTerminal({
        kind: job.kind,
        tenantId: job.tenantId,
        jobId: job.id,
        status: 'completed',
      })
    } catch (error) {
      await this.repository.fail(job.id, this.leaseOwnerId, leaseToken, messageFor(error))
      observabilityMetrics.recordAiJobExecution({
        kind: job.kind,
        tenantId: job.tenantId,
        jobId: job.id,
        durationMs: Date.now() - startedAt,
        ok: false,
        error,
      })
      observabilityMetrics.recordAiJobTerminal({
        kind: job.kind,
        tenantId: job.tenantId,
        jobId: job.id,
        status: 'failed',
      })
    } finally {
      stopHeartbeat()
    }
  }

  private startLeaseHeartbeat(jobId: string, leaseToken: string): () => void {
    const intervalMs = Math.max(1_000, Math.floor(this.leaseTtlMs / 3))
    const heartbeat = () => {
      void this.repository.renewLease(jobId, this.leaseOwnerId, leaseToken, this.leaseTtlMs)
    }
    const timer = setInterval(heartbeat, intervalMs)
    timer.unref?.()
    return () => clearInterval(timer)
  }
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : 'AI job failed'
}

function durationSince(startIso: string, now = Date.now()): number {
  const startedAt = Date.parse(startIso)
  return Number.isFinite(startedAt) ? Math.max(0, now - startedAt) : 0
}
