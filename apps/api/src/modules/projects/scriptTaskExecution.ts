import type { Principal } from '@seqora/contracts'
import type { TextTaskWriteGuard } from '../../core/jobs/textTaskExecutionGuard.js'
import type { ProjectRepository } from './repository.js'

export type ScriptTaskExecution = {
  assertActive?: (() => Promise<void>) | undefined
  taskWriteGuard?: TextTaskWriteGuard | undefined
}
export type ScriptBatchExecution = {
  createNext: boolean
  title: string
  batchGenerationKey: string
  continuity: string
  beforeWrite?: (() => Promise<void>) | undefined
  billingRequestId?: string | undefined
}

export function scriptWriteCheck(execution?: ScriptTaskExecution, batch?: ScriptBatchExecution) {
  return async () => {
    await execution?.assertActive?.()
    if (batch?.beforeWrite !== execution?.assertActive) await batch?.beforeWrite?.()
  }
}

export function scriptWriteOptions(execution?: ScriptTaskExecution) {
  return execution?.taskWriteGuard ? { taskWriteGuard: execution.taskWriteGuard } : {}
}

export function writeTaskProjectScript(
  repository: ProjectRepository,
  projectId: string,
  script: string,
  principal: Principal,
  execution?: ScriptTaskExecution,
) {
  const guard: [] | [TextTaskWriteGuard] = execution?.taskWriteGuard ? [execution.taskWriteGuard] : []
  return repository.update(projectId, { script }, principal, ...guard)
}
