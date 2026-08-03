import type { GenerationTask } from '@seqora/contracts'
import type { AppStore } from '../../infra/store.js'
import type { ProjectService } from '../../modules/projects/service.js'
import type { TrustedAssetService } from '../../modules/trustedAssets/service.js'
import { createScriptTaskHandler } from './scriptTaskHandler.js'
import { createTrustedAssetTaskHandler } from './trustedAssetTaskHandler.js'

export type LocalGenerationTaskHandler = {
  canHandle(task: GenerationTask): boolean
  execute(task: GenerationTask): Promise<unknown>
}

export function createLocalGenerationTaskHandler(
  store: AppStore,
  services: {
    projectService: () => ProjectService | null
    trustedAssetService: () => TrustedAssetService | null
  },
): LocalGenerationTaskHandler {
  return {
    canHandle(task) {
      return (
        (task.kind === 'text' && task.provider === 'text') ||
        (task.provider === 'asset-library' && task.metadata.trustedAssetOperation === 'register-virtual')
      )
    },
    async execute(task) {
      if (task.kind === 'text' && task.provider === 'text') {
        const service = services.projectService()
        if (!service) throw new Error('Project text service is not ready')
        return createScriptTaskHandler(store, service)(task)
      }
      if (task.provider === 'asset-library') {
        const service = services.trustedAssetService()
        if (!service) throw new Error('Trusted asset service is not ready')
        return createTrustedAssetTaskHandler(store, service)(task)
      }
      throw new Error(`Unsupported local generation task provider: ${task.provider}`)
    },
  }
}
