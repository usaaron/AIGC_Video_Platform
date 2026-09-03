import { resolve } from 'node:path'
import type { AppConfig } from '../config.js'
import { AccountDatabase, type AccountDatabaseOptions } from '../infra/postgres.js'
import { AppStore } from '../infra/store.js'

export type RuntimeDatabase = {
  store: AppStore
  database: AccountDatabase | null
}

export async function createRuntimeDatabase(
  config: AppConfig,
  storeOverride?: AppStore,
): Promise<RuntimeDatabase> {
  const database = config.DATABASE_URL
    ? new AccountDatabase(config.DATABASE_URL, undefined, databaseOptions(config))
    : null
  if (database) {
    if (config.NODE_ENV === 'production') {
      await database.ensureLatestMigrations()
    } else {
      await database.migrate()
    }
  }

  // With Postgres configured, JSON is only a compatibility source. Keeping a
  // file-backed store in the API and worker makes every runtime task mutation
  // contend on a disk lock and serialize a full snapshot.
  const store = storeOverride ?? createRuntimeStore(config, Boolean(database))
  await store.initialize()

  return { store, database }
}

export function databaseOptions(
  config: Pick<
    AppConfig,
    | 'DATABASE_POOL_MAX'
    | 'DATABASE_POOL_MIN'
    | 'DATABASE_POOL_IDLE_TIMEOUT_MS'
    | 'DATABASE_POOL_CONNECTION_TIMEOUT_MS'
  >,
): AccountDatabaseOptions {
  return {
    max: config.DATABASE_POOL_MAX,
    min: config.DATABASE_POOL_MIN,
    idleTimeoutMillis: config.DATABASE_POOL_IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: config.DATABASE_POOL_CONNECTION_TIMEOUT_MS,
  }
}

export function createRuntimeStore(config: AppConfig, databaseConfigured = false): AppStore {
  return new AppStore(
    databaseConfigured && config.NODE_ENV === 'production'
      ? null
      : config.DATA_FILE === ':memory:'
        ? null
        : resolve(config.DATA_FILE),
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
    databaseConfigured && config.NODE_ENV === 'production',
  )
}
