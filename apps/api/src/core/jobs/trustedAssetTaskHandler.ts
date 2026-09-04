import type { GenerationTask, Principal } from '@seqora/contracts'
import type { AppStore } from '../../infra/store.js'
import type { TrustedAssetService } from '../../modules/trustedAssets/service.js'

export type TrustedAssetTaskHandler = (task: GenerationTask) => Promise<unknown>

export function createTrustedAssetTaskHandler(
  store: AppStore,
  service: TrustedAssetService,
): TrustedAssetTaskHandler {
  return async (task) => {
    if (task.metadata.trustedAssetOperation !== 'register-virtual') {
      throw new Error('Unsupported trusted asset task operation')
    }
    const assetId = task.metadata.assetId
    if (typeof assetId !== 'string' || !assetId) throw new Error('人物资产 ID 缺失')
    const asset = await service.registerVirtual(task.projectId, assetId, principalForTask(store, task))
    const portrait = asset.attributes.type === 'character' ? asset.attributes.trustedPortrait : null
    if (portrait?.status === 'failed') {
      throw new Error(portrait.errorMessage || portrait.errorCode || 'Dora 人像资源审核失败')
    }
    return asset
  }
}

function principalForTask(store: AppStore, task: GenerationTask): Principal {
  const user = store.read((state) =>
    state.users.find((item) => item.id === task.userId && item.tenantId === task.tenantId),
  )
  if (!user) throw new Error('Trusted asset task account no longer exists')
  return { userId: user.id, tenantId: user.tenantId, roles: user.roles }
}
