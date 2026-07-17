import { generationTaskSchema } from '@seqora/contracts'

const apiBase = import.meta.env.VITE_API_BASE_URL || '/api/v1'
const demoProviderEnabled = import.meta.env.VITE_ENABLE_DEMO_PROVIDER === 'true'

const kindByLabel = {
  文本: 'text',
  图片: 'image',
  视频: 'video',
  音频: 'audio',
}

export function getGenerationMode() {
  return demoProviderEnabled ? 'demo' : 'api'
}

export async function dispatchGeneration(payload) {
  if (demoProviderEnabled) {
    return {
      id: `demo-${payload.id}`,
      clientRequestId: payload.id,
      projectId: 'demo-project',
      tenantId: 'demo-tenant',
      userId: 'demo-user',
      kind: kindByLabel[payload.type] || 'image',
      label: payload.label,
      status: 'queued',
      progress: 0,
      estimatedCredits: payload.cost,
      createdAt: new Date().toISOString(),
    }
  }

  const response = await fetch(`${apiBase.replace(/\/$/, '')}/generation/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientRequestId: payload.id,
      projectId: 'demo-project',
      kind: kindByLabel[payload.type] || 'image',
      label: payload.label,
      estimatedCredits: payload.cost,
    }),
  })

  if (!response.ok) {
    throw new Error(`Generation API returned ${response.status}`)
  }

  return generationTaskSchema.parse(await response.json())
}
