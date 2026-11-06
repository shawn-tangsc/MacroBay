import { describe, expect, it } from 'vitest'

import { moduleSignalPolicy, type ModuleSignal, type SignalWindow } from '../../../contracts/moduleSignal'
import type { SignalWithWindow } from '../../../contracts/moduleSignalEvidence'
import { planSignalScan } from './signalScan'

const asOf = '2026-11-06T10:30:00.000Z'
const window: SignalWindow = { unit: 'buckets', amount: 1, bucketMs: 15 * 60_000, upperBoundMs: 15 * 60_000 }

function entry(overrides: Partial<ModuleSignal> = {}, signalWindow: SignalWindow = window): SignalWithWindow {
  return {
    signal: {
      version: '1', moduleId: 'open-interest', ruleId: 'oi-liquidation-proxy', asset: 'btc', severity: 'high',
      observedAt: '2026-11-06T10:15:00.000Z', cadence: { kind: 'intraday', bucketMs: 15 * 60_000 }, values: {},
      dedupeKey: 'oi|btc|10:15', readiness: 'available', triggerOwner: 'module-signal', ...overrides
    },
    window: signalWindow
  }
}

describe('signal scan planning', () => {
  it('turns one module’s signals into one batch on that module’s board', () => {
    const plan = planSignalScan([entry(), entry({ asset: 'eth', severity: 'medium' })])
    expect(plan.scanned).toBe(2)
    expect(plan.eligible).toBe(2)
    expect(plan.batches).toHaveLength(1)
    expect(plan.batches[0]).toMatchObject({ moduleId: 'open-interest', groupType: 'funding' })
    expect(plan.batches[0]!.signals).toHaveLength(2)
  })

  it('keeps modules apart, each with its own board', () => {
    const plan = planSignalScan([
      entry(),
      entry({ moduleId: 'etf-flows', ruleId: 'etf-outflow-3d', cadence: { kind: 'trading-day' } }, { unit: 'trading-days', amount: 3, upperBoundMs: null }),
      entry({ moduleId: 'macro-calendar', ruleId: 'calendar-surprise', cadence: { kind: 'trading-day' }, triggerOwner: 'calendar.refresh' })
    ])
    expect(plan.batches.map(batch => [batch.moduleId, batch.groupType])).toEqual([['open-interest', 'funding'], ['etf-flows', 'capital']])
  })

  it('never queues a low mark, an unreadable reading, or a signal another key owns', () => {
    const plan = planSignalScan([
      entry({ severity: 'low' }),
      entry({ readiness: 'unavailable' }),
      entry({ triggerOwner: 'calendar.refresh' })
    ])
    expect(plan.eligible).toBe(0)
    expect(plan.skipped).toEqual({ low: 1, unreadable: 1, ownedElsewhere: 1 })
  })

  it('gives every module in the closed set a board, so none can fall out of the scan', () => {
    // The compile-time half is `satisfies Record<ModuleSignalModuleId, EventGroupType>`: a new module
    // without a board stops `typecheck`. This asserts the two lists are the same list, which is what
    // makes the lookup total rather than "probably found".
    const boards: Record<string, string> = { ...moduleSignalPolicy.moduleBoards }
    expect(Object.keys(boards).sort()).toEqual([...moduleSignalPolicy.modules].sort())
  })
})
