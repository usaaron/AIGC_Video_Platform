import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const packageName = process.env.APP_PACKAGE

if (!packageName) {
  throw new Error('APP_PACKAGE is required')
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..')
const appConfig = appConfigFor(packageName)

const child = spawn(process.execPath, [appConfig.command, ...appConfig.args], {
  stdio: 'inherit',
  cwd: appConfig.cwd,
  env: process.env,
})

const shutdown = async (signal) => {
  if (!child.killed) child.kill(signal)
  await onceExit(child)
  process.exit(0)
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))

const exitCode = await onceExit(child)
process.exit(exitCode ?? 0)

function onceExit(childProcess) {
  return new Promise((resolve) => {
    childProcess.on('exit', (code) => resolve(code))
  })
}

function appConfigFor(name) {
  const viteBin = path.join(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js')
  const appsRoot = path.join(repoRoot, 'apps')

  if (name === '@seqora/web') {
    return {
      cwd: path.join(appsRoot, 'web'),
      command: viteBin,
      args: ['--host', '127.0.0.1', '--port', '5173', '--strictPort'],
    }
  }

  if (name === '@seqora/admin') {
    return {
      cwd: path.join(appsRoot, 'admin'),
      command: viteBin,
      args: ['--host', '127.0.0.1', '--port', '5174', '--strictPort'],
    }
  }

  throw new Error(`Unsupported APP_PACKAGE: ${name}`)
}
