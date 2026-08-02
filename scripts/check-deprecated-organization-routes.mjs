import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

const sourceRoots = ['apps/web/src', 'apps/admin/src']
const sourceExtensions = new Set(['.js', '.jsx', '.ts', '.tsx'])
const deprecatedRouteFragments = [
  '/workspaces',
  '/tenants',
  '/admin/tenants',
  '/organization-admin-transfer',
  'api.workspaces',
  'api.switchWorkspace',
  'api.updateWorkspace',
  'api.disableWorkspace',
  'api.createTenantUser',
  'workspaces:',
  'switchWorkspace:',
  'updateWorkspace:',
  'disableWorkspace:',
  'createTenantUser:',
]

const violations = []

for (const root of sourceRoots) {
  await scanDirectory(root)
}

if (violations.length) {
  console.error('Deprecated organization compatibility routes are not allowed in frontend code.')
  console.error('Use /organizations/* or /admin/organizations/* instead.\n')
  for (const violation of violations) {
    console.error(`${violation.file}:${violation.line}: ${violation.fragment}`)
    console.error(`  ${violation.text}`)
  }
  process.exit(1)
}

async function scanDirectory(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      await scanDirectory(path)
      continue
    }
    if (!entry.isFile() || !sourceExtensions.has(extension(entry.name))) continue
    await scanFile(path)
  }
}

async function scanFile(path) {
  const content = await readFile(path, 'utf8')
  const lines = content.split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    for (const fragment of deprecatedRouteFragments) {
      if (!line.includes(fragment)) continue
      violations.push({
        file: relative(process.cwd(), path).replaceAll('\\', '/'),
        line: index + 1,
        fragment,
        text: line.trim(),
      })
    }
  }
}

function extension(fileName) {
  const index = fileName.lastIndexOf('.')
  return index >= 0 ? fileName.slice(index) : ''
}
