export type ShotReferenceImage = { url: string; name?: string | undefined }

export function shotReferenceImages(shot: {
  referenceImages?: ShotReferenceImage[] | null | undefined
  imageUrl?: string | null | undefined
  selectedImageTaskId?: string | null | undefined
}): ShotReferenceImage[] {
  if (Array.isArray(shot.referenceImages)) return shot.referenceImages
  // Older manually uploaded covers were also the shot's single video reference.
  return shot.imageUrl && !shot.selectedImageTaskId && !shot.imageUrl.startsWith('/api/v1/generation/tasks/')
    ? [{ url: shot.imageUrl, name: '原参考图' }]
    : []
}

export function validateShotReferences(prompt: string, count: number, continuity = false): void {
  const limit = continuity ? 8 : 9
  if (count > limit)
    throw new Error(
      continuity
        ? '连续镜头需预留一张上一镜尾帧，最多使用 8 张参考图，请移除多余图片或改为独立镜头。'
        : '每个镜头最多使用 9 张参考图。',
    )
  for (const match of prompt.matchAll(/【图(\d+)】/gu)) {
    const index = Number(match[1])
    if (index < 1 || index > count)
      throw new Error(`提示词中的${match[0]}没有对应参考图，请添加图片或移除该引用。`)
  }
}

export function mapShotReferenceTokens(prompt: string, count: number, continuity: boolean): string {
  validateShotReferences(prompt, count, continuity)
  return prompt.replace(
    /【图(\d+)】/gu,
    (_, index: string) => `【图${Number(index) + (continuity ? 1 : 0)}】`,
  )
}

export function orderedVideoReferenceImages(
  manual: string[],
  automatic: (string | null | undefined)[],
  limit = 9,
): string[] {
  if (manual.length > limit) throw new Error(`当前镜头最多使用 ${limit} 张参考图，请移除多余图片。`)
  // Explicit numbered references always retain their positions. Optional asset images fill the remaining slots.
  return [...new Set([...manual, ...automatic.filter((url): url is string => Boolean(url))])].slice(0, limit)
}
