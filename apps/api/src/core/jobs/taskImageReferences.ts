import type { GenerationTask } from '@seqora/contracts'
import type { AppStore } from '../../infra/store.js'
import type { MediaRepository } from '../../modules/media/repository.js'
import { generatedDescriptors } from './taskWriteback.js'

/** Uploaded media lives in Postgres in production; worker caches are not its source of truth. */
export async function resolveStoredImageReference(
  store: AppStore,
  repository: Pick<MediaRepository, 'findSourceById'> | null,
  task: GenerationTask,
  url: string,
): Promise<{ storageKey: string; contentType: string } | null> {
  const mediaId = /^\/api\/v1\/media\/([^/]+)$/.exec(url)?.[1]
  if (mediaId) {
    if (repository) return repository.findSourceById(mediaId, task.projectId, task.tenantId, 'image')
    return store.read((state) => {
      const media = state.media.find(
        (item) => item.id === mediaId && item.projectId === task.projectId && item.tenantId === task.tenantId,
      )
      return media ? { storageKey: media.storageKey, contentType: media.contentType } : null
    })
  }
  const generated = /^\/api\/v1\/generation\/tasks\/([^/]+)\/outputs\/([^/]+)$/.exec(url)
  if (!generated) return null
  return store.read((state) => {
    const sourceTask = state.tasks.find(
      (item) =>
        item.id === generated[1] && item.projectId === task.projectId && item.tenantId === task.tenantId,
    )
    const descriptor = generatedDescriptors(sourceTask).find((item) => item.view === generated[2])
    return descriptor ? { storageKey: descriptor.storageKey, contentType: descriptor.contentType } : null
  })
}
