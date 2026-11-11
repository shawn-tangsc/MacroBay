import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { IntelligenceDataChangedPayload } from '../../../contracts/intelligenceDataChangedEvent'
import type { JobRunRecord } from '@platform/jobs'
import { createIntelligenceDataChangedEmitter } from './intelligenceDataChangedEmitter'

/**
 * `intelligence.dataChanged` 的发射条件与去抖。
 *
 * 发射条件**只看运行记录**：`result.counts.succeeded > 0` 才发；部分成功也发；`succeeded === 0`
 * 一条都不发。去抖：trailing 2s；连续到达最长 5s 必发一次；未登记的 handler 抛错，不许静默跳过。
 */
const PRODUCT = 'market-intelligence'
const emit = vi.fn<(payload: IntelligenceDataChangedPayload) => void>()

beforeEach(() => {
  emit.mockReset()
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

function run(overrides: Partial<Pick<JobRunRecord, 'productId' | 'handlerId' | 'payload' | 'result'>> = {}) {
  return {
    run: {
      productId: PRODUCT,
      handlerId: 'market-intelligence.collectSource',
      payload: { sourceId: 'coindesk-rss' },
      result: { counts: { total: 1, succeeded: 1, failed: 0, skipped: 0 } },
      ...overrides
    }
  }
}

function emitter() {
  return createIntelligenceDataChangedEmitter({ emit })
}

describe('intelligence.dataChanged 发射器', () => {
  it('emits nothing when nothing succeeded', () => {
    const fire = emitter()
    fire(run({ result: { counts: { total: 2, succeeded: 0, failed: 2, skipped: 0 } } }))
    vi.advanceTimersByTime(10_000)
    expect(emit).not.toHaveBeenCalled()
  })

  it('emits exactly one event with the right panels when something succeeded', () => {
    const fire = emitter()
    fire(run())
    vi.advanceTimersByTime(2_000)
    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit.mock.calls[0]![0]).toEqual({ panels: ['dashboard'], sources: ['coindesk-rss'] })
  })

  it('emits once on partial success too (the database did change)', () => {
    const fire = emitter()
    fire(run({ result: { counts: { total: 3, succeeded: 1, failed: 2, skipped: 0 } } }))
    vi.advanceTimersByTime(2_000)
    expect(emit).toHaveBeenCalledTimes(1)
  })

  it('ignores runs from other products', () => {
    const fire = emitter()
    fire(run({ productId: 'other-product' }))
    vi.advanceTimersByTime(10_000)
    expect(emit).not.toHaveBeenCalled()
  })

  it('merges writes inside the trailing window into one event with a union of sources', () => {
    const fire = emitter()
    fire(run())
    vi.advanceTimersByTime(1_000)
    fire(run({ payload: { sourceId: 'sec-rss' } }))
    expect(emit).not.toHaveBeenCalled()
    // 第二次写入把 trailing 重新推后：从 t=1s 起再等 2s。
    vi.advanceTimersByTime(2_000)
    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit.mock.calls[0]![0]).toEqual({ panels: ['dashboard'], sources: ['coindesk-rss', 'sec-rss'] })
  })

  it('still emits at the 5s ceiling under a continuous stream', () => {
    const fire = emitter()
    fire(run())
    // 每 1 秒来一次写入：trailing 一直被推后，但 5 秒上限必须先发一次。
    for (let at = 1_000; at <= 4_000; at += 1_000) {
      vi.advanceTimersByTime(1_000)
      fire(run())
    }
    vi.advanceTimersByTime(1_000)
    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit.mock.calls[0]![0].panels).toEqual(['dashboard'])
  })

  it('throws for an unregistered handler instead of silently skipping it', () => {
    const fire = emitter()
    expect(() => fire(run({ handlerId: 'market-intelligence.not-registered' }))).toThrow(/Unmapped intelligence job/u)
    expect(emit).not.toHaveBeenCalled()
  })
})
