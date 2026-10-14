import type { GenerationTask } from '@seqora/contracts'

export function queuedTextTask(id: string): GenerationTask {
  const now = new Date().toISOString()
  return {
    id,
    clientRequestId: `${id}-client`,
    projectId: 'project-midnight-film',
    tenantId: 'tenant-seqora-demo',
    userId: 'user-member',
    kind: 'text',
    label: id,
    prompt: '生成一集网剧',
    negativePrompt: '',
    provider: 'text',
    model: 'deepseek-v4-flash',
    metadata: { scriptOperation: 'generate' },
    status: 'queued',
    progress: 0,
    estimatedCredits: 3,
    createdAt: now,
    updatedAt: now,
    resultUrl: null,
    outputs: [],
    error: null,
  }
}
