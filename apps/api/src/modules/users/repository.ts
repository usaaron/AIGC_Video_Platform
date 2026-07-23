import type { Account } from '@seqora/contracts'
import type { AppStore, StoredUser } from '../../infra/store.js'

export class UserRepository {
  constructor(private readonly store: AppStore) {}

  findByEmail(email: string): StoredUser | null {
    return this.store.read((state) => state.users.find((user) => user.email === email.toLowerCase()) ?? null)
  }

  findById(id: string): StoredUser | null {
    return this.store.read((state) => state.users.find((user) => user.id === id) ?? null)
  }

  async updatePassword(userId: string, tenantId: string, passwordHash: string): Promise<boolean> {
    return this.store.mutate((state) => {
      const user = state.users.find((item) => item.id === userId && item.tenantId === tenantId)
      if (!user) return false
      user.passwordHash = passwordHash
      return true
    })
  }

  toAccount(user: StoredUser): Account {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      tenantId: user.tenantId,
      roles: user.roles,
      plan: user.plan,
      credits: user.credits,
    }
  }
}
