import { describe, expect, it, vi } from 'vitest'

import type { IntelligencePipeline } from './intelligencePipeline'
import { collectSourcesNow } from './intelligenceSourcesService'

/** The real pipeline's types are wider than a stub; the cast keeps the stub honest about shape. */
type StubPipeline = Pick<IntelligencePipeline, 'collectSource' | 'normalizeRawRecords'>
const asPipeline = (pipeline: StubPipeline): StubPipeline => pipeline

const collect = (outcome: 'collected' | 'unchanged' | 'failed', appended = 0): { queuedJobs: string[]; appended: number; outcome: 'collected' | 'unchanged' | 'failed' } =>
  ({ queuedJobs: [], appended, outcome })

describe('collectSourcesNow', () => {
  it('reports collected only after normalization, so the calendar can already see the rows', async () => {
    const order: string[] = []
    const pipeline = asPipeline({
      collectSource: vi.fn(async () => { order.push('collect'); return collect('collected', 3) }),
      normalizeRawRecords: vi.fn(async () => { order.push('normalize'); return { processedCount: 3, queuedJobs: [], newItemIds: [] } })
    })

    const result = await collectSourcesNow({ pipeline }, { sourceIds: ['macro-calendar-0xrouter-economic-data'], timeoutMs: 5_000 })

    expect(result).toEqual([{ sourceId: 'macro-calendar-0xrouter-economic-data', outcome: 'collected' }])
    // "collected" before normalization would mean "raw rows landed", which is the bug this guards.
    expect(order).toEqual(['collect', 'normalize'])
  })

  it('keeps the four states apart: unchanged, failed and timeout are not the same answer', async () => {
    const pipeline = asPipeline({
      collectSource: vi.fn(async ({ sourceId }: { sourceId: string }) => {
        if (sourceId === 'unchanged') return collect('unchanged')
        if (sourceId === 'failed') return collect('failed')
        // never settles: the budget decides
        return new Promise<never>(() => undefined)
      }),
      normalizeRawRecords: vi.fn(async () => ({ processedCount: 0, queuedJobs: [], newItemIds: [] }))
    })

    const result = await collectSourcesNow({ pipeline }, { sourceIds: ['unchanged', 'failed', 'hang'], timeoutMs: 40 })

    expect(result).toEqual([
      { sourceId: 'unchanged', outcome: 'unchanged' },
      { sourceId: 'failed', outcome: 'failed' },
      { sourceId: 'hang', outcome: 'timeout' }
    ])
    // A timeout must not be reported as a failure: the reader gets a different sentence for each.
    expect(result.some((entry) => entry.outcome === 'timeout')).toBe(true)
  })

  it('shares one deadline across sources instead of waiting once per source', async () => {
    const pipeline = asPipeline({
      collectSource: vi.fn(() => new Promise<never>(() => undefined)),
      normalizeRawRecords: vi.fn(async () => ({ processedCount: 0, queuedJobs: [], newItemIds: [] }))
    })
    const started = Date.now()

    const result = await collectSourcesNow({ pipeline }, { sourceIds: ['a', 'b', 'c'], timeoutMs: 60 })

    expect(result.every((entry) => entry.outcome === 'timeout')).toBe(true)
    // Three sources on one 60ms budget must not take three times that.
    expect(Date.now() - started).toBeLessThan(600)
  })
})
