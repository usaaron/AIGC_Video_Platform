import { VolcArkSeedanceProvider, type VolcArkSeedanceOptions } from './volcArkSeedanceProvider.js'
import type {
  VideoGenerationRequest,
  VideoGenerationSubmission,
  VideoImageReference,
} from './videoProvider.js'

export type StringXSeedanceOptions = Omit<VolcArkSeedanceOptions, 'providerLabel'>

export class StringXSeedanceProvider extends VolcArkSeedanceProvider {
  constructor(options: StringXSeedanceOptions) {
    super({ ...options, providerLabel: '弦序' })
  }

  protected override imageContentPart(image: VideoImageReference): Record<string, unknown> {
    return {
      type: 'image_url',
      image_url: { url: image.url },
    }
  }

  override submit(request: VideoGenerationRequest): Promise<VideoGenerationSubmission> {
    const hasFirstFrame = request.images.some(
      (image) => typeof image !== 'string' && image.role === 'first_frame',
    )
    const hasLastFrame = request.images.some(
      (image) => typeof image !== 'string' && image.role === 'last_frame',
    )
    if (!hasFirstFrame || hasLastFrame) return super.submit(request)

    return super.submit({
      ...request,
      images: request.images.map((image) =>
        typeof image !== 'string' && image.role === 'first_frame'
          ? { ...image, role: 'reference_image' as const }
          : image,
      ),
    })
  }
}
