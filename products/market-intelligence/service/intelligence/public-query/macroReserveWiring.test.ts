import { expect, it } from 'vitest'
import { marketCalendarPublicPolicy } from '../../../contracts/macro/marketCalendarQueryContracts'
import { marketCalendarObservationEventKey } from '../macro-calendar/marketCalendarObservationNormalization'
import { buildMarketAnalysisContext } from './marketAnalysisContextQuery'

it('keeps the triggering event facts in the context when the budget is tight', async () => {
  const asOf = '2026-10-09T12:00:00.000Z'
  const pageEvent = (observationKey: string) => ({
    // 契约要求 UUID 形状且跨查询稳定；这里固定两个形状，避免每次调用都换键。
    eventKey: observationKey.includes('CPI') ? '11111111-2222-3333-4444-555555555555' : '66666666-7777-8888-9999-aaaaaaaaaaaa',
    observationKey, eventNameKey: observationKey.includes('CPI') ? 'US.CPI.NSA.YOY' : 'US.PPI.NSA.YOY',
    title: observationKey.includes('CPI') ? '美国CPI年率' : '美国PPI年率',
    countryCode: 'US', eventType: 'economic-indicator' as const, importance: 'high' as const,
    scheduledAt: '2026-10-13T12:30:00.000Z', consensus: null, providerPrevious: null, providerActual: { displayValue: '3.2' },
    source: 'Narwhal' as const, sourceObservedAt: '2026-10-01T00:00:00.000Z',
    coverage: 'observed-unverified' as const
  })
  const cpiKey = marketCalendarObservationEventKey('US.CPI.NSA.YOY|2026-09|2026-10-13')
  const service = {
    queryMarketCalendarMonth: () => ({
      state: 'available' as const, month: '2026-10', locale: 'zh' as const, asOf,
      events: [pageEvent('US.CPI.NSA.YOY|2026-09|2026-10-13'), pageEvent('US.PPI.NSA.YOY|2026-09|2026-10-13')],
      sources: marketCalendarPublicPolicy.kinds.map(eventType => ({ eventType, status: 'success', sourceObservedAt: '2026-10-01T00:00:00.000Z' }))
    })
  } as never
  const input = { eventGroupId: 'mi-eg-test', asOf, domains: ['macro'] as never, maxFacts: 5 }
  const withoutTrigger = await buildMarketAnalysisContext(input, service)
  const withTrigger = await buildMarketAnalysisContext(input, service, { triggeredEventKeys: new Set([cpiKey]) })
  expect(withoutTrigger.state).toBe('available')
  expect(withTrigger.state).toBe('available')
  if (withoutTrigger.state !== 'available' || withTrigger.state !== 'available') return
  const kept = (result: typeof withoutTrigger) => result.facts.filter(fact => fact.evidenceRefId?.endsWith(cpiKey)).length
  expect(kept(withoutTrigger)).toBeLessThan(kept(withTrigger))
  expect(withTrigger.facts).toHaveLength(5)
  expect(withTrigger.caveats).toContain('max-items-truncated')
})
