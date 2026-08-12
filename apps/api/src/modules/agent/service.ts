import {
  type AgentRun,
  type AgentStageKey,
  type CreateAgentPlanRequest,
  type Principal,
} from '@seqora/contracts'
import type { TaskDispatcher } from '../../core/jobs/taskDispatcher.js'
import { AppError } from '../../core/errors.js'
import type { CreditLedger } from '../billing/creditLedger.js'
import type { AgentRunRepository } from './repository.js'
import { createAgentPlan } from './planner.js'

export class AgentService {
  constructor(
    private readonly repository: AgentRunRepository,
    private readonly dispatcher: TaskDispatcher,
    private readonly creditLedger: CreditLedger,
  ) {}

  async plan(input: CreateAgentPlanRequest, principal: Principal): Promise<AgentRun> {
    const previous = input.runId ? await this.requireRun(input.runId, principal) : null
    if (previous && previous.status !== 'draft') {
      throw new AppError(409, 'AGENT_RUN_ALREADY_CONFIRMED', '该 Agent 任务已经开始，不能再修改方案')
    }
    const isParameterUpdate = Boolean(previous && input.prompt === '确认制作参数')
    const originalPrompt = previous
      ? isParameterUpdate
        ? previous.originalPrompt
        : `${previous.originalPrompt}\n${input.prompt}`.slice(0, 20_000)
      : input.prompt
    const plan = createAgentPlan(input.prompt, previous?.plan ?? null, input.overrides)
    return this.repository.savePlan({
      ...(input.runId ? { runId: input.runId } : {}),
      originalPrompt,
      plan,
      principal,
    })
  }

  list(principal: Principal): Promise<AgentRun[]> {
    return this.repository.list(principal)
  }

  async get(runId: string, principal: Principal): Promise<AgentRun> {
    return this.requireRun(runId, principal)
  }

  async confirm(runId: string, clientRequestId: string, principal: Principal): Promise<AgentRun> {
    const draft = await this.requireRun(runId, principal)
    if (!draft.projectId) {
      const estimatedCredits = draft.plan.estimate?.totalCredits
      if (!estimatedCredits) {
        throw new AppError(409, 'AGENT_PLAN_INCOMPLETE', '请先补齐制作信息，再确认开始')
      }
      const billing = await this.creditLedger.summary(principal)
      if (billing.credits < estimatedCredits) {
        throw new AppError(
          402,
          'INSUFFICIENT_CREDITS',
          `当前积分不足，预计需要 ${estimatedCredits} 积分，当前可用 ${billing.credits} 积分`,
        )
      }
    }
    const run = await this.repository.confirm(runId, clientRequestId, principal)
    await this.wake(run)
    return run
  }

  pause(runId: string, principal: Principal): Promise<AgentRun> {
    return this.repository.requestPause(runId, principal)
  }

  async resume(runId: string, principal: Principal): Promise<AgentRun> {
    const run = await this.repository.resume(runId, principal)
    await this.wake(run)
    return run
  }

  async retry(runId: string, principal: Principal): Promise<AgentRun> {
    const run = await this.repository.retry(runId, principal)
    await this.wake(run)
    return run
  }

  async skip(runId: string, stageKey: AgentStageKey, principal: Principal): Promise<AgentRun> {
    const run = await this.repository.skip(runId, stageKey, principal)
    await this.wake(run)
    return run
  }

  private async requireRun(runId: string, principal: Principal): Promise<AgentRun> {
    const run = await this.repository.find(runId, principal)
    if (!run) throw new AppError(404, 'AGENT_RUN_NOT_FOUND', 'Agent 任务不存在或无权访问')
    return run
  }

  private wake(run: AgentRun): Promise<void> {
    return this.dispatcher.dispatch({ id: run.id, tenantId: run.tenantId, updatedAt: run.updatedAt }, {})
  }
}
