import { expect, it } from 'vitest'
import { buildMarketAnalysisContext } from './marketAnalysisContextQuery'

it('keeps the triggering event facts in the context when the budget is tight', async () => {
  const event = (eventKey: string, family: string) => ({ eventKey, releaseGroupKey: 'g', eventFamily: family, titleKey: 'cpi', countryCode: 'US',
    importance: 'high' as const, periodKey: 'p', lifecycleState: 'released' as const, coverage: 'available' as const, scheduledDate: '2026-10-13',
    detectedAt: eventKey.startsWith('US.CPI') ? '2026-10-01T00:00:00.000Z' : '2026-10-09T06:00:00.000Z',
    providerIds: ['us-bls-official-calendar'], caveats: [], actual: { displayValue: '3.2%' } })
  const service = {
    queryMacroEconomicCalendarMonth: async ({ month }: { month: string }) => ({ state: 'available' as const, asOf: '2026-10-09T12:00:00.000Z',
      events: month === '2026-10' ? [event('US.CPI.RELEASE.2026-M09', 'cpi'), event('US.PPI.RELEASE.2026-M09', 'ppi')] : [] }),
    queryMarketCalendarMonth: () => ({ state: 'available' as const, month: '2026-10', locale: 'zh' as const, asOf: '2026-10-09T12:00:00.000Z', events: [], sources: [], nextCursor: null })
  } as never
  const input = { eventGroupId: 'mi-eg-test', asOf: '2026-10-09T12:00:00.000Z', domains: ['macro'] as never, maxFacts: 5 }
  const withoutTrigger = await buildMarketAnalysisContext(input, service)
  const withTrigger = await buildMarketAnalysisContext(input, service, { triggeredEventKeys: new Set(['US.CPI.RELEASE.2026-M09']) })
  expect(withoutTrigger.state).toBe('available')
  expect(withTrigger.state).toBe('available')
  if (withoutTrigger.state !== 'available' || withTrigger.state !== 'available') return
  const kept = (result: typeof withoutTrigger) => result.facts.filter(fact => fact.evidenceRefId?.endsWith('US.CPI.RELEASE.2026-M09')).length
  expect(kept(withoutTrigger)).toBeLessThan(kept(withTrigger))
  expect(withTrigger.facts).toHaveLength(5)
  expect(withTrigger.caveats).toContain('max-items-truncated')
})
