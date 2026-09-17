import { generationTaskColumns, taskFromRow, type GenerationTaskRow } from './repositoryData.js'
import type { GenerationTask, Principal } from '@seqora/contracts'
import { canReadAllTenantContent } from '../../core/auth/roles.js'
import { releaseGenerationTaskLease } from '../../core/jobs/taskLease.js'
import type { AccountDatabase } from '../../infra/postgres.js'
import type { AppStore } from '../../infra/store.js'

type Queryable = Pick<AccountDatabase, 'query'>

export async function recoverExpiredFilmPreviewTasks(
  database: Queryable | null,
  store: AppStore | null,
  principal: Principal,
  projectId: string | null,
  mirrorTasks: (tasks: GenerationTask[]) => void | Promise<void>,
): Promise<void> {
  const recoveredAt = new Date().toISOString()
  const recoveryCutoff = new Date(Date.parse(recoveredAt) - 5 * 60_000).toISOString()
  const error = '成片预览合成进程已中断，请重新合成'
  const canReadAll = canReadAllTenantContent(principal)

  if (database) {
    const result = await database.query<GenerationTaskRow>(
      `
      UPDATE generation_tasks
      SET status = 'failed',
          progress = 100,
          error = $5,
          metadata = metadata || jsonb_build_object(
            'providerState', 'failed',
            'compositionStage', 'failed',
            'compositionRecoveredAt', $6::text
          ),
          lease_owner_id = NULL,
          lease_token = NULL,
          lease_acquired_at = NULL,
          lease_heartbeat_at = NULL,
          lease_expires_at = NULL,
          updated_at = $6::timestamptz
      WHERE provider = 'local-compose'
        AND status = 'running'
        AND tenant_id = $1
        AND ($2::boolean OR user_id = $3)
        AND ($4::text IS NULL OR project_id = $4)
        AND (lease_expires_at IS NULL OR lease_expires_at <= $6::timestamptz)
        AND updated_at <= $7::timestamptz
      RETURNING ${generationTaskColumns}
      `,
      [principal.tenantId, canReadAll, principal.userId, projectId, error, recoveredAt, recoveryCutoff],
    )
    await mirrorTasks(result.rows.map(taskFromRow))
    return
  }

  if (!store) {
    throw new Error('JSON AppStore is unavailable; GenerationTaskRepository must use Postgres in runtime')
  }
  await store.mutate((state) => {
    for (const task of state.tasks) {
      if (
        task.provider !== 'local-compose' ||
        task.status !== 'running' ||
        task.tenantId !== principal.tenantId ||
        (!canReadAll && task.userId !== principal.userId) ||
        (projectId !== null && task.projectId !== projectId)
      ) {
        continue
      }
      const expiresAt = task.leaseExpiresAt ? Date.parse(task.leaseExpiresAt) : Number.NaN
      if (Number.isFinite(expiresAt) && expiresAt > Date.parse(recoveredAt)) continue
      if (Date.parse(task.updatedAt) > Date.parse(recoveryCutoff)) continue
      task.status = 'failed'
      task.progress = 100
      task.error = error
      task.metadata = {
        ...task.metadata,
        providerState: 'failed',
        compositionStage: 'failed',
        compositionRecoveredAt: recoveredAt,
      }
      releaseGenerationTaskLease(task)
      task.updatedAt = recoveredAt
    }
  })
}
