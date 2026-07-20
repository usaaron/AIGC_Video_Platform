import { describe, expect, it } from 'vitest'
import { AppStore } from './store.js'

describe('AppStore', () => {
  it('continues processing mutations after a failed mutation', async () => {
    const store = new AppStore(null)
    await store.initialize()

    await expect(
      store.mutate(() => {
        throw new Error('mutation failed')
      }),
    ).rejects.toThrow(/mutation failed/)

    await store.mutate((state) => {
      const user = state.users.find((item) => item.id === 'user-creator')
      if (user) user.credits -= 1
    })

    await expect(
      store.read((state) => state.users.find((item) => item.id === 'user-creator')?.credits),
    ).resolves.toBe(285)
  })
})
