import { describe, expect, it, vi } from 'vitest'
import type { AccountDatabase } from '../../infra/postgres.js'
import { ScriptMasterDeliveryRepository } from './deliveryRepository.js'

const input = {
  tenantId: 'tenant-test',
  targetProjectId: 'target-test',
  sourceProjectId: 'source-test',
  sourceRevision: 1,
  idempotencyKey: 'delivery-test',
  payloadHash: 'payload-test',
}
const pending = {
  status: 'in_progress',
  source_project_id: input.sourceProjectId,
  source_revision: 1,
  target_project_id: input.targetProjectId,
  payload_hash: input.payloadHash,
  imported_episodes: null,
  updated_episodes: null,
  completed_at: null,
}

describe('Script Master delivery reservations', () => {
  it('allows the caller that inserted a new database reservation to import', async () => {
    const query = vi
      .fn()
      .mockResolvedValue({ rowCount: 1, rows: [{ idempotency_key: input.idempotencyKey }] })
    const repository = new ScriptMasterDeliveryRepository({ query } as unknown as AccountDatabase)
    expect(await repository.begin(input)).toBeNull()
    expect(query).toHaveBeenCalledTimes(1)
    expect(query.mock.calls[0][0]).toContain('DO NOTHING')
  })

  it('blocks another caller while an identical database delivery is in progress', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [pending] })
    const repository = new ScriptMasterDeliveryRepository({ query } as unknown as AccountDatabase)
    expect(await repository.begin(input)).toEqual({ status: 'in_progress', input })
  })

  it('rejects reuse of an in-progress key for a different target', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ ...pending, target_project_id: 'another-project' }] })
    const repository = new ScriptMasterDeliveryRepository({ query } as unknown as AccountDatabase)
    await expect(repository.begin(input)).rejects.toThrow('different delivery payload')
  })

  it('returns the previous receipt without importing again', async () => {
    const completedAt = '2026-09-14T00:00:00.000Z'
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            ...pending,
            status: 'completed',
            imported_episodes: 2,
            updated_episodes: 1,
            completed_at: completedAt,
          },
        ],
      })
    const repository = new ScriptMasterDeliveryRepository({ query } as unknown as AccountDatabase)
    expect(await repository.begin(input)).toEqual({
      ...input,
      status: 'completed',
      importedEpisodes: 2,
      updatedEpisodes: 1,
      completedAt,
    })
  })

  it('does not import without owning a reservation after a concurrent release', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 0, rows: [] })
    const repository = new ScriptMasterDeliveryRepository({ query } as unknown as AccountDatabase)
    await expect(repository.begin(input)).rejects.toThrow('reservation changed')
  })

  it('keeps the same reservation and retry behavior in local mode', async () => {
    const repository = new ScriptMasterDeliveryRepository()
    expect(await repository.begin(input)).toBeNull()
    expect((await repository.begin(input))?.status).toBe('in_progress')
    await repository.release(input)
    expect(await repository.begin(input)).toBeNull()
    const receipt = await repository.complete(input, { importedEpisodes: 1, updatedEpisodes: 0 })
    expect(await repository.begin(input)).toEqual(receipt)
    await expect(repository.begin({ ...input, payloadHash: 'changed' })).rejects.toThrow(
      'different delivery payload',
    )
  })
})
