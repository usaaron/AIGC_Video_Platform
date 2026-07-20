import type { Account } from '@seqora/contracts'
import type { StateStore, StoredUser } from '../../infra/store.js'

export interface UserReader {
  findByEmail(email: string): Promise<StoredUser | null>
  findById(id: string): Promise<StoredUser | null>
  toAccount(user: StoredUser): Account
}

export class UserRepository implements UserReader {
  constructor(private readonly store: StateStore) {}

  async findByEmail(email: string): Promise<StoredUser | null> {
    return this.store.read((state) => state.users.find((user) => user.email === email.toLowerCase()) ?? null)
  }

  async findById(id: string): Promise<StoredUser | null> {
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
