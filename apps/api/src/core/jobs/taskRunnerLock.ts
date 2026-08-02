import type { AccountDatabase } from '../../infra/postgres.js'

export interface TaskRunnerLock {
  runExclusive(operation: () => Promise<void>): Promise<boolean>
}

export const noopTaskRunnerLock: TaskRunnerLock = {
  async runExclusive(operation) {
    await operation()
    return true
  },
}

export class PostgresAdvisoryTaskRunnerLock implements TaskRunnerLock {
  constructor(
    private readonly database: AccountDatabase,
    private readonly lockKey = 'seqora:generation-task-runner',
  ) {}

  async runExclusive(operation: () => Promise<void>): Promise<boolean> {
    const result = await this.database.withAdvisoryLock(this.lockKey, async () => {
      await operation()
      return true
    })
    return result === true
  }
}
