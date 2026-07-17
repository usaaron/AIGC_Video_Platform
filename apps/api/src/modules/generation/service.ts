import type { CreateGenerationTask, GenerationTask, Principal } from '@seqora/contracts'
import type { TaskDispatcher } from '../../core/jobs/taskDispatcher.js'
import type { CreditLedger } from '../billing/creditLedger.js'
import { AppError } from '../../core/errors.js'
import type { GenerationTaskRepository } from './repository.js'

export class GenerationService {
  constructor(
    private readonly repository: GenerationTaskRepository,
    private readonly creditLedger: CreditLedger,
    private readonly dispatcher: TaskDispatcher,
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
}
