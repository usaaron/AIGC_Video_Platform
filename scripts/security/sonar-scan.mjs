import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '../..')
const token = process.env.SONAR_TOKEN?.trim()
const host = process.env.SONAR_HOST_URL?.trim() || 'http://127.0.0.1:9000'
const image = process.env.SONAR_SCANNER_IMAGE || 'sonarsource/sonar-scanner-cli:5'

if (!token) {
  console.error('SONAR_TOKEN is required.')
  process.exit(1)
}

const result = spawnSync(
  'docker',
  [
    'run',
    '--rm',
    '-e',
    `SONAR_HOST_URL=${host}`,
    '-e',
    `SONAR_TOKEN=${token}`,
    '-v',
    `${root}:/usr/src`,
    image,
  ],
  { stdio: 'inherit' },
)

process.exit(result.status ?? 1)
