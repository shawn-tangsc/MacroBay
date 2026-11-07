import { describe, expect, it } from 'vitest'

import type { ModuleSignal } from '../../../contracts/moduleSignal'
import type { ModuleSignalRead } from '../../../contracts/moduleSignalRead'
import { projectModuleSignalChip } from './dashboardOpenInterestModel'

const at = '2026-10-31T14:30:00.000Z'

const signal = (overrides: Partial<ModuleSignal> = {}): ModuleSignal => ({
  version: '1',
  moduleId: 'open-interest',
  ruleId: 'oi-liquidation-proxy',
  asset: 'btc',
  severity: 'medium',
  observedAt: at,
  cadence: { kind: 'intraday', bucketMs: 15 * 60_000 },
  values: { dropPct: -1.8, volumeMultiple: 2.4, notionalUsd: 7.4e9 },
  dedupeKey: 'open-interest:oi-liquidation-proxy:btc:2026-10-31T14:30:00.000Z',
  readiness: 'available',
  triggerOwner: 'module-signal',
  ...overrides
})

/** A successful read carrying these signals; the chip never sees the window. */
const read = (signals: readonly ModuleSignal[]): ModuleSignalRead => ({
  state: 'available',
  signals: signals.map(signal => ({ signal, window: { unit: 'buckets', amount: 1, bucketMs: 15 * 60_000, upperBoundMs: 15 * 60_000 } })),
  droppedInvalid: 0
})

describe('module signal chip', () => {
  it('says the read failed, with the code, instead of drawing nothing', () => {
    // The failure is a different fact from a quiet market, so it gets its own state; the code is
    // kept because retryability is decided from it further down.
    expect(projectModuleSignalChip({ state: 'unavailable', failureCode: 'query-failed' }))
      .toMatchObject({ state: 'unreadable', failureCode: 'query-failed' })
    expect(projectModuleSignalChip({ state: 'unavailable', failureCode: 'invalid-as-of' }))
      .toMatchObject({ state: 'unreadable', failureCode: 'invalid-as-of' })
  })

  it('draws nothing when the rule has nothing to say', () => {
    // The product decision: a normal market shows no chip at all, not an empty container.
    expect(projectModuleSignalChip(read([]))).toEqual({ state: 'hidden' })
    expect(projectModuleSignalChip(undefined)).toEqual({ state: 'hidden' })
  })

  it('shows the reading a fired rule produced, numbers intact', () => {
    expect(projectModuleSignalChip(read([signal()]))).toEqual({
      state: 'alert', asset: 'btc', direction: 'long', dropPct: -1.8, volumeMultiple: 2.4,
      // The internal rule id stays out of the view: the card shows the rule's own words instead.
      observedAt: at
    })
  })

  it('shows only the loudest signal when one module reports several', () => {
    const chip = projectModuleSignalChip(read([
      signal({ severity: 'medium' }),
      signal({ severity: 'high', values: { dropPct: -2.9, volumeMultiple: 3.4, notionalUsd: 7.2e9 } }),
      signal({ severity: 'low', asset: 'eth' })
    ]))
    expect(chip).toMatchObject({ state: 'alert', dropPct: -2.9, asset: 'btc' })
  })

  it('says data is insufficient instead of printing a partial reading', () => {
    expect(projectModuleSignalChip(read([signal({ readiness: 'unavailable', values: {} })]))).toEqual({ state: 'insufficient' })
    // An asset-less reading is a contract failure, and the card must not invent one.
    expect(projectModuleSignalChip(read([signal({ asset: null })]))).toEqual({ state: 'insufficient' })
  })

  it('ignores another module: that chip belongs to that module’s card', () => {
    expect(projectModuleSignalChip(read([signal({ moduleId: 'etf-flows', ruleId: 'etf-outflow-3d' })]))).toEqual({ state: 'hidden' })
  })

  it('carries no severity into the view: the reader must not compare two modules by it', () => {
    const chip = projectModuleSignalChip(read([signal({ severity: 'high' })]))
    expect(JSON.stringify(chip)).not.toContain('severity')
    expect(JSON.stringify(chip)).not.toContain('high')
  })
})
