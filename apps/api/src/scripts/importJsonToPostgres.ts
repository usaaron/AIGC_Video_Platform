import 'dotenv/config'
import { randomUUID } from 'node:crypto'
import { access, copyFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { loadConfig } from '../config.js'
import { AccountDatabase } from '../infra/postgres.js'
import { createObjectStorage } from '../infra/objectStorage.js'
import { AppStore } from '../infra/store.js'
import { StoreCreditLedger } from '../modules/billing/creditLedger.js'
import { GenerationTaskRepository } from '../modules/generation/repository.js'
import { AssetLibraryRepository } from '../modules/library/repository.js'
import { NovelRepository } from '../modules/novels/repository.js'
import { ProjectRepository } from '../modules/projects/repository.js'
import { UserRepository } from '../modules/users/repository.js'
import { MediaRepository } from '../modules/media/repository.js'

const config = loadConfig()

if (!config.DATABASE_URL) {
  throw new Error('DATABASE_URL is required for pnpm --filter @seqora/api db:import-json')
}
if (config.DATA_FILE === ':memory:') {
  throw new Error('DATA_FILE must point to the JSON app store for pnpm --filter @seqora/api db:import-json')
}

const dataFile = resolve(config.DATA_FILE)
await access(dataFile)
const backupPath = `${dataFile}.backup-${timestampForFile()}-${randomUUID().slice(0, 8)}`
await copyFile(dataFile, backupPath)

const store = new AppStore(
  dataFile,
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
)
const database = new AccountDatabase(config.DATABASE_URL)

try {
  await store.initialize()
  if (config.NODE_ENV === 'production') {
    await database.ensureLatestMigrations()
  } else {
    await database.migrate()
  }

  const users = new UserRepository(store, database)
  await users.bootstrapFromStore()

  const creditLedger = new StoreCreditLedger(store, users, config.NODE_ENV !== 'production', database)
  await creditLedger.bootstrapFromStore()

  const projects = new ProjectRepository(store, database)
  const projectResult = await projects.importFromStore()
  const media = new MediaRepository(
    store,
    database,
    config.STORAGE_DRIVER,
    config.STORAGE_DRIVER === 'gcs' ? config.GCS_BUCKET : null,
  )
  const mediaResult = await media.importFromStore()
  const library = new AssetLibraryRepository(store, database)
  const libraryResult = await library.importFromStore()
  const generationTasks = new GenerationTaskRepository(store, creditLedger, database)
  const taskResult = await generationTasks.importFromStore()
  const novels = new NovelRepository(store, database, createObjectStorage(config))
  const novelResult = await novels.importFromStore()

  process.stdout.write(
    [
      '[db:import-json] JSON backup created',
      `  source: ${dataFile}`,
      `  backup: ${backupPath}`,
      '[db:import-json] import complete',
      `  projects: inserted ${projectResult.projects.inserted}, skipped ${projectResult.projects.skipped}`,
      `  assets: inserted ${projectResult.assets.inserted}, skipped ${projectResult.assets.skipped}`,
      `  shots: inserted ${projectResult.shots.inserted}, skipped ${projectResult.shots.skipped}`,
      `  media_objects: inserted ${mediaResult.media.inserted}, skipped ${mediaResult.media.skipped}`,
      `  asset_library_items: inserted ${libraryResult.assetLibraryItems.inserted}, skipped ${libraryResult.assetLibraryItems.skipped}`,
      `  asset_library_item_versions: inserted ${libraryResult.assetLibraryItemVersions.inserted}, skipped ${libraryResult.assetLibraryItemVersions.skipped}`,
      `  generation_tasks: inserted ${taskResult.tasks.inserted}, skipped ${taskResult.tasks.skipped}`,
      `  novel_documents: inserted ${novelResult.documents.inserted}, skipped ${novelResult.documents.skipped}`,
      `  novel_chapters: inserted ${novelResult.chapters.inserted}, skipped ${novelResult.chapters.skipped}`,
      `  novel_boundaries: inserted ${novelResult.boundaries.inserted}, skipped ${novelResult.boundaries.skipped}`,
      `  novel_chapter_summaries: inserted ${novelResult.summaries.inserted}, skipped ${novelResult.summaries.skipped}`,
      `  novel_summary_queues: inserted ${novelResult.summaryQueues.inserted}, skipped ${novelResult.summaryQueues.skipped}`,
      `  novel_summary_queue_items: inserted ${novelResult.summaryQueueItems.inserted}, skipped ${novelResult.summaryQueueItems.skipped}`,
      `  novel_story_bibles: inserted ${novelResult.storyBibles.inserted}, skipped ${novelResult.storyBibles.skipped}`,
    ].join('\n') + '\n',
  )
} finally {
  await database.close()
}

function timestampForFile(): string {
  return new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z')
}
