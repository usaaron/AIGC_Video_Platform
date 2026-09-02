import { readFile, readdir, writeFile } from 'node:fs/promises'
import { extname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const baselinePath = join(root, 'scripts/architecture-size-baseline.json')
const baseline = JSON.parse(await readFile(baselinePath, 'utf8'))
const sourceExtensions = new Set(['.js', '.jsx', '.mjs', '.ts', '.tsx'])
const sourceRoots = ['apps', 'packages']
const failures = []
const sourceInventory = []

const unknownArguments = process.argv.slice(2).filter((argument) => argument !== '--write-baseline')
if (unknownArguments.length) {
  console.error(`Unknown argument(s): ${unknownArguments.join(', ')}`)
  process.exit(2)
}

for (const sourceRoot of sourceRoots) {
  for (const file of await sourceFiles(join(root, sourceRoot))) {
    const projectPath = relative(root, file).split(sep).join('/')
    const source = await readFile(file, 'utf8')
    const lineCount = countLines(source)
    const isTest = /\.(?:test|spec)\.[^.]+$/.test(projectPath)
    const defaultLimit = isTest ? 1_500 : 1_000
    const allowedLines = baseline[projectPath] ?? defaultLimit
    sourceInventory.push({ projectPath, lineCount, defaultLimit })

    if (lineCount > allowedLines) {
      failures.push(`${projectPath}: ${lineCount} lines exceeds ${allowedLines}`)
    } else if (projectPath in baseline && lineCount < allowedLines) {
      failures.push(
        lineCount > defaultLimit
          ? `${projectPath}: lower its size baseline from ${allowedLines} to ${lineCount}`
          : `${projectPath}: remove its obsolete size-baseline entry`,
      )
    }

    if (projectPath.startsWith('apps/web/src/') || projectPath.startsWith('apps/admin/src/')) {
      assertNoFrontendSecrets(projectPath, source)
    }
  }
}

for (const [projectPath] of Object.entries(baseline)) {
  try {
    await readFile(join(root, projectPath))
  } catch {
    failures.push(`${projectPath}: remove its obsolete size-baseline entry`)
  }
}

if (process.argv.includes('--write-baseline')) {
  const nextBaseline = Object.fromEntries(
    sourceInventory
      .filter(({ lineCount, defaultLimit }) => lineCount > defaultLimit)
      .sort(({ projectPath: left }, { projectPath: right }) => left.localeCompare(right))
      .map(({ projectPath, lineCount }) => [projectPath, lineCount]),
  )
  await writeFile(baselinePath, `${JSON.stringify(nextBaseline, null, 2)}\n`)
  console.log(`Wrote ${Object.keys(nextBaseline).length} legacy size exceptions.`)
  process.exit(0)
}

if (failures.length) {
  console.error('Architecture checks failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(`Architecture checks passed (${Object.keys(baseline).length} legacy size exceptions).`)

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'coverage') continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await sourceFiles(path)))
    else if (sourceExtensions.has(extname(entry.name))) files.push(path)
  }
  return files
}

function countLines(source) {
  if (!source) return 0
  return source.split(/\r?\n/).length - (source.endsWith('\n') ? 1 : 0)
}

function assertNoFrontendSecrets(projectPath, source) {
  const forbiddenPatterns = [
    /\b(?:DASHSCOPE|TOKENADVENT|REHDASU|STRINGX|DEEPSEEK|OPENAI)[A-Z0-9_]*(?:KEY|SECRET)\b/i,
    /\bVITE_[A-Z0-9_]*(?:KEY|SECRET)\b/i,
    /https?:\/\/[^\s'"`]*(?:openrouter|shanyoucloud|maas\.aliyuncs)[^\s'"`]*/i,
  ]
  for (const pattern of forbiddenPatterns) {
    if (pattern.test(source)) failures.push(`${projectPath}: frontend contains a Provider secret or endpoint`)
  }
}
