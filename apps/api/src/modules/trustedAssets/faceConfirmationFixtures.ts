import { generationTaskSchema, type Principal } from '@seqora/contracts'
import { AppStore, defaultAssetAttributes } from '../../infra/store.js'

export const projectId = 'project-midnight-film'
export const assetId = 'confirmation-character'
export const principal: Principal = {
  userId: 'user-member',
  tenantId: 'tenant-seqora-demo',
  roles: ['member'],
}
export const face = (id = 'face-one') => ({
  id: `${id}-single`,
  url: `/api/v1/generation/tasks/${id}/outputs/single`,
  name: '角色测试-面部基准',
})

export async function createFaceConfirmationStore() {
  const store = new AppStore(null)
  await store.initialize()
  const now = new Date().toISOString()
  await store.mutate((state) => {
    state.assets.push({
      id: assetId,
      tenantId: principal.tenantId,
      projectId,
      kind: 'character',
      sourceMode: 'generate',
      name: '角色测试',
      description: '',
      prompt: '',
      promptMode: 'standard',
      customPromptMode: 'append',
      customPrompt: '',
      negativePrompt: '',
      references: [],
      imageUrl: null,
      status: 'draft',
      createdAt: now,
      updatedAt: now,
      attributes: defaultAssetAttributes('character'),
    })
    for (const id of ['face-one', 'face-two']) {
      state.tasks.push(
        generationTaskSchema.parse({
          id,
          clientRequestId: id,
          tenantId: principal.tenantId,
          userId: principal.userId,
          projectId,
          kind: 'image',
          label: 'Face candidate',
          prompt: '',
          negativePrompt: '',
          provider: 'img2',
          model: null,
          status: 'completed',
          progress: 100,
          estimatedCredits: 0,
          createdAt: now,
          updatedAt: now,
          resultUrl: face(id).url,
          outputs: [{ ...face(id), mediaType: 'image', view: 'single' }],
          error: null,
          metadata: {
            assetId,
            generationStage: 'face',
            generatedOutputs: [{ view: 'single', storageKey: `test/${id}.png`, contentType: 'image/png' }],
          },
        }),
      )
    }
  })
  return store
}
