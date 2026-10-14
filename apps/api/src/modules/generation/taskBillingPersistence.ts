import { type TaskBillingTarget } from '../billing/taskBillingTarget.js'
import type { Principal } from '@seqora/contracts'
import type { QueryResult, QueryResultRow } from 'pg'
type Queryable = {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: readonly unknown[],
  ): Promise<QueryResult<T>>
}
export async function updateBillingBalanceForTask(
  queryable: Queryable,
  principal: Principal,
  membership: TaskBillingTarget,
  nextCredits: number,
  clientRequestId: string,
  credits: number,
  description: string,
  now: string,
): Promise<void> {
  if (membership.billingScope === 'organization') {
    await queryable.query(
      `
      UPDATE organization_billing_accounts
      SET credits = $2,
          updated_at = now()
      WHERE tenant_id = $1
      `,
      [principal.tenantId, nextCredits],
    )
    await queryable.query(
      `
      INSERT INTO organization_billing_ledger_entries (
        id,
        tenant_id,
        user_id,
        membership_id,
        reference_id,
        related_entry_id,
        entry_type,
        amount,
        balance,
        description,
        created_by_user_id,
        created_at,
        updated_at,
        metadata
      )
      VALUES ($1, $2, $3, $4, $5, NULL, 'generation', $6, $7, $8, $3, $9, $9, '{}'::jsonb)
      `,
      [
        `generation-${clientRequestId}`,
        principal.tenantId,
        principal.userId,
        membership.id,
        clientRequestId,
        -credits,
        nextCredits,
        description,
        now,
      ],
    )
    return
  }

  await queryable.query(
    `
    UPDATE billing_accounts
    SET credits = $2,
        updated_at = now()
    WHERE membership_id = $1
    `,
    [membership.id, nextCredits],
  )
  await queryable.query(
    `
    INSERT INTO billing_ledger_entries (
      id,
      tenant_id,
      user_id,
      membership_id,
      reference_id,
      related_entry_id,
      entry_type,
      amount,
      balance,
      description,
      created_by_user_id,
      created_at,
      updated_at,
      metadata
    )
    VALUES ($1, $2, $3, $4, $5, NULL, 'generation', $6, $7, $8, $3, $9, $9, '{}'::jsonb)
    `,
    [
      `generation-${clientRequestId}`,
      principal.tenantId,
      principal.userId,
      membership.id,
      clientRequestId,
      -credits,
      nextCredits,
      description,
      now,
    ],
  )
}
