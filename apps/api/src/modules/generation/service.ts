import type { CreateGenerationTask, GenerationTask, Principal } from '@seqora/contracts'
import type { TaskDispatcher } from '../../core/jobs/taskDispatcher.js'
import type { CreditLedger } from '../billing/creditLedger.js'
import type { GenerationTaskRepository } from './repository.js'

export class GenerationService {
  constructor(
    private readonly repository: GenerationTaskRepository,
    private readonly creditLedger: CreditLedger,
    private readonly dispatcher: TaskDispatcher,
  ) {}

  async createTask(input: CreateGenerationTask, principal: Principal): Promise<GenerationTask> {
    await this.creditLedger.reserve(principal, input.estimatedCredits, input.clientRequestId)
    const task = await this.repository.create(input, principal)
    await this.dispatcher.dispatch(task)
    return task
  }

  listProjectTasks(projectId: string, principal: Principal): Promise<GenerationTask[]> {
    return this.repository.listByProject(projectId, principal)
  }
}
