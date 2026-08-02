import { resolve } from 'node:path'
import type { AppConfig } from '../config.js'
import { AccountDatabase } from '../infra/postgres.js'
import { AppStore } from '../infra/store.js'

export type RuntimeDatabase = {
  store: AppStore
  database: AccountDatabase | null
}

export async function createRuntimeDatabase(
  config: AppConfig,
  storeOverride?: AppStore,
): Promise<RuntimeDatabase> {
  const store = storeOverride ?? createRuntimeStore(config)
  await store.initialize()

  const database = config.DATABASE_URL ? new AccountDatabase(config.DATABASE_URL) : null
  if (database) {
    if (config.NODE_ENV === 'production') {
      await database.ensureLatestMigrations()
    } else {
      await database.migrate()
    }
  }

  return { store, database }
}

export function createRuntimeStore(config: AppConfig): AppStore {
  return new AppStore(
    config.DATA_FILE === ':memory:' ? null : resolve(config.DATA_FILE),
    {
      memberName: config.BOOTSTRAP_MEMBER_NAME,
      memberEmail: config.BOOTSTRAP_MEMBER_EMAIL,
      memberPassword: config.BOOTSTRAP_MEMBER_PASSWORD,
      ownerName: config.BOOTSTRAP_OWNER_NAME,
      ownerEmail: config.BOOTSTRAP_OWNER_EMAIL,
      ownerPassword: config.BOOTSTRAP_OWNER_PASSWORD,
      superAdminName: config.BOOTSTRAP_SUPER_ADMIN_NAME,
      superAdminEmail: config.BOOTSTRAP_SUPER_ADMIN_EMAIL,
      superAdminPassword: config.BOOTSTRAP_SUPER_ADMIN_PASSWORD,
      adminName: config.BOOTSTRAP_ADMIN_NAME,
      adminEmail: config.BOOTSTRAP_ADMIN_EMAIL,
      adminPassword: config.BOOTSTRAP_ADMIN_PASSWORD,
    },
    config.BOOTSTRAP_DEMO_WORKSPACE,
    config.NODE_ENV !== 'production',
    config.NODE_ENV !== 'production',
  )
}
