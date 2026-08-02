import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppStore } from './store.js'

describe('AppStore mutation queue', () => {
  it('rolls back failed transactions before accepting the next write', async () => {
    const store = new AppStore(null)
    await store.initialize()
    const originalName = store.read((state) => state.projects[0]!.name)

    await expect(
      store.transaction((state) => {
        state.projects[0]!.name = 'temporary mutation'
        throw new Error('rejected transaction')
      }),
    ).rejects.toThrow('rejected transaction')

    expect(store.read((state) => state.projects[0]!.name)).toBe(originalName)

    await store.mutate((state) => {
      state.projects[0]!.name = '恢复后的项目'
    })

    expect(store.read((state) => state.projects[0]!.name)).toBe('恢复后的项目')
  })

  it('initializes an empty production-style store without auto-seeding demo data', async () => {
    const store = new AppStore(null, undefined, false, false)
    await store.initialize()

    expect(
      store.read((state) => ({
        users: state.users.map((user) => user.email),
        ledger: state.ledger.length,
        projects: state.projects.length,
        assets: state.assets.length,
        shots: state.shots.length,
      })),
    ).toEqual({
      users: [],
      ledger: 0,
      projects: 0,
      assets: 0,
      shots: 0,
    })
  })

  it('keeps file-backed stores synchronized across API and worker processes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'seqora-store-'))
    const filePath = join(directory, 'app.json')
    try {
      const apiStore = new AppStore(filePath)
      const workerStore = new AppStore(filePath)
      await apiStore.initialize()
      await workerStore.initialize()

      await apiStore.mutate((state) => {
        state.projects[0]!.name = 'api-write'
      })
      expect(workerStore.read((state) => state.projects[0]!.name)).toBe('api-write')

      await workerStore.mutate((state) => {
        state.projects[0]!.synopsis = 'worker-write'
      })

      expect(
        apiStore.read((state) => ({
          name: state.projects[0]!.name,
          synopsis: state.projects[0]!.synopsis,
        })),
      ).toEqual({ name: 'api-write', synopsis: 'worker-write' })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('keeps account runtime cache out of file persistence', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'seqora-store-'))
    const filePath = join(directory, 'app.json')
    try {
      const store = new AppStore(filePath)
      await store.initialize()
      const persistedBefore = JSON.parse(await readFile(filePath, 'utf8')) as {
        users: unknown[]
        ledger: unknown[]
        projects: Array<{ name: string }>
      }

      store.mutateAccountRuntimeCache((state) => {
        state.users.push({
          id: 'user-runtime-only',
          email: 'runtime-only@example.com',
          name: 'Runtime Only',
          passwordHash: 'hash',
          tenantId: 'tenant-runtime-only',
          roles: ['member'],
          plan: 'free',
          credits: 10,
          passwordResetRequired: false,
          emailVerified: true,
        })
        state.ledger.unshift({
          id: 'ledger-runtime-only',
          userId: 'user-runtime-only',
          tenantId: 'tenant-runtime-only',
          amount: 10,
          balance: 10,
          type: 'grant',
          description: 'Runtime only grant',
          createdAt: new Date().toISOString(),
        })
      })

      await store.mutate((state) => {
        state.projects[0]!.name = 'persistent-project-change'
        state.users.find((user) => user.id === 'user-runtime-only')!.credits = 8
      })

      expect(
        store.read((state) => state.users.find((user) => user.id === 'user-runtime-only')?.credits),
      ).toBe(8)
      const persistedAfter = JSON.parse(await readFile(filePath, 'utf8')) as {
        users: unknown[]
        ledger: unknown[]
        projects: Array<{ name: string }>
      }
      expect(persistedAfter.users).toEqual(persistedBefore.users)
      expect(persistedAfter.ledger).toEqual(persistedBefore.ledger)
      expect(persistedAfter.projects[0]!.name).toBe('persistent-project-change')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
