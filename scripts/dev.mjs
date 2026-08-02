import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { platform } from 'node:os'

const isWindows = platform() === 'win32'
const pnpmCommand = isWindows ? 'pnpm.cmd' : 'pnpm'
const devDataFile = fileURLToPath(new URL('../apps/api/data/app.json', import.meta.url))
const devUploadDir = fileURLToPath(new URL('../apps/api/data/uploads', import.meta.url))
const children = new Set()
let shuttingDown = false

await runBlocking('build:shared', ['build:shared'])
const dockerReady = commandExists('docker') && spawnSync('docker', ['info'], { stdio: 'ignore' }).status === 0
const configuredDatabase = Boolean(process.env.DATABASE_URL?.trim())
const configuredRedis = Boolean(process.env.REDIS_URL?.trim())
const inlineQueue = !dockerReady && !configuredRedis

if (dockerReady) {
  await runBlocking('dev:db', ['dev:db'])
  process.stdout.write('[dev] PostgreSQL + Redis: Docker local mode\n')
} else if (configuredDatabase) {
  process.stdout.write('[dev] PostgreSQL: configured external database\n')
} else {
  process.stdout.write(
    '[dev] Docker not found; using JSON storage + inline queue. Login works, invitation registration requires PostgreSQL.\n',
  )
}

const tasks = [
  ['web', ['--filter', '@seqora/web', 'dev']],
  ['admin', ['--filter', '@seqora/admin', 'dev']],
  ['api', ['--filter', '@seqora/api', 'dev']],
]

if (inlineQueue) {
  process.stdout.write('[dev] Worker: inline queue mode; generation jobs run inside the API process\n')
} else {
  tasks.push(['worker', ['--filter', '@seqora/api', 'dev:worker']])
}

for (const [name, args] of tasks) {
  startLongRunning(name, args)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

function runBlocking(name, args) {
  return new Promise((resolve, reject) => {
    const child = spawnPnpm(args, { stdio: 'inherit', windowsHide: false })
    child.on('error', reject)
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(`${name} exited with ${signal ?? code}`))
    })
  })
}

function startLongRunning(name, args) {
  const child = spawnPnpm(args, {
    stdio: 'inherit',
    windowsHide: false,
    env: devEnvironment(name),
  })
  children.add(child)
  child.on('error', (error) => {
    process.stderr.write(`[${name}] ${error.message}\n`)
    shutdown(1)
  })
  child.on('exit', (code, signal) => {
    children.delete(child)
    if (!shuttingDown) {
      process.stderr.write(`[${name}] exited with ${signal ?? code}\n`)
      shutdown(code === 0 ? 0 : code || 1)
    }
  })
}

function spawnPnpm(args, options) {
  if (!isWindows) return spawn(pnpmCommand, args, options)
  const command = [pnpmCommand, ...args].map(quoteWindowsArgument).join(' ')
  return spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', command], options)
}

function quoteWindowsArgument(value) {
  if (/^[A-Za-z0-9_@./:+-]+$/.test(value)) return value
  return `"${value.replaceAll('"', '\\"')}"`
}

function devEnvironment(name) {
  if (name !== 'api' && name !== 'worker') return process.env
  return {
    ...process.env,
    DATA_FILE: devDataFile,
    UPLOAD_DIR: devUploadDir,
    ...(!dockerReady && !configuredDatabase ? { DATABASE_URL: '' } : {}),
    ...(!dockerReady && !configuredRedis ? { REDIS_URL: '', TASK_QUEUE_DRIVER: 'inline' } : {}),
  }
}

function commandExists(command) {
  const probe = spawnSync(isWindows ? 'where.exe' : 'which', [command], {
    stdio: 'ignore',
    windowsHide: true,
  })
  return probe.status === 0
}

function shutdown(code) {
  if (shuttingDown) return
  shuttingDown = true
  for (const child of children) {
    terminate(child)
  }
  setTimeout(() => process.exit(code), 500).unref()
}

function terminate(child) {
  if (!child.pid) return
  if (isWindows) {
    spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true })
    return
  }
  child.kill('SIGTERM')
}
