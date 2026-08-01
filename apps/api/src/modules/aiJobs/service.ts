import type { AiJob, Principal } from '@seqora/contracts'
import type { AiJobRepository } from './repository.js'

export class AiJobService {
  constructor(private readonly repository: AiJobRepository) {}

  listProjectJobs(projectId: string, principal: Principal): Promise<AiJob[]> {
    return this.repository.listByProject(projectId, principal)
  }

  findJob(jobId: string, principal: Principal): Promise<AiJob | null> {
    return this.repository.findById(jobId, principal)
  }
}
