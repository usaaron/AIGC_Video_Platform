import { cp, mkdir, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = resolve(apiRoot, 'src/infra/migrations')
const target = resolve(apiRoot, 'dist/infra/migrations')

await rm(target, { recursive: true, force: true })
await mkdir(dirname(target), { recursive: true })
await cp(source, target, { recursive: true })
