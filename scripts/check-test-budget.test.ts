import { describe, expect, it } from 'vitest'

import {
  DEFAULT_TOLERANCE,
  baselineFromMeasurement,
  compareTestBudget,
  measureVitestReport,
  type BudgetMeasurement,
  type TestBudgetBaseline
} from './check-test-budget.mts'

/**
 * 这条门禁自己也要有守卫：它一旦「永远绿」，测试预算就只是台账上的一句话。
 *
 * 三件事必须能红：① 全量高于基线；② 基线外出现新的超目标项；③ 已知超目标项变慢。
 * 另外两件事必须**不**红：低于基线（只提示）与 `pending`（初值未定）。
 */

function report(files: readonly { name: string; tests: readonly [string, number][] }[]): unknown {
  return {
    testResults: files.map((file) => ({
      name: file.name,
      assertionResults: file.tests.map(([fullName, duration]) => ({ fullName, duration, status: 'passed' }))
    }))
  }
}

const FILE = '/repo/MacroBay/apps/desktop-shell/src/renderer/src/shell/app.test.ts'

function activeBaseline(over: Partial<TestBudgetBaseline> = {}): TestBudgetBaseline {
  return {
    version: 1,
    status: 'active',
    targets: { totalMs: 360_000, fileMs: 15_000, testMs: 2_000 },
    tolerance: DEFAULT_TOLERANCE,
    totalMs: 100_000,
    files: {},
    tests: {},
    ...over
  }
}

function measurementOf(over: Partial<BudgetMeasurement> = {}): BudgetMeasurement {
  return {
    totalMs: 90_000,
    files: {},
    tests: {},
    fileCount: 1,
    testCount: 1,
    measurementPoolMs: 0,
    measurementPoolFileCount: 0,
    ...over
  }
}

describe('measureVitestReport', () => {
  it('sums the recorded durations and keeps paths repository-relative', () => {
    const measured = measureVitestReport(report([{ name: FILE, tests: [['a b', 10], ['c d', 5]] }]))
    expect(measured.totalMs).toBe(15)
    expect(measured.testCount).toBe(2)
    expect(Object.keys(measured.files)).toEqual([])
  })

  it('records only entries over target — a full per-test table would be 13k rows of noise', () => {
    const measured = measureVitestReport(report([{
      name: FILE,
      tests: [['fast', 10], ['slow', 2_500]]
    }]))
    expect(measured.tests).toEqual({
      'apps/desktop-shell/src/renderer/src/shell/app.test.ts::slow': 2_500
    })
    // 5ms 量级的抖动不该进表：条目一多，真正的涨跌就被埋了。
    expect(measured.files).toEqual({})
  })

  it('flags a whole file over 15 seconds even when no single case is', () => {
    const measured = measureVitestReport(report([{
      name: FILE,
      tests: Array.from({ length: 8 }, (_, index) => [`case ${index}`, 2_000] as [string, number])
    }]))
    expect(measured.files).toEqual({ 'apps/desktop-shell/src/renderer/src/shell/app.test.ts': 16_000 })
  })

  it('leaves the serial measurement pool out of the functional budget', () => {
    const measured = measureVitestReport(report([
      { name: FILE, tests: [['a', 100]] },
      {
        name: '/repo/MacroBay/products/market-intelligence/service/intelligence/macro-calendar/0xrouter-calendar/marketCalendarStorageReclaim.test.ts',
        tests: [['reclaim', 40_000]]
      }
    ]))
    expect(measured.totalMs).toBe(100)
    expect(measured.measurementPoolMs).toBe(40_000)
    expect(measured.measurementPoolFileCount).toBe(1)
  })
})

describe('compareTestBudget', () => {
  it('fails when the whole suite grows past the baseline', () => {
    const verdict = compareTestBudget(measurementOf({ totalMs: 200_000 }), activeBaseline({ totalMs: 100_000 }))
    expect(verdict.status).toBe('fail')
    if (verdict.status !== 'fail') return
    expect(verdict.failures.join('\n')).toContain('全量')
  })

  it('fails on a new over-target file that the baseline never saw', () => {
    const verdict = compareTestBudget(
      measurementOf({ files: { 'products/x/slow.test.ts': 16_000 } }),
      activeBaseline({ files: {} })
    )
    expect(verdict.status).toBe('fail')
    if (verdict.status !== 'fail') return
    expect(verdict.failures.join('\n')).toContain('新的超目标文件 products/x/slow.test.ts')
  })

  it('fails when a known over-target case gets slower', () => {
    const key = 'products/x/slow.test.ts::the slow one'
    const verdict = compareTestBudget(
      measurementOf({ tests: { [key]: 3_000 } }),
      activeBaseline({ tests: { [key]: 2_100 } })
    )
    expect(verdict.status).toBe('fail')
    if (verdict.status !== 'fail') return
    expect(verdict.failures.join('\n')).toContain('用例变慢')
  })

  it('tolerates a small drift instead of reddening on machine load', () => {
    // 同一提交在两台机器/两次负载下差几个百分点是常态；没有容差的门禁第一天就会被放宽。
    const verdict = compareTestBudget(
      measurementOf({ totalMs: 105_000 }),
      activeBaseline({ totalMs: 100_000 })
    )
    expect(verdict.status).toBe('ok')
  })

  it('reports a drop as a hint, not a failure: the ratchet is tightened by a human', () => {
    const key = 'products/x/slow.test.ts::the slow one'
    const verdict = compareTestBudget(
      measurementOf({ totalMs: 50_000, tests: { [key]: 2_200 } }),
      activeBaseline({ totalMs: 100_000, tests: { [key]: 9_000 } })
    )
    expect(verdict.status).toBe('ok')
    if (verdict.status !== 'ok') return
    expect(verdict.hints.join('\n')).toContain('收紧基线')
  })

  it('is inert while the baseline is pending: a gate born red gets widened or bypassed', () => {
    const baseline = activeBaseline({ status: 'pending', totalMs: null })
    expect(compareTestBudget(measurementOf({ totalMs: 10_000_000 }), baseline)).toEqual({ status: 'pending' })
  })

  it('never lets the baseline exceed the published target', () => {
    // 基线只能是被实测过的「当前值」，但不能比题目给的 6 分钟更宽——否则一次写错就把闸门抬走。
    const verdict = compareTestBudget(
      measurementOf({ totalMs: 400_000 }),
      activeBaseline({ totalMs: 500_000, targets: { totalMs: 360_000, fileMs: 15_000, testMs: 2_000 } })
    )
    expect(verdict.status).toBe('fail')
  })
})

describe('baselineFromMeasurement', () => {
  it('records the measured value and only the entries that were over target', () => {
    const baseline = baselineFromMeasurement(measurementOf({
      totalMs: 123_456,
      files: { 'a.test.ts': 16_000 },
      tests: { 'a.test.ts::slow': 2_500 }
    }))
    expect(baseline).toMatchObject({
      status: 'active',
      totalMs: 123_456,
      files: { 'a.test.ts': 16_000 },
      tests: { 'a.test.ts::slow': 2_500 },
      targets: { totalMs: 360_000, fileMs: 15_000, testMs: 2_000 }
    })
  })
})
