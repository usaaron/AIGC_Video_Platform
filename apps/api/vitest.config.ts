import { configDefaults, defineConfig } from 'vitest/config'

// Keep one inventory for DB/Redis tests; all other test files are unit tests.
// `test` discovers both projects, so new files cannot silently miss the release gate.
const integration = [
  'src/app.test.ts',
  'src/contracts/httpContract.test.ts',
  'src/security/httpSecurity.test.ts',
  'src/infra/postgres.test.ts',
  'src/scripts/preprodAnonymization.test.ts',
  'src/core/jobs/bullMqQueue.test.ts',
  'src/core/jobs/taskWriteback.db.test.ts',
  'src/modules/*/routes.test.ts',
  'src/modules/aiJobs/repository.test.ts',
  'src/modules/novels/repository.test.ts',
  'src/modules/billing/creditLedger.test.ts',
  'src/modules/billing/paymentRoutes.test.ts',
  'src/modules/library/automaticCatalog.postgres.test.ts',
  'src/modules/scriptMaster/importPostgres.test.ts',
  'src/modules/trustedAssets/faceConfirmation.test.ts',
]

export default defineConfig({
  test: {
    maxWorkers: 1,
    projects: [
      {
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts'],
          exclude: [...configDefaults.exclude, ...integration],
        },
      },
      { test: { name: 'integration', include: integration, testTimeout: 30_000, hookTimeout: 90_000 } },
    ],
  },
})
