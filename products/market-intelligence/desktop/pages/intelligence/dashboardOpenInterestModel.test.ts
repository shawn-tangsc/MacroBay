import { describe, expect, it } from 'vitest'

import type { ModuleSignal } from '../../../contracts/moduleSignal'
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

describe('module signal chip', () => {
  it('draws nothing when the rule has nothing to say', () => {
    // The product decision: a normal market shows no chip at all, not an empty container.
    expect(projectModuleSignalChip([])).toEqual({ state: 'hidden' })
    expect(projectModuleSignalChip(undefined)).toEqual({ state: 'hidden' })
  })

  it('shows the reading a fired rule produced, numbers intact', () => {
    expect(projectModuleSignalChip([signal()])).toEqual({
      state: 'alert', asset: 'btc', dropPct: -1.8, volumeMultiple: 2.4,
      ruleId: 'oi-liquidation-proxy', observedAt: at
    })
  })

  it('shows only the loudest signal when one module reports several', () => {
    const chip = projectModuleSignalChip([
      signal({ severity: 'medium' }),
      signal({ severity: 'high', values: { dropPct: -2.9, volumeMultiple: 3.4, notionalUsd: 7.2e9 } }),
      signal({ severity: 'low', asset: 'eth' })
    ])
    expect(chip).toMatchObject({ state: 'alert', dropPct: -2.9, asset: 'btc' })
  })

  it('says data is insufficient instead of printing a partial reading', () => {
    expect(projectModuleSignalChip([signal({ readiness: 'unavailable', values: {} })])).toEqual({ state: 'insufficient' })
    // An asset-less reading is a contract failure, and the card must not invent one.
    expect(projectModuleSignalChip([signal({ asset: null })])).toEqual({ state: 'insufficient' })
  })

  it('ignores another module: that chip belongs to that module’s card', () => {
    expect(projectModuleSignalChip([signal({ moduleId: 'etf-flows', ruleId: 'etf-outflow-3d' })])).toEqual({ state: 'hidden' })
  })

  it('carries no severity into the view: the reader must not compare two modules by it', () => {
    const chip = projectModuleSignalChip([signal({ severity: 'high' })])
    expect(JSON.stringify(chip)).not.toContain('severity')
    expect(JSON.stringify(chip)).not.toContain('high')
  })
})
