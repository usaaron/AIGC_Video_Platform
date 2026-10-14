import type { GenerationTask } from '@seqora/contracts'
import type { ImageGenerationRequest, ImageReference } from '../generation/imageProvider.js'

export function imageRequestFor(task: GenerationTask, references: ImageReference[]): ImageGenerationRequest {
  const outputs: ImageGenerationRequest['outputs'] =
    task.metadata.turnaround === true ? ['front', 'side', 'back'] : ['single']
  const quality = image2Quality(task.metadata.quality)
  return {
    taskId: task.id,
    idempotencyKey: stringValue(
      task.metadata.providerIdempotencyKey,
      `generation:${task.tenantId}:${task.id}`,
    ),
    assetId: stringValue(task.metadata.assetId, ''),
    model: task.model,
    aspectRatio: stringValue(task.metadata.aspectRatio, '1:1'),
    ...(quality ? { quality } : {}),
    prompt: [task.prompt, stringValue(task.metadata.compiledPositivePrompt, '')].filter(Boolean).join('\n'),
    negativePrompt: task.negativePrompt,
    references,
    outputs,
  }
}

function image2Quality(value: unknown): ImageGenerationRequest['quality'] {
  return value === 'low' || value === 'medium' || value === 'high' ? value : undefined
}

export function finalizeImage2GenerationSnapshot(
  task: GenerationTask,
  negativePrompt: string,
  userNegativePrompt: string,
): Record<string, unknown> {
  const existing = objectValue(task.metadata.generationSnapshot)
  const existingReferences = Array.isArray(existing.references) ? existing.references : null
  const references =
    existingReferences ?? (Array.isArray(task.metadata.references) ? task.metadata.references : [])
  const existingAssist = objectValue(existing.assist)
  const existingAssistResults = objectValue(existing.assistResults)
  const promptOptimization = objectValue(task.metadata.promptOptimization)
  const referenceVision = objectValue(task.metadata.referenceVision)

  return {
    ...existing,
    version: 1,
    finalized: true,
    model: stringValue(existing.model, task.model ?? 'seqora-image2'),
    prompt: task.prompt,
    originalPrompt: stringValue(
      existing.originalPrompt,
      stringValue(task.metadata.originalPrompt, task.prompt),
    ),
    negativePrompt,
    userNegativePrompt,
    aspectRatio: stringValue(existing.aspectRatio, stringValue(task.metadata.aspectRatio, 'auto')),
    quality: image2Quality(existing.quality) ?? image2Quality(task.metadata.quality) ?? 'low',
    imageCount: positiveInteger(existing.imageCount) ?? positiveInteger(task.metadata.batchSize) ?? 1,
    references,
    assist: {
      promptOptimization: existingAssist.promptOptimization === true || promptOptimization.requested === true,
      referenceVision: existingAssist.referenceVision === true || referenceVision.requested === true,
    },
    assistResults: {
      promptOptimization:
        Object.keys(existingAssistResults.promptOptimization ?? {}).length > 0
          ? existingAssistResults.promptOptimization
          : promptOptimization,
      referenceVision:
        Object.keys(existingAssistResults.referenceVision ?? {}).length > 0
          ? existingAssistResults.referenceVision
          : referenceVision,
    },
  }
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value ? value : fallback
}
function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}
function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null
}
