import type { GenerationTask } from '@seqora/contracts'
import type { AppStore } from '../../infra/store.js'
import type { GenerationService } from '../../modules/generation/service.js'
import { traceIdFromGenerationTask } from '../observability/trace.js'

export function createAutoFilmPreviewCallback(
  store: AppStore,
  serviceRef: () => GenerationService | null,
): (task: GenerationTask) => Promise<void> {
  return async (task) => {
    const service = serviceRef()
    if (!service) return
    const principal = store.read((state) => {
      const user = state.users.find((item) => item.id === task.userId && item.tenantId === task.tenantId)
      return user ? { userId: user.id, tenantId: user.tenantId, roles: user.roles } : null
    })
    if (!principal) return
    const allShotsReady = store.read((state) => {
      const shots = state.shots.filter(
        (shot) => shot.projectId === task.projectId && shot.tenantId === task.tenantId,
      )
      return (
        shots.length > 0 &&
        shots.every((shot) =>
          state.tasks.some(
            (source) =>
              source.projectId === task.projectId &&
              source.tenantId === task.tenantId &&
              source.kind === 'video' &&
              source.provider === 'seedance' &&
              source.status === 'completed' &&
              source.metadata.shotId === shot.id &&
              typeof source.metadata.providerTaskId === 'string',
          ),
        )
      )
    })
    if (allShotsReady) {
      await service.createFilmPreview(task.projectId, principal, 'full', false, traceIdFromGenerationTask(task))
    }
  }
}
