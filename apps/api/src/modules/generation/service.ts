import type { CreateGenerationTask, GenerationTask, Principal } from '@seqora/contracts'
import { AppError } from '../../core/errors.js'
import type { VideoGenerationProvider } from '../../core/generation/videoProvider.js'
import type { TaskDispatcher } from '../../core/jobs/taskDispatcher.js'
import type { GenerationTaskStore } from './repository.js'

const RETRYABLE_STATUSES = new Set<GenerationTask['status']>(['failed', 'cancelled'])

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

  async retryTask(taskId: string, principal: Principal): Promise<GenerationTask> {
    const task = await this.repository.findById(taskId, principal)
    if (!task) throw new AppError(404, 'TASK_NOT_FOUND', '生成任务不存在或无权访问')
    if (!RETRYABLE_STATUSES.has(task.status)) {
      throw new AppError(409, 'TASK_NOT_RETRYABLE', '只有失败或已取消的任务可以重试')
    }

    const retried = await this.repository.retry(taskId, principal)
    if (!retried) throw new AppError(404, 'TASK_NOT_FOUND', '生成任务不存在或无权访问')
    await this.dispatcher.dispatch(retried)
    return retried
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
}
