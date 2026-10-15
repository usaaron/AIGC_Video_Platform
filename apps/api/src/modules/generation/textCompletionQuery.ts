import { textCompletionSnapshotSchema, type Principal } from '@seqora/contracts'
import { AppError } from '../../core/errors.js'
import type { GenerationTaskRepository } from './repository.js'
import { textCompletionEvidence } from './textCompletionEvidence.js'

/** Read the authorized task snapshot; never infer proof from the current editable project. */
export async function readTextCompletionQuery(
  repository: Pick<GenerationTaskRepository, 'findById'>,
  taskId: string,
  principal: Principal,
) {
  const task = await repository.findById(taskId, principal)
  if (!task || task.projectId.startsWith('sm-standalone-'))
    throw new AppError(404, 'TASK_NOT_FOUND', '生成任务不存在或无权读取来源回执')
  if (task.kind !== 'text' || task.provider !== 'text')
    throw new AppError(409, 'TEXT_COMPLETION_UNSUPPORTED', '该任务不支持文本结果来源回执查询')

  const evidence = textCompletionEvidence(task)
  return textCompletionSnapshotSchema.parse({
    version: 'seqora.text-completion-query.v1',
    taskId: task.id,
    projectId: task.projectId,
    tenantId: task.tenantId,
    taskUpdatedAt: task.updatedAt,
    checkedAt: new Date().toISOString(),
    taskStatus: task.status,
    ...evidence,
  })
}
