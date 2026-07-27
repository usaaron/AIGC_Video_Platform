import { describe, expect, it } from 'vitest'
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
        creatorEmail: 'tester@example.com',
        creatorPassword: 'UniqueCreatorPassword123!',
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
      users: ['tester@example.com', 'admin@example.com'],
      projects: 0,
      assets: 0,
      shots: 0,
    })
  })
})
