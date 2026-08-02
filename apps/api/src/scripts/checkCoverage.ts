/* eslint-disable no-console */
import { readFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

type CoverageMetric = 'lines' | 'statements' | 'branches' | 'functions'

type CoverageFileSummary = Record<CoverageMetric, { pct: number }>

type CoverageSummary = {
  total: CoverageFileSummary
  [filePath: string]: CoverageFileSummary
}

type CoverageBaseline = {
  version: 1
  totals: Record<CoverageMetric, number>
}

type CoveragePolicy = {
  version: 1
  overall: {
    maxDropPercent: number
  }
  modules: Array<{
    path: string
    minimums: Partial<Record<CoverageMetric, number>>
  }>
}

const metrics: CoverageMetric[] = ['lines', 'statements', 'branches', 'functions']
const currentDirectory = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(currentDirectory, '../..')
const summaryPath = resolve(
  process.cwd(),
  process.env.COVERAGE_SUMMARY_PATH ?? 'coverage/coverage-summary.json',
)
const baselinePath = resolve(packageRoot, process.env.COVERAGE_BASELINE_PATH ?? 'coverage-baseline.json')
const policyPath = resolve(packageRoot, process.env.COVERAGE_POLICY_PATH ?? 'coverage-policy.json')

const baseline = await readJson<CoverageBaseline>(baselinePath)
const policy = await readJson<CoveragePolicy>(policyPath)
const summary = await readJson<CoverageSummary>(summaryPath)
const maxDropPercent = Number(process.env.COVERAGE_MAX_DROP_PERCENT ?? policy.overall.maxDropPercent)

if (!Number.isFinite(maxDropPercent) || maxDropPercent < 0) {
  throw new Error(`Invalid COVERAGE_MAX_DROP_PERCENT: ${process.env.COVERAGE_MAX_DROP_PERCENT}`)
}

const failures: string[] = []
const summaryByPath = new Map<string, CoverageFileSummary>()

for (const [filePath, fileCoverage] of Object.entries(summary)) {
  if (filePath === 'total') continue
  summaryByPath.set(normalizeCoveragePath(relative(packageRoot, filePath)), fileCoverage)
}

for (const metric of metrics) {
  const baselinePct = baseline.totals[metric]
  const currentPct = summary.total[metric]?.pct
  if (!Number.isFinite(baselinePct) || !Number.isFinite(currentPct)) {
    failures.push(`${metric}: missing coverage metric`)
    continue
  }

  const drop = roundCoverage(baselinePct - currentPct)
  const allowedFloor = roundCoverage(baselinePct - maxDropPercent)
  console.log(
    `${metric}: current ${formatPct(currentPct)} baseline ${formatPct(baselinePct)} allowed >= ${formatPct(
      allowedFloor,
    )}`,
  )
  if (drop > maxDropPercent) {
    failures.push(`${metric}: dropped ${formatPct(drop)} from baseline ${formatPct(baselinePct)}`)
  }
}

for (const module of policy.modules) {
  const normalizedPath = normalizeCoveragePath(module.path)
  const fileCoverage = summaryByPath.get(normalizedPath)
  if (!fileCoverage) {
    failures.push(`core ${normalizedPath}: missing coverage summary entry`)
    continue
  }

  for (const metric of metrics) {
    const minimum = module.minimums[metric]
    if (minimum === undefined) continue

    const currentPct = fileCoverage[metric]?.pct
    if (!Number.isFinite(currentPct)) {
      failures.push(`core ${normalizedPath} ${metric}: missing coverage metric`)
      continue
    }

    console.log(
      `core ${normalizedPath}: ${metric} current ${formatPct(currentPct)} required >= ${formatPct(minimum)}`,
    )
    if (currentPct < minimum) {
      failures.push(
        `core ${normalizedPath} ${metric}: current ${formatPct(currentPct)} below required ${formatPct(minimum)}`,
      )
    }
  }
}

if (failures.length) {
  console.error('Coverage gate failed:')
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log(
  `Coverage gate passed: no metric dropped by more than ${formatPct(maxDropPercent)} and ${policy.modules.length} core files met their floors.`,
)

async function readJson<T>(path: string): Promise<T> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to read ${path}: ${message}`)
  }
}

function formatPct(value: number): string {
  return `${roundCoverage(value).toFixed(2)}%`
}

function roundCoverage(value: number): number {
  return Math.round(value * 100) / 100
}

function normalizeCoveragePath(value: string): string {
  return value.replaceAll('\\', '/')
}
