import {
  enrichScriptRequestSchema,
  generateScriptRequestSchema,
  generateScriptAssetSuggestionsRequestSchema,
  type GenerationTask,
  type Principal,
} from '@seqora/contracts'
import type { AppStore } from '../../infra/store.js'
import type { ProjectService } from '../../modules/projects/service.js'
import type { LocalTaskExecutionContext } from './localTaskHandler.js'

export type TextTaskHandler = (task: GenerationTask, context?: LocalTaskExecutionContext) => Promise<unknown>

export function createScriptTaskHandler(store: AppStore, service: ProjectService): TextTaskHandler {
  return async (task, context) => {
    const principal = principalForTask(store, task)
    const operation = task.metadata.scriptOperation

    if (operation === 'generate') {
      const input = generateScriptRequestSchema.parse({
        clientRequestId: task.clientRequestId,
        draft: task.metadata.draft,
        direction: task.metadata.direction,
        mode: task.metadata.mode,
        segment: task.metadata.segment,
        productionMode: task.metadata.productionMode,
        episodeMinutes: task.metadata.episodeMinutes,
        episodeDurationSeconds: task.metadata.episodeDurationSeconds,
        model: task.model ?? task.metadata.model,
        revisionNote: task.metadata.revisionNote,
        episodeId: task.metadata.episodeId,
      })
      return service.generateScript(
        task.projectId,
        input.draft,
        input.direction,
        input.mode,
        input.segment,
        input.productionMode,
        input.episodeMinutes,
        task.clientRequestId,
        principal,
        input.model,
        input.revisionNote,
        task.metadata.billingMode === 'prepaid' ? 'prepaid' : 'direct',
        input.episodeDurationSeconds,
        context?.onTextProgress,
        context?.onTextTiming,
        input.episodeId,
      )
    }

    if (operation === 'enrich') {
      const input = enrichScriptRequestSchema.parse({
        clientRequestId: task.clientRequestId,
        script: task.metadata.script,
        direction: task.metadata.direction,
        productionMode: task.metadata.productionMode,
        episodeMinutes: task.metadata.episodeMinutes,
        episodeDurationSeconds: task.metadata.episodeDurationSeconds,
        model: task.model ?? task.metadata.model,
        revisionNote: task.metadata.revisionNote,
        episodeId: task.metadata.episodeId,
      })
      return service.enrichScript(
        task.projectId,
        input.script,
        input.direction,
        input.productionMode,
        input.episodeMinutes,
        task.clientRequestId,
        principal,
        input.model,
        input.revisionNote,
        task.metadata.billingMode === 'prepaid' ? 'prepaid' : 'direct',
        input.episodeDurationSeconds,
        context?.onTextProgress,
        context?.onTextTiming,
        input.episodeId,
      )
    }

    if (operation === 'suggest-assets') {
      const input = generateScriptAssetSuggestionsRequestSchema.parse({
        clientRequestId: task.clientRequestId,
        script: task.metadata.script,
        direction: task.metadata.direction,
        model: task.model ?? task.metadata.model,
      })
      if (input.strategy === 'fast') {
        return service.suggestScriptAssets(
          task.projectId,
          input.script,
          input.direction,
          principal,
          context?.onTextProgress,
          context?.onTextTiming,
          'fast',
        )
      }
      return service.suggestScriptAssets(
        task.projectId,
        input.script,
        input.direction,
        principal,
        context?.onTextProgress,
        context?.onTextTiming,
      )
    }

    throw new Error('Unsupported text task operation')
  }
}

function principalForTask(store: AppStore, task: GenerationTask): Principal {
  const user = store.read((state) =>
    state.users.find((item) => item.id === task.userId && item.tenantId === task.tenantId),
  )
  if (!user) throw new Error('Text task account no longer exists')
  return { userId: user.id, tenantId: user.tenantId, roles: user.roles }
}
