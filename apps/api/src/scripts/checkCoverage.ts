/* eslint-disable no-console */
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

type CoverageMetric = 'lines' | 'statements' | 'branches' | 'functions'

type CoverageSummary = {
  total: Record<CoverageMetric, { pct: number }>
}

type CoverageBaseline = {
  version: 1
  maxDropPercent: number
  totals: Record<CoverageMetric, number>
}

const metrics: CoverageMetric[] = ['lines', 'statements', 'branches', 'functions']
const currentDirectory = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(currentDirectory, '../..')
const summaryPath = resolve(process.cwd(), process.env.COVERAGE_SUMMARY_PATH ?? 'coverage/coverage-summary.json')
const baselinePath = resolve(packageRoot, process.env.COVERAGE_BASELINE_PATH ?? 'coverage-baseline.json')

const baseline = await readJson<CoverageBaseline>(baselinePath)
const summary = await readJson<CoverageSummary>(summaryPath)
const maxDropPercent = Number(process.env.COVERAGE_MAX_DROP_PERCENT ?? baseline.maxDropPercent)

if (!Number.isFinite(maxDropPercent) || maxDropPercent < 0) {
  throw new Error(`Invalid COVERAGE_MAX_DROP_PERCENT: ${process.env.COVERAGE_MAX_DROP_PERCENT}`)
}

const failures: string[] = []

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

if (failures.length) {
  console.error('Coverage gate failed:')
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log(`Coverage gate passed: no metric dropped by more than ${formatPct(maxDropPercent)}.`)

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
