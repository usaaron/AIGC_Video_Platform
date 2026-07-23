import { randomBytes, scryptSync } from 'node:crypto'
import { readFile, rename, writeFile } from 'node:fs/promises'

const KEY_LENGTH = 64

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, KEY_LENGTH).toString('hex')
  return `${salt}:${hash}`
}

function parseEnv(source) {
  return Object.fromEntries(
    source
      .split(/\r?\n/)
      .filter((line) => /^[A-Z0-9_]+=/.test(line))
      .map((line) => {
        const separator = line.indexOf('=')
        return [line.slice(0, separator), line.slice(separator + 1)]
      }),
  )
}

function required(values, key) {
  const value = values[key]
  if (!value) throw new Error(`${key} is required`)
  return value
}

async function generate(envPath, outputPath) {
  const values = parseEnv(await readFile(envPath, 'utf8'))
  const patch = {
    users: [
      {
        id: 'user-creator',
        email: required(values, 'BOOTSTRAP_CREATOR_EMAIL').toLowerCase(),
        name: required(values, 'BOOTSTRAP_CREATOR_NAME'),
        passwordHash: hashPassword(required(values, 'BOOTSTRAP_CREATOR_PASSWORD')),
      },
      {
        id: 'user-admin',
        email: required(values, 'BOOTSTRAP_ADMIN_EMAIL').toLowerCase(),
        name: required(values, 'BOOTSTRAP_ADMIN_NAME'),
        passwordHash: hashPassword(required(values, 'BOOTSTRAP_ADMIN_PASSWORD')),
      },
    ],
  }
  await writeFile(outputPath, `${JSON.stringify(patch, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  return patch.users.length
}

async function apply(patchPath, statePath) {
  const [patch, state] = await Promise.all([
    readFile(patchPath, 'utf8').then(JSON.parse),
    readFile(statePath, 'utf8').then(JSON.parse),
  ])
  for (const update of patch.users) {
    const user = state.users.find((candidate) => candidate.id === update.id)
    if (!user) throw new Error(`Missing user ${update.id}`)
    Object.assign(user, update)
  }
  const temporaryPath = `${statePath}.credentials.tmp`
  await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  await rename(temporaryPath, statePath)
  return patch.users.length
}

const [mode, firstPath, secondPath] = process.argv.slice(2)
let updated
if (mode === 'generate') {
  updated = await generate(firstPath, secondPath)
} else if (mode === 'apply') {
  updated = await apply(firstPath, secondPath)
} else {
  throw new Error('Usage: credential-patch.mjs <generate ENV OUTPUT | apply PATCH STATE>')
}
console.log(JSON.stringify({ mode, updated }))
