import { describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
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

  it('can bootstrap production accounts without demo projects or assets', async () => {
    const store = new AppStore(
      null,
      {
        memberEmail: 'tester@example.com',
        memberPassword: 'UniqueMemberPassword123!',
        ownerEmail: 'owner@example.com',
        ownerPassword: 'UniqueOwnerPassword123!',
        superAdminEmail: 'superadmin@example.com',
        superAdminPassword: 'UniqueSuperAdminPassword123!',
        adminEmail: 'admin@example.com',
        adminPassword: 'UniqueAdminPassword123!',
      },
      false,
    )
    await store.initialize()

    expect(
      store.read((state) => ({
        users: state.users.map((user) => user.email),
        projects: state.projects.length,
        assets: state.assets.length,
        shots: state.shots.length,
      })),
    ).toEqual({
      users: ['tester@example.com', 'owner@example.com', 'superadmin@example.com', 'admin@example.com'],
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
})
