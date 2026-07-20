import 'dotenv/config'
import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { PostgresStateStore } from '../infra/postgresStore.js'
import { normalizeState, type AppState } from '../infra/store.js'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required')

const file = argumentValue('--file')
if (!file) throw new Error('Usage: pnpm --filter @seqora/api db:import-json -- --file apps/api/data/app.json')

const sourcePath = await existingPath(file)
const state = normalizeState(JSON.parse(await readFile(sourcePath, 'utf8')) as Partial<AppState>)
const store = new PostgresStateStore(databaseUrl)

try {
  await store.initialize()
  await store.replace(state)
} finally {
  await store.close()
}

process.stdout.write(
  [
    'JSON import complete.',
    `users=${state.users.length}`,
    `projects=${state.projects.length}`,
    `assets=${state.assets.length}`,
    `shots=${state.shots.length}`,
    `tasks=${state.tasks.length}`,
    `ledger=${state.ledger.length}`,
    `media=${state.media.length}`,
  ].join(' '),
)
process.stdout.write('\n')

function argumentValue(name: string): string | null {
  const prefix = `${name}=`
  const inline = process.argv.find((value) => value.startsWith(prefix))
  if (inline) return inline.slice(prefix.length)

  const index = process.argv.indexOf(name)
  const value = index >= 0 ? process.argv[index + 1] : undefined
  return value && !value.startsWith('--') ? value : null
}

async function existingPath(file: string): Promise<string> {
  const candidates = [resolve(process.cwd(), file), resolve(process.cwd(), '..', '..', file)]
  for (const candidate of candidates) {
    try {
      const info = await stat(candidate)
      if (info.isFile()) return candidate
    } catch {
      // Try the next candidate.
    }
  }
  throw new Error(`JSON file not found: ${file}`)
}
