import type { AccountDatabase } from '../../infra/postgres.js'

export type ScriptMasterDeliveryInput = {
  tenantId: string
  targetProjectId: string
  sourceProjectId: string
  sourceRevision: number
  idempotencyKey: string
  payloadHash: string
}

export type ScriptMasterDeliveryReceipt = ScriptMasterDeliveryInput & {
  status: 'completed'
  importedEpisodes: number
  updatedEpisodes: number
  completedAt: string
}

type StoredDelivery =
  ScriptMasterDeliveryReceipt | { status: 'in_progress'; input: ScriptMasterDeliveryInput }

export class ScriptMasterDeliveryRepository {
  private readonly memory = new Map<string, StoredDelivery>()

  constructor(private readonly database: AccountDatabase | null = null) {}

  async begin(input: ScriptMasterDeliveryInput): Promise<StoredDelivery | null> {
    if (!this.database) {
      const key = this.key(input)
      const current = this.memory.get(key)
      if (current) {
        this.assertSame(this.inputOf(current), input)
        return current
      }
      this.memory.set(key, { status: 'in_progress', input })
      return null
    }

    const inserted = await this.database.query(
      `INSERT INTO script_master_deliveries (
         tenant_id, target_project_id, source_project_id, source_revision,
         idempotency_key, payload_hash, status
       ) VALUES ($1, $2, $3, $4, $5, $6, 'in_progress')
       ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
       RETURNING idempotency_key`,
      [
        input.tenantId,
        input.targetProjectId,
        input.sourceProjectId,
        input.sourceRevision,
        input.idempotencyKey,
        input.payloadHash,
      ],
    )
    if (inserted.rowCount) return null

    const result = await this.database.query<{
      status: 'in_progress' | 'completed'
      source_project_id: string
      source_revision: number
      target_project_id: string
      payload_hash: string
      imported_episodes: number | null
      updated_episodes: number | null
      completed_at: string | null
    }>(
      `SELECT status, source_project_id, source_revision, target_project_id, payload_hash,
              imported_episodes, updated_episodes, completed_at
       FROM script_master_deliveries WHERE tenant_id = $1 AND idempotency_key = $2`,
      [input.tenantId, input.idempotencyKey],
    )
    const row = result.rows[0]
    // A concurrent failed attempt may release its reservation between these queries.
    if (!row) throw new Error('Delivery reservation changed; retry the request.')
    const existingInput: ScriptMasterDeliveryInput = {
      tenantId: input.tenantId,
      targetProjectId: row.target_project_id,
      sourceProjectId: row.source_project_id,
      sourceRevision: row.source_revision,
      idempotencyKey: input.idempotencyKey,
      payloadHash: row.payload_hash,
    }
    this.assertSame(existingInput, input)
    if (row.status === 'in_progress') return { status: 'in_progress', input: existingInput }
    return {
      status: 'completed',
      ...existingInput,
      importedEpisodes: row.imported_episodes ?? 0,
      updatedEpisodes: row.updated_episodes ?? 0,
      completedAt: row.completed_at ?? new Date(0).toISOString(),
    }
  }

  async complete(
    input: ScriptMasterDeliveryInput,
    result: Pick<ScriptMasterDeliveryReceipt, 'importedEpisodes' | 'updatedEpisodes'>,
  ): Promise<ScriptMasterDeliveryReceipt> {
    const completedAt = new Date().toISOString()
    const receipt: ScriptMasterDeliveryReceipt = { ...input, ...result, status: 'completed', completedAt }
    if (!this.database) {
      this.memory.set(this.key(input), receipt)
      return receipt
    }
    await this.database.query(
      `UPDATE script_master_deliveries
       SET status = 'completed', imported_episodes = $7, updated_episodes = $8, completed_at = $9
       WHERE tenant_id = $1 AND target_project_id = $2 AND source_project_id = $3
         AND source_revision = $4 AND idempotency_key = $5 AND payload_hash = $6`,
      [
        input.tenantId,
        input.targetProjectId,
        input.sourceProjectId,
        input.sourceRevision,
        input.idempotencyKey,
        input.payloadHash,
        result.importedEpisodes,
        result.updatedEpisodes,
        completedAt,
      ],
    )
    return receipt
  }

  async release(input: ScriptMasterDeliveryInput): Promise<void> {
    if (!this.database) {
      this.memory.delete(this.key(input))
      return
    }
    await this.database.query(
      `DELETE FROM script_master_deliveries
       WHERE tenant_id = $1 AND target_project_id = $2 AND idempotency_key = $3 AND status = 'in_progress'`,
      [input.tenantId, input.targetProjectId, input.idempotencyKey],
    )
  }

  private key(input: ScriptMasterDeliveryInput): string {
    return `${input.tenantId}:${input.idempotencyKey}`
  }

  private inputOf(value: StoredDelivery): ScriptMasterDeliveryInput {
    if (value.status === 'in_progress') return value.input
    return {
      tenantId: value.tenantId,
      targetProjectId: value.targetProjectId,
      sourceProjectId: value.sourceProjectId,
      sourceRevision: value.sourceRevision,
      idempotencyKey: value.idempotencyKey,
      payloadHash: value.payloadHash,
    }
  }

  private assertSame(left: ScriptMasterDeliveryInput, right: ScriptMasterDeliveryInput): void {
    if (
      left.targetProjectId !== right.targetProjectId ||
      left.sourceProjectId !== right.sourceProjectId ||
      left.sourceRevision !== right.sourceRevision ||
      left.payloadHash !== right.payloadHash
    ) {
      throw new Error('The idempotency key was already used for a different delivery payload.')
    }
  }
}
