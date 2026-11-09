#!/usr/bin/env tsx
/**
 * 测试预算门禁（`check:test-budget`，用户 2026-11-08 批，进 0.4.2）。
 *
 * 三条上限，只对 `functional` 池：全量 **≤6 分钟**、单文件 **≤15 秒**、单条 **≤2 秒**。
 * 测量型用例（`tools/test-setup/measurementTests.ts`）不在这个口径里——它们串行跑、自带显式超时，
 * 量的是资源足迹而不是功能，和功能用例挤一个尺子会互相伤害。
 *
 * **为什么读 JSON 报告、不看墙钟**：这一跑的外层墙钟混着 `pnpm` 启动、生成器、进程拉起，
 * 一次抖动就能让门禁红；而 vitest 的 JSON 报告里每条用例自带 `duration`。脚本只做「取数 → 合计 → 比」，
 * 同一个输入永远得到同一个结果，所以它自己不会 flaky。
 *
 * **棘轮只降不升**：基线是**当时实际值**，不是目标值。超基线 → 红；基线外出现新的超目标项 → 红。
 * 低于基线只提示「可以下调」，由人决定何时把数字收紧——脚本不自动改基线，否则一次负载波动就把闸门抬走。
 *
 * **初值未定不产生红**：`status: "pending"` 时只打印一行提示并退出 0。这一点必须显式：
 * 一出生就红的门禁，最后只会被放宽或者被绕过。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { MEASUREMENT_TESTS } from '../tools/test-setup/measurementTests'

/** 三条上限（毫秒）。改数字就是改口径，必须回用户拍板，不许为了让树绿而放宽。 */
export const TEST_BUDGET_TARGETS = Object.freeze({ totalMs: 6 * 60_000, fileMs: 15_000, testMs: 2_000 })

/**
 * 比较时的容差：同一提交在不同负载下，合计与单条都会浮动几个百分点。
 *
 * 没有容差的棘轮第一天就会红：这不是「基线不准」，是机器本来就抖。容差**只用于比较**，
 * 写进基线的一律是实测值——所以容差不构成把闸门往上抬。
 */
export type BudgetTolerance = Readonly<{ ratio: number; floorMs: number }>

export const DEFAULT_TOLERANCE: BudgetTolerance = Object.freeze({ ratio: 1.1, floorMs: 200 })

export type TestBudgetTargets = Readonly<{ totalMs: number; fileMs: number; testMs: number }>

export type TestBudgetBaseline = Readonly<{
  version: 1
  status: 'pending' | 'active'
  targets: TestBudgetTargets
  tolerance: BudgetTolerance
  /** 全量合计（`functional` 池）。`pending` 时为 `null`。 */
  totalMs: number | null
  /** 只有**当时就超目标**的文件才进这张表：文件路径 → 实测毫秒。 */
  files: Readonly<Record<string, number>>
  /** 只有当时就超目标的用例：`<文件路径>::<用例全名>` → 实测毫秒。 */
  tests: Readonly<Record<string, number>>
}>

export type BudgetMeasurement = Readonly<{
  totalMs: number
  files: Readonly<Record<string, number>>
  tests: Readonly<Record<string, number>>
  fileCount: number
  testCount: number
  /** 串行池合计：只报不判（它们的上限写在各自的用例里）。 */
  measurementPoolMs: number
  measurementPoolFileCount: number
}>

export type BudgetVerdict =
  | Readonly<{ status: 'pending' }>
  | Readonly<{ status: 'ok'; hints: readonly string[] }>
  | Readonly<{ status: 'fail'; failures: readonly string[]; hints: readonly string[] }>

type VitestAssertion = Readonly<{ fullName?: string; title?: string; duration?: number | null }>
type VitestFile = Readonly<{ name: string; assertionResults?: readonly VitestAssertion[] }>
type VitestReport = Readonly<{ testResults?: readonly VitestFile[] }>

const isMeasurementFile = (name: string): boolean =>
  MEASUREMENT_TESTS.some((suffix) => name.replace(/\\/gu, '/').endsWith(`/${suffix}`) || name === suffix)

/**
 * 报告 → 测量值。**只加 `duration`，不看 `startTime`/`endTime`**：后两者包含模块加载与等待，
 * 与并发度强相关；`duration` 是用例自己的执行时间，才是「这条用例有多贵」。
 */
export function measureVitestReport(report: unknown): BudgetMeasurement {
  const raw = (report as VitestReport | null)?.testResults
  if (!Array.isArray(raw)) throw new Error('test-budget: 报告里没有 testResults（不是 vitest JSON 报告？）')
  // `Array.isArray` 会把元素类型收成 `any`，这里显式收回来：报告是外部输入，只有这一处收窄。
  const results: readonly VitestFile[] = raw
  const files: Record<string, number> = {}
  const tests: Record<string, number> = {}
  let totalMs = 0
  let measurementPoolMs = 0
  let fileCount = 0
  let testCount = 0
  let measurementPoolFileCount = 0
  for (const file of results) {
    const fileMs = (file.assertionResults ?? []).reduce((sum: number, one) => sum + (one.duration ?? 0), 0)
    if (isMeasurementFile(file.name)) {
      measurementPoolMs += fileMs
      measurementPoolFileCount += 1
      continue
    }
    fileCount += 1
    totalMs += fileMs
    if (fileMs > TEST_BUDGET_TARGETS.fileMs) files[relativeFile(file.name)] = round(fileMs)
    for (const one of file.assertionResults ?? []) {
      testCount += 1
      const ms = one.duration ?? 0
      if (ms <= TEST_BUDGET_TARGETS.testMs) continue
      tests[`${relativeFile(file.name)}::${one.fullName ?? one.title ?? '(unnamed)'}`] = round(ms)
    }
  }
  return { totalMs: round(totalMs), files, tests, fileCount, testCount, measurementPoolMs: round(measurementPoolMs), measurementPoolFileCount }
}

/** 报告里是绝对路径；基线里只存仓库相对路径，换机器/换目录不会整表失效。 */
function relativeFile(name: string): string {
  const normalized = name.replace(/\\/gu, '/')
  const marker = '/MacroBay/'
  const at = normalized.lastIndexOf(marker)
  if (at !== -1) return normalized.slice(at + marker.length)
  const cwd = `${process.cwd().replace(/\\/gu, '/')}/`
  return normalized.startsWith(cwd) ? normalized.slice(cwd.length) : normalized
}

function round(ms: number): number {
  return Math.round(ms)
}

const exceeds = (current: number, limit: number, tolerance: BudgetTolerance): boolean =>
  current > limit * tolerance.ratio + tolerance.floorMs

/** 题目里的目标本身（不是基线）：新出现的超目标项按这条判。 */
export function compareTestBudget(
  measurement: BudgetMeasurement,
  baseline: TestBudgetBaseline
): BudgetVerdict {
  if (baseline.status !== 'active' || baseline.totalMs === null) return { status: 'pending' }
  const failures: string[] = []
  const hints: string[] = []
  const { tolerance } = baseline

  const totalLimit = Math.min(baseline.totalMs, baseline.targets.totalMs)
  if (exceeds(measurement.totalMs, totalLimit, tolerance)) {
    failures.push(`全量 ${seconds(measurement.totalMs)} > 基线 ${seconds(baseline.totalMs)}（上限 ${seconds(baseline.targets.totalMs)}）`)
  } else if (measurement.totalMs < baseline.totalMs * 0.9) {
    hints.push(`全量降到 ${seconds(measurement.totalMs)}，可以把基线从 ${seconds(baseline.totalMs)} 收紧`)
  }

  for (const [file, ms] of Object.entries(measurement.files)) {
    const known = baseline.files[file]
    if (known === undefined) {
      failures.push(`新的超目标文件 ${file}：${seconds(ms)} > ${seconds(baseline.targets.fileMs)}`)
      continue
    }
    if (exceeds(ms, known, tolerance)) failures.push(`文件变慢 ${file}：${seconds(ms)} > 基线 ${seconds(known)}`)
  }
  for (const [test, ms] of Object.entries(measurement.tests)) {
    const known = baseline.tests[test]
    if (known === undefined) {
      failures.push(`新的超目标用例 ${test}：${seconds(ms)} > ${seconds(baseline.targets.testMs)}`)
      continue
    }
    if (exceeds(ms, known, tolerance)) failures.push(`用例变慢 ${test}：${seconds(ms)} > 基线 ${seconds(known)}`)
  }

  for (const [file, known] of Object.entries(baseline.files)) {
    const now = measurement.files[file]
    if (now === undefined) hints.push(`${file} 已经不超目标，可以从基线里删掉`)
    else if (now < known) hints.push(`${file} 从 ${seconds(known)} 降到 ${seconds(now)}，可以收紧基线`)
  }
  for (const [test, known] of Object.entries(baseline.tests)) {
    const now = measurement.tests[test]
    if (now === undefined) hints.push(`${test} 已经不超目标，可以从基线里删掉`)
    else if (now < known) hints.push(`${test} 从 ${seconds(known)} 降到 ${seconds(now)}，可以收紧基线`)
  }

  return failures.length > 0 ? { status: 'fail', failures, hints } : { status: 'ok', hints }
}

/** 从一次**干净**测量生成基线：只收当时就超目标的项，其余留空。 */
export function baselineFromMeasurement(
  measurement: BudgetMeasurement,
  targets: TestBudgetTargets = TEST_BUDGET_TARGETS,
  tolerance: BudgetTolerance = DEFAULT_TOLERANCE
): TestBudgetBaseline {
  return {
    version: 1,
    status: 'active',
    targets,
    tolerance,
    totalMs: measurement.totalMs,
    files: { ...measurement.files },
    tests: { ...measurement.tests }
  }
}

export function readBaseline(path: string): TestBudgetBaseline {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as TestBudgetBaseline
  if (parsed.version !== 1) throw new Error(`test-budget: 基线版本不认识：${String(parsed.version)}`)
  if (parsed.status !== 'pending' && parsed.status !== 'active') throw new Error('test-budget: 基线缺 status')
  return parsed
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`
}

function main(argv: readonly string[]): void {
  const flag = (name: string, fallback: string): string => {
    const at = argv.indexOf(name)
    return at === -1 ? fallback : (argv[at + 1] ?? fallback)
  }
  const reportPath = resolve(flag('--report', '.vitest-report.json'))
  const baselinePath = resolve(flag('--baseline', 'scripts/test-budget-baseline.json'))
  const write = argv.includes('--write')

  const measurement = measureVitestReport(JSON.parse(readFileSync(reportPath, 'utf8')))

  if (write) {
    const baseline = baselineFromMeasurement(measurement)
    writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`)
    console.log(
      `test-budget: 基线已写入 ${baselinePath}（全量 ${seconds(measurement.totalMs)}，` +
        `超目标文件 ${Object.keys(measurement.files).length}，超目标用例 ${Object.keys(measurement.tests).length}）`
    )
    return
  }

  const verdict = compareTestBudget(measurement, readBaseline(baselinePath))
  if (verdict.status === 'pending') {
    console.log('test-budget: 基线未定（pending），这一轮不做比较。初值落地后自动生效。')
    return
  }
  for (const hint of verdict.hints) console.log(`test-budget: 提示：${hint}`)
  if (verdict.status === 'ok') {
    console.log(
      `test-budget: 通过（全量 ${seconds(measurement.totalMs)}，${measurement.fileCount} 文件 / ${measurement.testCount} 例；` +
        `串行池 ${seconds(measurement.measurementPoolMs)} 不计入）`
    )
    return
  }
  console.error('测试预算门禁未通过（超基线或出现新的超目标项）：')
  for (const failure of verdict.failures) console.error(`  - ${failure}`)
  console.error('\n处理：先划 slow lane（说明它凭什么是例外），再拆分或改写法；**不许放宽数字**。')
  process.exitCode = 1
}

if (process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].split('/').pop() ?? '')) {
  main(process.argv.slice(2))
}
