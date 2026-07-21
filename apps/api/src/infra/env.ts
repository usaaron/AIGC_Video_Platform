import { readFileSync } from 'node:fs'

export function withSecretFileOverrides(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const resolved: NodeJS.ProcessEnv = { ...environment }

  for (const [key, value] of Object.entries(environment)) {
    if (!key.endsWith('_FILE') || typeof value !== 'string' || !value.trim()) continue
    const targetKey = key.slice(0, -5)
    if (resolved[targetKey]) continue
    resolved[targetKey] = readSecretFile(value, targetKey)
  }

  return resolved
}

function readSecretFile(path: string, name: string): string {
  try {
    return readFileSync(path, 'utf8').replace(/\r?\n$/, '')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to read ${name}_FILE at ${path}: ${message}`)
  }
}
