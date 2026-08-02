import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '../..')
const reportDir = resolve(root, 'tmp/dependency-check')
const image = process.env.DEPENDENCY_CHECK_IMAGE || 'owasp/dependency-check:latest'

mkdirSync(reportDir, { recursive: true })

const result = spawnSync(
  'docker',
  [
    'run',
    '--rm',
    '-v',
    `${root}:/src`,
    '-v',
    `${reportDir}:/report`,
    image,
    '--scan',
    '/src',
    '--out',
    '/report',
    '--format',
    'HTML',
    '--format',
    'JSON',
    '--project',
    'Seqora',
    '--failOnCVSS',
    '7',
    '--enableExperimental',
  ],
  { stdio: 'inherit' },
)

process.exit(result.status ?? 1)
