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
