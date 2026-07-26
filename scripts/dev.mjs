import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { platform } from 'node:os'

const isWindows = platform() === 'win32'
const pnpmCommand = isWindows ? 'pnpm.cmd' : 'pnpm'
const devDataFile = fileURLToPath(new URL('../apps/api/data/app.json', import.meta.url))
const devUploadDir = fileURLToPath(new URL('../apps/api/data/uploads', import.meta.url))
const children = new Set()
let shuttingDown = false

await runBlocking('build:shared', ['build:shared'])

const tasks = [
  ['web', ['--filter', '@seqora/web', 'dev']],
  ['api', ['--filter', '@seqora/api', 'dev']],
  ['worker', ['--filter', '@seqora/api', 'dev:worker']],
]

for (const [name, args] of tasks) {
  startLongRunning(name, args)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

function runBlocking(name, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(pnpmCommand, args, { stdio: 'inherit', windowsHide: false, shell: isWindows })
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
  const child = spawn(pnpmCommand, args, {
    stdio: 'inherit',
    windowsHide: false,
    shell: isWindows,
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

function devEnvironment(name) {
  if (name !== 'api' && name !== 'worker') return process.env
  return {
    ...process.env,
    DATA_FILE: devDataFile,
    UPLOAD_DIR: devUploadDir,
  }
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
