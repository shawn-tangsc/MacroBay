import { expect, it } from 'vitest'
import { marketCalendarEventLifecyclePolicy, providerLifecycleState } from '../../shared/marketCalendarEventLifecycle'
import { toCardEventFromOfficial, toCardEventFromProvider } from './calendarCardEventProjection'

/**
 * 夹具按**真实签名**收窄（从函数参数取形状，不另写一份）：`provider` 这一侧的读数
 * 以前写成 `Record<string, unknown>`，于是它和 `providerLifecycleState` 的弱类型参数
 * 没有任何公共属性，TS 报 TS2559——那是夹具宽了，不是生产类型窄了。
 */
type ProviderRow = Parameters<typeof toCardEventFromProvider>[0]

const provider = (overrides: Partial<ProviderRow> = {}): ProviderRow => ({
  eventKey: 'market-observation-1', title: '零售销售(月率)', importance: 'high',
  eventType: 'economic-indicator', scheduledAt: '2026-10-13T12:30:00.000Z', sourceObservedAt: '2026-10-11T06:00:00.000Z', ...overrides
})

it('keeps an official event’s own lifecycle rather than deriving one', () => {
  const view = { eventKey: 'US.CPI', titleKey: 'cpi', importance: 'high' as const, lifecycleState: 'cancelled' as const, scheduledDate: '2026-10-13', detectedAt: '2026-10-11T06:00:00.000Z' }
  expect(toCardEventFromOfficial(view).lifecycleState).toBe('cancelled')
})

it('calls a provider row upcoming until it publishes a value', () => {
  // The rule that was missing: hard-coding `released` here had excluded every 0xRouter event.
  expect(providerLifecycleState(provider())).toBe('scheduled')
  expect(providerLifecycleState(provider({ providerActual: { displayValue: '0.3%' } }))).toBe('released')
  expect(toCardEventFromProvider(provider()).lifecycleState).toBe('scheduled')
  expect(marketCalendarEventLifecyclePolicy.releasedWhenValuePublished).toBe(true)
})

it('carries the provider country onto the card, and never invents one for the official route', () => {
  expect(toCardEventFromProvider(provider({ countryName: '美国' })).countryName).toBe('美国')
  // A provider row without one stays without one: no code, no guess.
  expect(toCardEventFromProvider(provider()).countryName).toBeUndefined()
  expect(toCardEventFromOfficial({ eventKey: 'US.CPI.RELEASE.2026-M09', titleKey: 'cpi', importance: 'high',
    lifecycleState: 'scheduled', scheduledDate: '2026-10-14', detectedAt: '2026-08-12T04:30:13.670Z' })).not.toHaveProperty('countryName')
})

it('never invents a cancellation the provider route cannot report', () => {
  // Absent, not withdrawn: both come back as scheduled/released, never `cancelled`.
  const states = [provider(), provider({ providerActual: { displayValue: '0.3%' } })].map(view => toCardEventFromProvider(view).lifecycleState)
  expect(states).not.toContain('cancelled')
})

it('carries the published values and the date the provider reported', () => {
  const mapped = toCardEventFromProvider(provider({ providerActual: { displayValue: '0.3%' }, providerPrevious: { displayValue: '0.1%' }, consensus: { displayValue: '0.2%' } }))
  expect(mapped).toMatchObject({ scheduledDate: '2026-10-13', actual: { displayValue: '0.3%' }, previous: { displayValue: '0.1%' }, consensus: { displayValue: '0.2%' } })
})
