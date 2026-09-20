import type { Shot } from '@seqora/contracts'
import type { QueryResult, QueryResultRow } from 'pg'

type Queryable = {
  query<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<QueryResult<T>>
}

export function insertionOrderFor(
  shots: Shot[],
  insertAfterShotId: string | null | undefined,
): number | null {
  if (insertAfterShotId === undefined) return shots.length + 1
  if (insertAfterShotId === null) return 1
  const anchor = shots.find((shot) => shot.id === insertAfterShotId)
  return anchor ? anchor.order + 1 : null
}

export function renumberProjectShots(shots: Shot[], projectId: string, tenantId: string): void {
  shots
    .filter((shot) => shot.projectId === projectId && shot.tenantId === tenantId)
    .sort((left, right) => left.order - right.order)
    .forEach((shot, index) => {
      shot.order = index + 1
    })
}

export async function renumberShotsInDatabase(
  queryable: Queryable,
  projectId: string,
  tenantId: string,
): Promise<void> {
  await queryable.query(
    `WITH ranked AS (
       SELECT id, ROW_NUMBER() OVER (ORDER BY shot_order ASC, created_at ASC, id ASC) AS next_order
       FROM shots WHERE project_id = $1 AND tenant_id = $2
     )
     UPDATE shots shot SET shot_order = ranked.next_order
     FROM ranked WHERE shot.id = ranked.id`,
    [projectId, tenantId],
  )
}
