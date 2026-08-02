import { spawn } from 'node:child_process'
import { accessSync, constants } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const mode = (process.argv[2] || 'smoke').toLowerCase()
const script = resolve(__dirname, '../k6/backend-load.js')
const k6Bin = process.env.K6_BIN || 'k6'

try {
  accessSync(script, constants.R_OK)
} catch {
  console.error(`Missing k6 script: ${script}`)
  process.exit(1)
}

const child = spawn(k6Bin, ['run', '-e', `K6_MODE=${mode}`, script], {
  stdio: 'inherit',
  env: process.env,
})

child.on('exit', (code) => {
  process.exit(code ?? 1)
})

child.on('error', (error) => {
  console.error(`Failed to launch k6: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
