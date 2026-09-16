import type { GenerationTask } from '@seqora/contracts'
import type { AppStore } from '../../infra/store.js'
import type { ObjectStorage } from '../../infra/objectStorage.js'
import type { MediaRepository } from '../../modules/media/repository.js'
import type { VideoGenerationRequest } from '../generation/videoProvider.js'
import { generatedDescriptors } from './taskWriteback.js'
import { resolveStoredImageReference, videoImageUrl, type VideoSourceUrl } from './taskImageReferences.js'

export async function resolveVideoImages(
  task: GenerationTask,
  store: AppStore,
  options: {
    objectStorage: ObjectStorage | null
    mediaRepository: Pick<MediaRepository, 'findSourceById'> | null
    videoSourceUrl: VideoSourceUrl | null
  },
): Promise<VideoGenerationRequest['images']> {
  const images: VideoGenerationRequest['images'] = []
  const continuitySourceTaskId =
    typeof task.metadata.continuitySourceTaskId === 'string' ? task.metadata.continuitySourceTaskId : ''
  const legacyStoryboardImageUrl =
    typeof task.metadata.storyboardImageUrl === 'string' ? task.metadata.storyboardImageUrl : ''
  if (continuitySourceTaskId) {
    if (!options.objectStorage) throw new Error('连续镜头需要对象存储读取上一镜头尾帧')
    const sourceTask = store.read(
      (state) =>
        state.tasks.find(
          (item) =>
            item.id === continuitySourceTaskId &&
            item.projectId === task.projectId &&
            item.tenantId === task.tenantId &&
            item.status === 'completed',
        ) ?? null,
    )
    const lastFrame = generatedDescriptors(sourceTask ?? undefined).find((item) => item.view === 'last-frame')
    if (!lastFrame) throw new Error('上一镜头没有可用尾帧，请重新生成上一镜头后再继续')
    const url = await videoImageUrl(options.objectStorage, lastFrame, options.videoSourceUrl)
    images.push({ url, role: 'first_frame' })
  }

  if (!Array.isArray(task.metadata.images)) return images
  const numbered = Array.isArray(task.metadata.manualReferenceImages)
  if (numbered && task.metadata.images.length + images.length > 9)
    throw new Error('视频参考图超过 9 张，请重新保存分镜后生成')
  for (const value of task.metadata.images.slice(0, Math.max(0, 9 - images.length))) {
    if (typeof value !== 'string') continue
    // Static storyboard frames are a legacy pre-video path. New videos rely on
    // asset references and the preceding real video tail frame instead.
    if (!numbered && legacyStoryboardImageUrl && value === legacyStoryboardImageUrl) continue
    if (/^asset:\/\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) {
      images.push({ url: value, role: 'reference_image' })
      continue
    }
    if (/^https?:\/\//.test(value)) {
      images.push({ url: value, role: 'reference_image' })
      continue
    }
    const stored = await resolveStoredImageReference(store, options.mediaRepository, task, value)
    if (!options.objectStorage || !stored) {
      if (numbered || task.metadata.providerName === 'dora-router-seedance') {
        throw new Error('视频参考原图不存在或无权读取，请重新上传并确认人物面部')
      }
      continue
    }
    const url = await videoImageUrl(options.objectStorage, stored, options.videoSourceUrl)
    images.push({ url, role: 'reference_image' })
  }
  return images
}
