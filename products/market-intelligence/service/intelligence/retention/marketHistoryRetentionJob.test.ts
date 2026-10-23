import { describe, expect, it, vi } from 'vitest'

import { barRetentionCutoffs } from './barRetention'
import { createMarketHistoryRetention, MARKET_HISTORY_RETENTION_JOB_ID, registerMarketHistoryRetentionJob } from './marketHistoryRetentionJob'

const atMs = Date.UTC(2026, 9, 15, 12, 0, 0)

/** A store that records what it was asked and what its ledger was told. */
function storeFor(result: Readonly<{ thinned: number; deleted: number; oldestKeptAtMs: number | null }> | Error) {
  const notes = new Map<string, string>()
  return {
    notes,
    retention: vi.fn(() => { if (result instanceof Error) throw result; return result }),
    note: (key: string, value: string) => { notes.set(key, value) }
  }
}

describe('the market history retention pass', () => {
  it('retains both stores against one clock reading and writes each one its own ledger', async () => {
    const macro = storeFor({ thinned: 412, deleted: 96, oldestKeptAtMs: atMs - 30 * 24 * 3_600_000 })
    const crossAsset = storeFor({ thinned: 0, deleted: 0, oldestKeptAtMs: null })
    const summary = await createMarketHistoryRetention({ stores: { macro, crossAsset, analysis: storeFor({ thinned: 0, deleted: 0, oldestKeptAtMs: null }) }, now: () => atMs }).run()

    // Both stores are handed the same edges: a pass that straddled midnight would thin one store against
    // a different instant than the other and the ledger would describe two nights.
    const cutoffs = barRetentionCutoffs(atMs)
    expect(macro.retention).toHaveBeenCalledWith({ atMs, cutoffs })
    expect(crossAsset.retention).toHaveBeenCalledWith({ atMs, cutoffs })
    expect(Object.keys(summary.results)).toEqual(['macro', 'crossAsset', 'analysis'])
    expect(summary.results).toMatchObject({ macro: { thinned: 412, deleted: 96, oldestKeptAtMs: atMs - 30 * 24 * 3_600_000 }, crossAsset: { thinned: 0, deleted: 0, oldestKeptAtMs: null } })
    // What the pass did and where each series now begins: the two facts an audit asks for, per store.
    expect(Object.fromEntries(macro.notes)).toEqual({
      'macro-market.retention.lastRunAtMs': String(atMs), 'macro-market.retention.lastThinned': '412',
      'macro-market.retention.lastDeleted': '96', 'macro-market.retention.oldestKeptAtMs': String(atMs - 30 * 24 * 3_600_000)
    })
    expect(crossAsset.notes.get('cross-asset.retention.oldestKeptAtMs')).toBe('none')
  })

  it('keeps going when one store refuses, and records the refusal as a code', async () => {
    const macro = storeFor(new Error('database is locked'))
    const crossAsset = storeFor({ thinned: 1, deleted: 2, oldestKeptAtMs: atMs - 1000 })
    const onError = vi.fn()
    const summary = await createMarketHistoryRetention({ stores: { macro, crossAsset, analysis: storeFor({ thinned: 0, deleted: 0, oldestKeptAtMs: null }) }, now: () => atMs, onError }).run()

    // A repository that cannot be compacted today must not leave the other one growing forever.
    expect(summary.results.crossAsset).toEqual({ thinned: 1, deleted: 2, oldestKeptAtMs: atMs - 1000 })
    expect(summary.results.macro).toEqual({ state: 'failed', failureCode: 'retention-failed' })
    expect(macro.notes.get('macro-market.retention.lastFailureCode')).toBe('retention-failed')
    // The exception itself never reaches the scheduler; only the code travels.
    expect(onError).toHaveBeenCalledTimes(1)
    expect(String(onError.mock.calls[0]?.[1])).toBe('macro')
  })

  it('registers one daily job and looks at startup as well', () => {
    const registered = new Map<string, unknown>()
    const schedules: unknown[] = []
    const enqueued: unknown[] = []
    registerMarketHistoryRetentionJob({
      registerHandler: (id: string, handler: unknown) => { registered.set(id, handler) },
      setSchedule: (definition: unknown) => { schedules.push(definition) },
      enqueueDefinition: async (definition: unknown) => { enqueued.push(definition); return { id: 'run-1' } }
    } as never, async () => undefined)

    expect([...registered.keys()]).toEqual([MARKET_HISTORY_RETENTION_JOB_ID])
    expect(schedules).toHaveLength(1)
    expect(enqueued).toHaveLength(1)
  })
})
