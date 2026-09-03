import type { GenerationTask, Principal } from '@seqora/contracts'
import { canReadAllTenantContent } from '../../core/auth/roles.js'

export function findControlledTask(
  tasks: GenerationTask[],
  taskId: string,
  principal: Principal,
): GenerationTask | undefined {
  const canControlAll = canReadAllTenantContent(principal)
  return tasks.find(
    (task) =>
      task.id === taskId &&
      task.tenantId === principal.tenantId &&
      (canControlAll || task.userId === principal.userId),
  )
}

export function metadataString(metadata: Record<string, unknown> | undefined, key: string): string | null {
  const value = metadata?.[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}
