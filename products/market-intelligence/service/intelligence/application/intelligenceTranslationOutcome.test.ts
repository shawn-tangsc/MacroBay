import { describe, expect, it } from 'vitest'

import { createTranslationBatchTally, translationAutoOffConclusion } from './intelligenceTranslationOutcome'

/**
 * 一批翻译的结论：四计数 + 失败分布。
 *
 * 这些用例钉的是**平台校验看不见的那一半**：`reasons` 不传是合法的，所以「算完分布又丢掉」
 * 可以一直绿。只有在这里断言「两条不同原因 → 分布逐项相等」，那一刀才被钉住。
 */
describe('translation batch conclusion', () => {
  it('carries the failure distribution, not just the dominating code', () => {
    const tally = createTranslationBatchTally()
    tally.recordFailure('timeout')
    tally.recordFailure('rate-limited')

    const conclusion = tally.settle()

    expect(conclusion.counts).toEqual({ total: 2, succeeded: 0, failed: 2, skipped: 0 })
    // 逐项相等：只写「有 reasons」的话，一条错误的合并（比如都算成 other）也能过。
    expect(conclusion.reasons).toEqual({ 'model.timeout': 1, 'model.rate-limited': 1 })
    // 主因码必须是分布里的键——平台对这条是硬拒收。
    expect(conclusion.reasonCode).toBeDefined()
    expect(Object.keys(conclusion.reasons ?? {})).toContain(conclusion.reasonCode)
  })

  it('keeps the four counts adding up across all three endings', () => {
    const tally = createTranslationBatchTally()
    tally.recordSuccess()
    tally.recordSuccess()
    tally.recordSkipped()
    tally.recordFailure('invalid-json')

    const { counts, reasons } = tally.settle()

    expect(counts).toEqual({ total: 4, succeeded: 2, failed: 1, skipped: 1 })
    // 平台写入前会校验这条；这里先自己钉一次，红了能立刻看出是哪一侧算错。
    expect(counts.succeeded + counts.failed + counts.skipped).toBe(counts.total)
    expect(Object.values(reasons ?? {}).reduce((sum, count) => sum + count, 0)).toBe(counts.failed)
  })

  it('says nothing about reasons when nothing failed', () => {
    const tally = createTranslationBatchTally()
    tally.recordSuccess()
    tally.recordSkipped()

    const conclusion = tally.settle()

    // 全零映射会被读成「测过、没有原因」，所以这个键根本不出现。
    expect('reasons' in conclusion).toBe(false)
    expect('reasonCode' in conclusion).toBe(false)
    expect(conclusion.counts).toEqual({ total: 2, succeeded: 1, failed: 0, skipped: 1 })
  })

  it('counts an auto-off batch as skipped, never as zero successes', () => {
    const conclusion = translationAutoOffConclusion(3)

    expect(conclusion?.counts).toEqual({ total: 3, succeeded: 0, failed: 0, skipped: 3 })
    expect(conclusion?.reasonCode).toBe('translation.auto-off')
    expect(conclusion === undefined ? undefined : 'reasons' in conclusion).toBe(false)
    // 不知道这一批有几条时不编数：宁可这一行没有计数。
    expect(translationAutoOffConclusion(0)).toBeUndefined()
  })
})
