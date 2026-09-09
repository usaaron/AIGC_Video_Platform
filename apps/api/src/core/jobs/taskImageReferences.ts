import type { GenerationTask } from '@seqora/contracts'
import type { AppStore } from '../../infra/store.js'
import type { MediaRepository } from '../../modules/media/repository.js'
import { parseStoredImageReference } from '../media/storedImageReference.js'
import { generatedDescriptors } from './taskWriteback.js'

export async function resolveStoredReference(
  store: AppStore,
  mediaRepository: Pick<MediaRepository, 'findSourceById'> | null,
  task: GenerationTask,
  url: string,
): Promise<{ storageKey: string; contentType: string } | null> {
  const cached = findStoredReference(store, task, url)
  if (cached) return cached
  const reference = parseStoredImageReference(url)
  if (reference?.kind !== 'media' || !mediaRepository) return null
  return mediaRepository.findSourceById(reference.mediaId, task.projectId, task.tenantId, 'image')
}

export function findStoredReference(
  store: AppStore,
  task: GenerationTask,
  url: string,
): { storageKey: string; contentType: string } | null {
  const reference = parseStoredImageReference(url)
  if (!reference) return null
  if (reference.kind === 'media') {
    return store.read((state) => {
      const media = state.media.find(
        (item) =>
          item.id === reference.mediaId &&
          item.kind === 'image' &&
          item.projectId === task.projectId &&
          item.tenantId === task.tenantId,
      )
      return media ? { storageKey: media.storageKey, contentType: media.contentType } : null
    })
  }

  return store.read((state) => {
    const sourceTask = state.tasks.find(
      (item) =>
        item.id === reference.taskId &&
        item.status === 'completed' &&
        item.projectId === task.projectId &&
        item.tenantId === task.tenantId,
    )
    const descriptor = generatedDescriptors(sourceTask).find(
      (item) => item.view === reference.view && item.contentType.startsWith('image/'),
    )
    return descriptor ? { storageKey: descriptor.storageKey, contentType: descriptor.contentType } : null
  })
}
