import { describe, expect, it } from 'vitest'

import { assembleSignalAnalysisRead } from './signalAnalysisRead'

const window = { unit: 'buckets' as const, amount: 1, bucketMs: 15 * 60_000, upperBoundMs: 15 * 60_000 }
const entry = (hash: string, overrides: Record<string, unknown> = {}) => ({
  signal: {
    version: '1', moduleId: 'open-interest' as const, ruleId: 'oi-liquidation-proxy', asset: 'btc' as const,
    severity: 'high' as const, observedAt: '2026-11-06T10:15:00.000Z', cadence: { kind: 'intraday' as const, bucketMs: 15 * 60_000 },
    values: {}, dedupeKey: hash, readiness: 'available' as const, triggerOwner: 'module-signal', ...overrides
  },
  window
})

describe('the signal analysis read', () => {
  it('keeps the states beside the signals, one per change hash', () => {
    const read = assembleSignalAnalysisRead({
      signals: [entry('h-1'), entry('h-2')],
      droppedInvalid: 0,
      store: {
        listLatestSignalLedgerStates: () => [{ changeHash: 'h-1', decision: 'queued', reasonCode: 'signal-high-triggered', analysisRunId: 'run-1' }],
        getRunsByIds: ids => Object.fromEntries(ids.filter(id => id === 'run-1').map(id => [id, { status: 'succeeded', failureCode: null }]))
      }
    })
    if (read.state !== 'available') throw new Error('expected a readable answer')
    expect(Object.keys(read.analysis).sort()).toEqual(['h-1', 'h-2'])
    expect(read.analysis['h-1']).toMatchObject({ analysisState: 'published' })
    // 没有账本行的那条是「还没轮到」，不是整批报错。
    expect(read.analysis['h-2']).toMatchObject({ analysisState: 'not-triggered' })
  })

  it('does not invent a run for a row that has none', () => {
    const read = assembleSignalAnalysisRead({
      signals: [entry('h-1')],
      droppedInvalid: 0,
      store: {
        listLatestSignalLedgerStates: () => [{ changeHash: 'h-1', decision: 'queued', reasonCode: 'signal-high-triggered', analysisRunId: null }],
        getRunsByIds: () => ({})
      }
    })
    if (read.state !== 'available') throw new Error('expected a readable answer')
    expect(read.analysis['h-1']).toMatchObject({ analysisState: 'queued' })
  })
})
