import { describe, expect, it, vi } from 'vitest'
import type { AccountDatabase } from '../../infra/postgres.js'
import { AppStore } from '../../infra/store.js'
import { UserRepository } from './repository.js'

describe('UserRepository runtime cache', () => {
  it('loads active database memberships created after worker startup', async () => {
    const store = new AppStore(null)
    await store.initialize()
    const database = {
      query: vi.fn(async () => ({
        rows: [
          {
            id: 'user-created-after-startup',
            email: 'new-user@example.com',
            name: 'New user',
            password_hash: 'hashed-password',
            tenant_id: 'tenant-new-user',
            roles: ['member'],
            plan: 'member',
            credits: 321,
            password_reset_required: false,
            email_verified: true,
          },
        ],
      })),
    } as unknown as AccountDatabase
    const repository = new UserRepository(store, database)

    await repository.refreshRuntimeCacheFromDatabase()

    expect(store.read((state) => state.users)).toEqual([
      expect.objectContaining({
        id: 'user-created-after-startup',
        tenantId: 'tenant-new-user',
        roles: ['member'],
        plan: 'member',
        credits: 321,
      }),
    ])
  })
})
