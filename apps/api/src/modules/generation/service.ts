import type { CreateGenerationTask, GenerationTask, GenerationTaskLog, Principal } from '@seqora/contracts'
import { AppError } from '../../core/errors.js'
import type { VideoGenerationProvider } from '../../core/generation/videoProvider.js'
import type { TaskDispatcher } from '../../core/jobs/taskDispatcher.js'
import type { GenerationTaskStore, TaskMutationResult } from './repository.js'

const RETRYABLE_STATUSES = new Set<GenerationTask['status']>(['failed', 'cancelled', 'queued', 'running'])
type TaskMutationAction = 'cancel' | 'delete' | 'pause' | 'resume' | 'retry'

export class GenerationService {
  constructor(
    private readonly repository: GenerationTaskStore,
    private readonly dispatcher: TaskDispatcher,
    private readonly videoProvider: VideoGenerationProvider | null = null,
  ) {}

  async createTask(input: CreateGenerationTask, principal: Principal): Promise<GenerationTask> {
    const result = await this.repository.createWithCredit(input, principal)
    if ('error' in result) {
      if (result.error === 'project-not-found') {
        throw new AppError(404, 'PROJECT_NOT_FOUND', '项目不存在或无权生成')
      }
      if (result.error === 'account-not-found') {
        throw new AppError(401, 'ACCOUNT_NOT_FOUND', '账号不存在')
      }
      throw new AppError(402, 'INSUFFICIENT_CREDITS', '积分不足')
    }

    await this.dispatcher.dispatch(result.task)
    return result.task
  }

  listProjectTasks(projectId: string, principal: Principal): Promise<GenerationTask[]> {
    return this.repository.listByProject(projectId, principal)
  }

  async listTaskLogs(taskId: string, principal: Principal): Promise<GenerationTaskLog[]> {
    const logs = await this.repository.listLogs(taskId, principal)
    if (!logs) throw new AppError(404, 'TASK_NOT_FOUND', 'Generation task was not found')
    return logs
  }

  async retryTask(taskId: string, principal: Principal): Promise<GenerationTask> {
    const task = await this.repository.findById(taskId, principal)
    if (!task) throw new AppError(404, 'TASK_NOT_FOUND', '生成任务不存在或无权访问')
    if (!RETRYABLE_STATUSES.has(task.status)) {
      throw new AppError(409, 'TASK_NOT_RETRYABLE', '当前任务状态不能重试')
    }

    const result = await this.repository.retry(taskId, principal)
    return this.sendMutationResult(result, 'retry')
  }

  async pauseTask(taskId: string, principal: Principal): Promise<GenerationTask> {
    const result = await this.repository.pause(taskId, principal)
    return this.returnMutationResult(result, 'pause')
  }

  async resumeTask(taskId: string, principal: Principal): Promise<GenerationTask> {
    const result = await this.repository.resume(taskId, principal)
    return this.sendMutationResult(result, 'resume')
  }

  async cancelTask(taskId: string, principal: Principal): Promise<GenerationTask> {
    const result = await this.repository.cancel(taskId, principal)
    return this.sendMutationResult(result, 'cancel')
  }

  async deleteTask(
    taskId: string,
    principal: Principal,
  ): Promise<{ deleted: true } | { task: GenerationTask }> {
    const result = await this.repository.delete(taskId, principal)
    if ('error' in result) throw taskMutationError(result.error, 'delete')
    if ('deleted' in result) return result
    await this.dispatcher.dispatch(result.task)
    return { task: result.task }
  }

  clearCompleted(projectId: string, principal: Principal): Promise<number> {
    return this.repository.clearCompleted(projectId, principal)
  }

  async getVideoContent(taskId: string, principal: Principal) {
    const task = await this.repository.findById(taskId, principal)
    if (!task) throw new AppError(404, 'TASK_NOT_FOUND', '生成任务不存在或无权访问')
    if (task.kind !== 'video' || task.provider !== 'seedance') {
      throw new AppError(400, 'VIDEO_CONTENT_UNAVAILABLE', '该任务没有 Seedance 视频内容')
    }
    if (!this.videoProvider) {
      throw new AppError(503, 'SEEDANCE_NOT_CONFIGURED', 'Seedance 服务尚未配置')
    }
    const providerTaskId = task.metadata.providerTaskId
    if (task.status !== 'completed' || typeof providerTaskId !== 'string') {
      throw new AppError(409, 'VIDEO_NOT_READY', '视频尚未生成完成')
    }
    try {
      return await this.videoProvider.getContent(providerTaskId)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Seedance 视频读取失败'
      throw new AppError(502, 'SEEDANCE_CONTENT_ERROR', message)
    }
  }

  private async sendMutationResult(
    result: TaskMutationResult,
    action: TaskMutationAction,
  ): Promise<GenerationTask> {
    const task = this.returnMutationResult(result, action)
    await this.dispatcher.dispatch(task)
    return task
  }

  private returnMutationResult(result: TaskMutationResult, action: TaskMutationAction): GenerationTask {
    if ('error' in result) throw taskMutationError(result.error, action)
    return result.task
  }
}

function taskMutationError(error: string, action: TaskMutationAction): AppError {
  if (error === 'task-not-found') {
    return new AppError(404, 'TASK_NOT_FOUND', '生成任务不存在或无权访问')
  }
  if (error === 'account-not-found') {
    return new AppError(401, 'ACCOUNT_NOT_FOUND', '账号不存在')
  }
  if (error === 'insufficient-credits') {
    return new AppError(402, 'INSUFFICIENT_CREDITS', '积分不足')
  }
  if (error === 'task-not-pausable') {
    return new AppError(409, 'TASK_NOT_PAUSABLE', '当前任务状态不能暂停')
  }
  if (error === 'task-not-resumable') {
    return new AppError(409, 'TASK_NOT_RESUMABLE', '当前任务状态不能继续')
  }
  if (error === 'task-not-deletable') {
    return new AppError(409, 'TASK_NOT_DELETABLE', '当前任务状态不能删除')
  }
  const code = action === 'cancel' ? 'TASK_NOT_CANCELLABLE' : 'TASK_NOT_RETRYABLE'
  const message = action === 'cancel' ? '当前任务状态不能取消' : '当前任务状态不能重试'
  return new AppError(409, code, message)
}
