import { describe, expect, it } from 'vitest'

import { getIntelligenceSourceDefinition } from './sourceCatalog'
import { isSourceStaleAsOf, readMacroReleaseCadence, resolveMacroFreshnessWindowMs } from './macroSourceHealth'

describe('macroSourceHealth', () => {
  it('returns per-source macro freshness windows from adapter config', () => {
    expect(resolveMacroFreshnessWindowMs('bls-economic-series')).toBe(45 * 24 * 60 * 60 * 1000)
    expect(resolveMacroFreshnessWindowMs('fred-rates-liquidity')).toBe(7 * 24 * 60 * 60 * 1000)
    expect(resolveMacroFreshnessWindowMs('coindesk-rss')).toBeUndefined()
  })

  it('honors adapterConfig freshness overrides', () => {
    expect(
      resolveMacroFreshnessWindowMs('treasury-fiscal-data', { freshnessWindowMs: 3 * 24 * 60 * 60 * 1000 })
    ).toBe(3 * 24 * 60 * 60 * 1000)
  })

  it('marks macro sources stale only after their cadence window', () => {
    const asOf = '2026-07-08T10:00:00.000Z'
    const defaultFreshnessMs = 6 * 60 * 60 * 1000

    expect(
      isSourceStaleAsOf({
        sourceId: 'bls-economic-series',
        lastSuccessAt: '2026-06-20T10:00:00.000Z',
        asOf,
        defaultFreshnessMs
      })
    ).toBe(false)

    expect(
      isSourceStaleAsOf({
        sourceId: 'fred-rates-liquidity',
        lastSuccessAt: '2026-06-20T10:00:00.000Z',
        asOf,
        defaultFreshnessMs
      })
    ).toBe(true)
  })

  it('reads macro release cadence from source definitions', () => {
    const bls = getIntelligenceSourceDefinition('bls-economic-series')!
    const treasury = getIntelligenceSourceDefinition('treasury-fiscal-data')!

    expect(readMacroReleaseCadence(bls)).toBe('monthly')
    expect(readMacroReleaseCadence(treasury)).toBe('daily')
  })
})
