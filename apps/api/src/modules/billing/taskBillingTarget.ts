import type { Principal } from '@seqora/contracts'
import type { QueryResult, QueryResultRow } from 'pg'

type Queryable = {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: readonly unknown[],
  ): Promise<QueryResult<T>>
}

export type TaskBillingTarget = {
  id: string
  credits: number | null
  billingScope: 'membership' | 'organization'
}

export async function resolveTaskBillingTarget(
  queryable: Queryable,
  principal: Principal,
  forUpdate: boolean,
): Promise<TaskBillingTarget | null> {
  const result = await queryable.query<{
    id: string
    credits: number | null
    organization_type: string | null
    roles: string[]
  }>(
    `
    SELECT
      m.id,
      ${forUpdate ? 'b.credits' : 'NULL::integer'} AS credits,
      t.organization_type,
      m.roles
    FROM tenant_memberships m
    JOIN users u ON u.id = m.user_id AND u.status = 'active'
    JOIN tenants t ON t.id = m.tenant_id AND t.status = 'active'
    JOIN billing_accounts b ON b.membership_id = m.id
    WHERE m.user_id = $1
      AND m.tenant_id = $2
      AND m.status = 'active'
    LIMIT 1
    ${forUpdate ? 'FOR UPDATE OF b' : ''}
    `,
    [principal.userId, principal.tenantId],
  )
  const row = result.rows[0]
  if (!row) return null

  const usesOrganizationPool =
    row.organization_type === 'enterprise' &&
    (row.roles.includes('organization_admin') || row.roles.includes('organization_member'))
  if (!forUpdate || !usesOrganizationPool) {
    return {
      id: row.id,
      credits: row.credits === null ? null : Number(row.credits),
      billingScope: 'membership',
    }
  }

  await queryable.query(
    `
    INSERT INTO organization_billing_accounts (tenant_id, credits, created_at, updated_at)
    VALUES ($1, 0, now(), now())
    ON CONFLICT (tenant_id) DO NOTHING
    `,
    [principal.tenantId],
  )
  const organizationAccount = await queryable.query<{ credits: number | string }>(
    `
    SELECT credits
    FROM organization_billing_accounts
    WHERE tenant_id = $1
    LIMIT 1
    FOR UPDATE
    `,
    [principal.tenantId],
  )
  const organizationCredits = organizationAccount.rows[0]?.credits
  if (organizationCredits === undefined) return null
  return {
    id: row.id,
    credits: Number(organizationCredits),
    billingScope: 'organization',
  }
}
