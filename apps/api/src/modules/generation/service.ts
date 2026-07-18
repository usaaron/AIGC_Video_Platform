import type { CreateGenerationTask, GenerationTask, Principal } from '@seqora/contracts'
import type { TaskDispatcher } from '../../core/jobs/taskDispatcher.js'
import type { VideoGenerationProvider } from '../../core/generation/videoProvider.js'
import type { CreditLedger } from '../billing/creditLedger.js'
import { AppError } from '../../core/errors.js'
import type { GenerationTaskRepository } from './repository.js'

export class GenerationService {
  constructor(
    private readonly repository: GenerationTaskRepository,
    private readonly creditLedger: CreditLedger,
    private readonly dispatcher: TaskDispatcher,
    private readonly videoProvider: VideoGenerationProvider | null = null,
  ) {}

  async createTask(input: CreateGenerationTask, principal: Principal): Promise<GenerationTask> {
    if (!this.repository.canCreate(input.projectId, principal)) {
      throw new AppError(404, 'PROJECT_NOT_FOUND', '项目不存在或无权生成')
    }
    await this.creditLedger.reserve(principal, input.estimatedCredits, input.clientRequestId, input.label)
    const task = await this.repository.create(input, principal)
    await this.dispatcher.dispatch(task)
    return task
  }

  listProjectTasks(projectId: string, principal: Principal): Promise<GenerationTask[]> {
    return Promise.resolve(this.repository.listByProject(projectId, principal))
  }

  clearCompleted(projectId: string, principal: Principal): Promise<number> {
    return this.repository.clearCompleted(projectId, principal)
  }

  async getVideoContent(taskId: string, principal: Principal) {
    const task = this.repository.findById(taskId, principal)
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
