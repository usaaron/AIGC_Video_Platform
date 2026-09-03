import type { GenerationTask } from '@seqora/contracts'
import { generatedDescriptors } from './taskWriteback.js'

export class DependencyResolver {
  state(task: GenerationTask, userTasks: GenerationTask[]): 'ready' | 'waiting' | 'failed' {
    const dependencyIds = Array.isArray(task.metadata.dependsOnTaskIds)
      ? task.metadata.dependsOnTaskIds.filter((value): value is string => typeof value === 'string')
      : typeof task.metadata.dependsOnTaskId === 'string'
        ? [task.metadata.dependsOnTaskId]
        : []
    if (!dependencyIds.length) return 'ready'

    let waiting = false
    for (const dependencyId of dependencyIds) {
      const dependency = userTasks.find(
        (item) =>
          item.id === dependencyId && item.projectId === task.projectId && item.tenantId === task.tenantId,
      )
      if (
        !dependency ||
        dependency.status === 'failed' ||
        dependency.status === 'cancelled' ||
        typeof dependency.metadata.queueHiddenAt === 'string'
      ) {
        return 'failed'
      }
      if (this.continuityDependencyMissingFrame(task, userTasks)) return 'failed'
      if (dependency.status !== 'completed') waiting = true
    }
    return waiting ? 'waiting' : 'ready'
  }

  continuityDependencyMissingFrame(task: GenerationTask, userTasks: GenerationTask[]): boolean {
    const sourceTaskId = task.metadata.continuitySourceTaskId
    if (typeof sourceTaskId !== 'string') return false
    const source = userTasks.find(
      (item) =>
        item.id === sourceTaskId && item.projectId === task.projectId && item.tenantId === task.tenantId,
    )
    return Boolean(
      source?.status === 'completed' &&
      !generatedDescriptors(source).some((item) => item.view === 'last-frame'),
    )
  }
}
