import { describe, expect, it, vi } from 'vitest'

import type { ModuleSignal, SignalWindow } from '../../../contracts/moduleSignal'
import type { SignalWithWindow } from '../../../contracts/moduleSignalEvidence'
import type { SignalAnalysisRequest } from '../jobs/requestSignalAnalysis'
import { createSignalScanRunner } from './signalScanRunner'

const window: SignalWindow = { unit: 'buckets', amount: 1, bucketMs: 15 * 60_000, upperBoundMs: 15 * 60_000 }
const entry = (overrides: Partial<ModuleSignal> = {}): SignalWithWindow => ({
  signal: {
    version: '1', moduleId: 'open-interest', ruleId: 'oi-liquidation-proxy', asset: 'btc', severity: 'high',
    observedAt: '2026-11-06T10:15:00.000Z', cadence: { kind: 'intraday', bucketMs: 15 * 60_000 }, values: {},
    dedupeKey: 'oi|btc|10:15', readiness: 'available', triggerOwner: 'module-signal', ...overrides
  },
  window
})

function harness(entries: readonly SignalWithWindow[]) {
  const requestAnalysis = vi.fn(async (_request: SignalAnalysisRequest) => ({ state: 'queued' as const, groupId: 'g', attemptLedgerId: 'l', jobRunId: 'j' }))
  const log = vi.fn(async () => undefined)
  const run = createSignalScanRunner({
    now: () => '2026-11-06T10:30:00.000Z',
    querySignals: async () => entries,
    requestAnalysis,
    log
  })
  return { run, requestAnalysis, log }
}

describe('signal scan runner', () => {
  it('asks one analysis per module and logs the counts', async () => {
    const { run, requestAnalysis, log } = harness([
      entry(),
      entry({ asset: 'eth', severity: 'medium' }),
      entry({ moduleId: 'etf-flows', ruleId: 'etf-outflow-3d', cadence: { kind: 'trading-day' } })
    ])

    await run()

    expect(requestAnalysis).toHaveBeenCalledTimes(2)
    expect(requestAnalysis.mock.calls[0]![0]).toMatchObject({ groupType: 'funding' })
    expect(requestAnalysis.mock.calls[1]![0]).toMatchObject({ groupType: 'capital' })
    expect(log).toHaveBeenLastCalledWith(expect.objectContaining({
      message: 'Market analysis signal scan',
      metadata: expect.objectContaining({ scanned: 3, eligible: 3, queued: 2 })
    }))
  })

  it('reports a dead read instead of looking like a quiet market', async () => {
    const log = vi.fn(async () => undefined)
    const run = createSignalScanRunner({
      now: () => '2026-11-06T10:30:00.000Z',
      querySignals: async () => { throw new Error('store down') },
      requestAnalysis: vi.fn(),
      log
    })

    await run()

    expect(log).toHaveBeenCalledWith(expect.objectContaining({
      level: 'warn', message: 'Market analysis signal scan: query failed'
    }))
  })

  it('keeps going when one batch fails, and does not count it as queued', async () => {
    const requestAnalysis = vi.fn()
      .mockRejectedValueOnce(new Error('job runtime down'))
      .mockResolvedValueOnce({ state: 'queued', groupId: 'g', attemptLedgerId: 'l', jobRunId: 'j' })
    const log = vi.fn(async () => undefined)
    const run = createSignalScanRunner({
      now: () => '2026-11-06T10:30:00.000Z',
      querySignals: async () => [
        entry(),
        entry({ moduleId: 'etf-flows', ruleId: 'etf-outflow-3d', cadence: { kind: 'trading-day' } })
      ],
      requestAnalysis,
      log
    })

    await run()

    expect(requestAnalysis).toHaveBeenCalledTimes(2)
    expect(log).toHaveBeenLastCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ queued: 1, refused: 1 })
    }))
    // The batch that vanished must leave a record: a shorter `queued` count alone is not a record.
    expect(log).toHaveBeenCalledWith(expect.objectContaining({
      level: 'warn',
      message: 'Market analysis signal scan: batch refused',
      metadata: expect.objectContaining({ moduleId: 'open-interest', signalCount: 1 })
    }))
  })
})
