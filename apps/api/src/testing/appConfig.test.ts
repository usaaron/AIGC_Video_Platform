import { describe, expect, it } from 'vitest'
import { testConfig } from './appConfig.js'

describe('in-memory API test configuration', () => {
  it('keeps default database and Redis services out of the legacy API fixture', () => {
    expect(testConfig).toMatchObject({
      NODE_ENV: 'test',
      DATA_FILE: ':memory:',
      DATABASE_URL: '',
      REDIS_URL: '',
      TASK_QUEUE_DRIVER: 'inline',
    })
  })
})
