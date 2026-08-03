import type { Principal } from '@seqora/contracts'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { LocalObjectStorage } from '../../infra/objectStorage.js'
import { AccountDatabase } from '../../infra/postgres.js'
import { AppStore } from '../../infra/store.js'
import { startPostgresAuthFixture, type PostgresAuthFixture } from '../../testing/postgresAuth.js'
import { ProjectRepository } from '../projects/repository.js'
import { UserRepository } from '../users/repository.js'
import { NovelRepository } from './repository.js'

const uploadDir = resolve('./data/test-novel-uploads')
const principal: Principal = {
  userId: 'user-member',
  tenantId: 'tenant-seqora-demo',
  roles: ['member'],
}

let postgres: PostgresAuthFixture | undefined

beforeAll(async () => {
  postgres = await startPostgresAuthFixture()
}, 120_000)

beforeEach(async () => {
  await postgres?.reset()
})

afterEach(async () => {
  await rm(uploadDir, { recursive: true, force: true })
})

afterAll(async () => {
  await postgres?.close()
})

describe('novel postgres repository', { timeout: 30_000 }, () => {
  it('stores novel metadata in Postgres and source text in ObjectStorage without writing JSON novel state', async () => {
    const { database, store } = await createSeededDatabase()
    const objectStorage = new LocalObjectStorage(uploadDir)
    const repository = new NovelRepository(store, database, objectStorage)
    try {
      const chapterOne = 'Chapter 1\nThe editor finds the first marked page.'
      const separator = '\n\n'
      const chapterTwo = 'Chapter 2\nThe page points to a sealed archive.'
      const content = `${chapterOne}${separator}${chapterTwo}`
      const secondStart = chapterOne.length + separator.length

      const imported = await repository.importNovel(
        'project-midnight-film',
        {
          clientRequestId: 'novel-postgres-only',
          name: 'Postgres Novel',
          format: 'txt',
          content,
        },
        [
          {
            order: 1,
            title: 'Chapter 1',
            startOffset: 0,
            endOffset: chapterOne.length,
            sourceStartOffset: 0,
            sourceEndOffset: chapterOne.length,
            sourceChapterTitle: 'Chapter 1',
            splitMode: 'heading',
            overlapBeforeChars: 0,
            overlapAfterChars: 0,
            crossesChapterBoundary: false,
            characterCount: chapterOne.length,
            preview: chapterOne,
            content: chapterOne,
          },
          {
            order: 2,
            title: 'Chapter 2',
            startOffset: secondStart,
            endOffset: content.length,
            sourceStartOffset: secondStart,
            sourceEndOffset: content.length,
            sourceChapterTitle: 'Chapter 2',
            splitMode: 'heading',
            overlapBeforeChars: 0,
            overlapAfterChars: 0,
            crossesChapterBoundary: false,
            characterCount: chapterTwo.length,
            preview: chapterTwo,
            content: chapterTwo,
          },
        ],
        principal,
      )

      expect(imported).toMatchObject({
        document: {
          projectId: 'project-midnight-film',
          tenantId: 'tenant-seqora-demo',
          name: 'Postgres Novel',
          chapterCount: 2,
        },
        chapters: [
          expect.objectContaining({
            title: 'Chapter 1',
            preview: expect.stringContaining('first marked page'),
          }),
          expect.objectContaining({
            title: 'Chapter 2',
            preview: expect.stringContaining('sealed archive'),
          }),
        ],
      })
      expect(
        store.read((state) => ({
          documents: state.novelDocuments.length,
          chapters: state.novelChapters.length,
          summaries: state.novelChapterSummaries.length,
          queues: state.novelSummaryQueues.length,
          queueItems: state.novelSummaryQueueItems.length,
          boundaries: state.novelBoundaries.length,
          storyBibles: state.novelStoryBibles.length,
        })),
      ).toEqual({
        documents: 0,
        chapters: 0,
        summaries: 0,
        queues: 0,
        queueItems: 0,
        boundaries: 0,
        storyBibles: 0,
      })

      const persisted = await database.query<{
        document_count: string
        chapter_count: string
        content_storage_key: string
      }>(
        `
        SELECT
          count(*)::text AS document_count,
          (SELECT count(*)::text FROM novel_chapters WHERE document_id = d.id) AS chapter_count,
          max(d.content_storage_key) AS content_storage_key
        FROM novel_documents d
        WHERE d.client_request_id = 'novel-postgres-only'
        GROUP BY d.id
        `,
      )
      expect(persisted.rows[0]).toMatchObject({
        document_count: '1',
        chapter_count: '2',
        content_storage_key: expect.stringContaining('/novels/'),
      })
      await expect(objectStorage.get(persisted.rows[0]!.content_storage_key)).resolves.toEqual(
        Buffer.from(content, 'utf8'),
      )

      const emptyStore = new AppStore(null, undefined, false, false)
      await emptyStore.initialize()
      const reloadedRepository = new NovelRepository(emptyStore, database, objectStorage)
      const reloaded = await reloadedRepository.detail(
        'project-midnight-film',
        imported!.document.id,
        principal,
      )
      const source = await reloadedRepository.sourceForGeneration(
        'project-midnight-film',
        imported!.document.id,
        principal,
      )

      expect(reloaded).toMatchObject({ document: { name: 'Postgres Novel', chapterCount: 2 } })
      expect(source).toMatchObject({
        chapters: [
          expect.objectContaining({ title: 'Chapter 1', content: chapterOne }),
          expect.objectContaining({ title: 'Chapter 2', content: chapterTwo }),
        ],
      })
    } finally {
      await database.close()
    }
  })

  it('does not fall back to JSON novel metadata when Postgres is configured without ObjectStorage', async () => {
    const { database, store } = await createSeededDatabase()
    const repository = new NovelRepository(store, database)
    try {
      await store.mutate((state) => {
        state.novelDocuments.push({
          id: 'json-only-novel',
          projectId: 'project-midnight-film',
          tenantId: 'tenant-seqora-demo',
          name: 'JSON Only Novel',
          format: 'txt',
          characterCount: 12,
          chapterCount: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
      })

      await expect(repository.list('project-midnight-film', principal)).resolves.toEqual([])
      await expect(
        repository.importNovel(
          'project-midnight-film',
          {
            clientRequestId: 'missing-object-storage',
            name: 'Missing Storage Novel',
            format: 'txt',
            content: 'Chapter 1\nContent that should not be written to JSON.',
          },
          [
            {
              order: 1,
              title: 'Chapter 1',
              startOffset: 0,
              endOffset: 53,
              sourceStartOffset: 0,
              sourceEndOffset: 53,
              sourceChapterTitle: 'Chapter 1',
              splitMode: 'heading',
              overlapBeforeChars: 0,
              overlapAfterChars: 0,
              crossesChapterBoundary: false,
              characterCount: 53,
              preview: 'Chapter 1\nContent that should not be written to JSON.',
              content: 'Chapter 1\nContent that should not be written to JSON.',
            },
          ],
          principal,
        ),
      ).rejects.toThrow('Novel ObjectStorage is required when Postgres is configured')

      const persisted = await database.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM novel_documents WHERE client_request_id = 'missing-object-storage'",
      )
      expect(persisted.rows[0]).toEqual({ count: '0' })
      expect(store.read((state) => state.novelDocuments.map((document) => document.id))).toEqual([
        'json-only-novel',
      ])
    } finally {
      await database.close()
    }
  })
})

async function createSeededDatabase(): Promise<{ database: AccountDatabase; store: AppStore }> {
  if (!postgres) throw new Error('Postgres fixture is not ready')
  const store = new AppStore(null)
  await store.initialize()
  const database = new AccountDatabase(postgres.connectionString)
  const users = new UserRepository(store, database)
  await users.bootstrapFromStore()
  const projects = new ProjectRepository(store, database)
  await projects.importFromStore()
  return { database, store }
}
