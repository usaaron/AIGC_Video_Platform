import type { GenerationTask } from '@seqora/contracts'

export interface TaskDispatcher {
  dispatch(task: GenerationTask): Promise<void>
}

export class DemoTaskDispatcher implements TaskDispatcher {
  async dispatch(_task: GenerationTask): Promise<void> {
    // Replace with a Redis, SQS, RabbitMQ, or managed queue adapter.
  }
}
