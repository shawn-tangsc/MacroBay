// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it } from 'vitest'
import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'
import { productText } from '../../../shared/i18n/productText'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
/** 显示时区由窗口级 provider 提供；测试固定 UTC，断言才与宿主时区无关。 */
const scoped = (node: React.ReactElement): React.ReactElement => <ShellTimeZoneProvider timeZone="UTC">{node}</ShellTimeZoneProvider>
it('renders provider-only economic values and unknown country without numerical fields for other events', async () => {
  const { MarketCalendarInspector } = await import('./MarketCalendarEvents')
  const host = document.createElement('div'); const root = createRoot(host)
  const text = productText['zh-CN'].pages.intelligence.portal.calendar
  const event = { eventKey: '00000000-0000-4000-8000-000000000001', title: 'Derived market event', countryCode: null,
    eventType: 'economic-indicator' as const, importance: 'high' as const, scheduledAt: '2026-09-10T00:00:00.000Z',
    consensus: { displayValue: '0' }, providerPrevious: null, providerActual: { displayValue: '3' },
    source: '0xRouter' as const, sourceObservedAt: '2026-09-10T01:00:00.000Z', coverage: 'observed-unverified' as const }
  try {
    await act(async () => root.render(scoped(<MarketCalendarInspector event={event} text={text} />)))
    expect(host.textContent).toContain('市场预期')
    expect(host.textContent).toContain('公布值（0xRouter）')
    expect(host.textContent).toContain('未标明国家')
    expect(host.textContent).toContain('暂不可比较')
    expect(host.textContent).toContain('本次尚未刷新')
    expect(host.textContent).toContain('数据采集于')
    expect(host.querySelector('[data-market-value="consensus"]')?.textContent).toContain('0')
    expect(host.querySelector('[data-market-value="providerPrevious"]')?.textContent).toBe('前值（0xRouter）暂无')
    expect(host.querySelector('[data-market-importance]')?.textContent).toBe('重要性高')
    await act(async () => root.render(scoped(<MarketCalendarInspector event={{ ...event, eventType: 'financial-event', consensus: null, providerPrevious: null, providerActual: null }} text={text} />)))
    expect(host.querySelector('[data-market-value]')).toBeNull()
  } finally { await act(async () => root.unmount()) }
  })
it('states the market surprise in the inspector, and prints no number when there is none to compare', async () => {
  const { MarketCalendarInspector } = await import('./MarketCalendarEvents')
  const host = document.createElement('div'); const root = createRoot(host)
  const text = productText['zh-CN'].pages.intelligence.portal.calendar
  const base = { eventKey: '00000000-0000-4000-8000-000000000009', title: 'Surprise event', countryCode: 'US',
    eventType: 'economic-indicator' as const, importance: 'high' as const, scheduledAt: '2026-10-15T12:30:00.000Z',
    source: '0xRouter' as const, sourceObservedAt: '2026-10-15T12:31:00.000Z', coverage: 'observed-unverified' as const }
  const surpriseRow = () => host.querySelector('[data-market-value="surprise"]')
  try {
    await act(async () => root.render(scoped(<MarketCalendarInspector event={{ ...base,
      consensus: { displayValue: '3.1%' }, providerPrevious: { displayValue: '3.1%' }, providerActual: { displayValue: '3.4%' } }} text={text} />)))
    expect(surpriseRow()?.getAttribute('data-surprise')).toBe('beat')
    expect(surpriseRow()?.querySelector('strong')?.textContent).toBe('超预期 +0.3 个百分点')

    await act(async () => root.render(scoped(<MarketCalendarInspector event={{ ...base,
      consensus: null, providerPrevious: { displayValue: '3.1%' }, providerActual: { displayValue: '3.4%' } }} text={text} />)))
    expect(surpriseRow()?.getAttribute('data-surprise')).toBe('consensus-unavailable')
    expect(surpriseRow()?.querySelector('strong')?.textContent).toBe('无一致预期')
    expect(surpriseRow()?.querySelector('strong')?.textContent).not.toMatch(/[\d—−]/)

    await act(async () => root.render(scoped(<MarketCalendarInspector event={{ ...base,
      consensus: { displayValue: '240K' }, providerPrevious: { displayValue: '240K' }, providerActual: { displayValue: '250K' } }} text={text} />)))
    expect(surpriseRow()?.getAttribute('data-surprise')).toBe('consensus-unavailable')
    expect(surpriseRow()?.querySelector('strong')?.textContent).toBe('预期差不可比')

    // A scheduled event has no actual, so it has no surprise row at all.
    await act(async () => root.render(scoped(<MarketCalendarInspector event={{ ...base,
      consensus: { displayValue: '3.1%' }, providerPrevious: null, providerActual: null }} text={text} />)))
    expect(surpriseRow()).toBeNull()
  } finally { await act(async () => root.unmount()) }
})
it('prefers safe countryName, then code, then the localized unknown fallback', async () => {
  const { MarketCalendarInspector } = await import('./MarketCalendarEvents')
  const host = document.createElement('div'); const root = createRoot(host)
  const text = productText['zh-CN'].pages.intelligence.portal.calendar
  const base = { eventKey: '00000000-0000-4000-8000-000000000002', title: 'Country event', eventType: 'financial-event' as const,
    importance: 'high' as const, scheduledAt: '2026-09-10T00:00:00.000Z', consensus: null, providerPrevious: null, providerActual: null,
    source: '0xRouter' as const, sourceObservedAt: '2026-09-10T01:00:00.000Z', coverage: 'observed-unverified' as const }
  try {
    await act(async () => root.render(scoped(<MarketCalendarInspector event={{ ...base, countryCode: 'CHN', countryName: '中国' }} text={text} />)))
    expect(host.querySelector('[data-market-country]')?.textContent).toContain('中国')
    await act(async () => root.render(scoped(<MarketCalendarInspector event={{ ...base, countryCode: 'US' }} text={text} />)))
    expect(host.querySelector('[data-market-country]')?.textContent).toContain('US')
    await act(async () => root.render(scoped(<MarketCalendarInspector event={{ ...base, countryCode: null }} text={text} />)))
    expect(host.querySelector('[data-market-country]')?.textContent).toContain('未标明国家')
  } finally { await act(async () => root.unmount()) }
})

it('shows the calendar times in the reader zone instead of a fixed Beijing offset', async () => {
  const { MarketCalendarInspector } = await import('./MarketCalendarEvents')
  const host = document.createElement('div'); const root = createRoot(host)
  const text = productText['zh-CN'].pages.intelligence.portal.calendar
  const event = { eventKey: '00000000-0000-4000-8000-000000000003', title: 'Zoned event', countryCode: null,
    eventType: 'economic-indicator' as const, importance: 'high' as const, scheduledAt: '2026-09-10T00:00:00.000Z',
    consensus: null, providerPrevious: null, providerActual: null,
    source: '0xRouter' as const, sourceObservedAt: '2026-09-10T01:00:00.000Z', coverage: 'observed-unverified' as const }
  try {
    // UTC provider：日历必须跟随窗口时区，而不是写死的 Asia/Shanghai
    await act(async () => root.render(scoped(<MarketCalendarInspector event={event} text={text} />)))
    expect(host.textContent).toContain('2026-09-10 00:00 GMT')
    expect(host.textContent).toContain('2026-09-10 01:00:00 GMT')
    await act(async () => root.render(<ShellTimeZoneProvider timeZone="Asia/Shanghai"><MarketCalendarInspector event={event} text={text} /></ShellTimeZoneProvider>))
    expect(host.textContent).toContain('2026-09-10 08:00 GMT+8')
    expect(host.textContent).toContain('2026-09-10 09:00:00 GMT+8')
  } finally { await act(async () => root.unmount()) }
})

it('renders safe failed and empty endpoint feedback in English without claiming live data', async () => {
  const { MarketCalendarSourceStatus } = await import('./MarketCalendarSourceStatus')
  const host = document.createElement('div'); const root = createRoot(host)
  const text = productText['en-US'].pages.intelligence.portal.calendar
  const time = '2026-09-14T00:00:00.000Z'
  try {
    await act(async () => root.render(scoped(<MarketCalendarSourceStatus text={text} source={{ eventType: 'economic-indicator',
      status: 'success', sourceObservedAt: time, latestAttempt: { state: 'failed', attemptedAt: '2026-09-20T00:00:00.000Z' } }} />)))
    expect(host.textContent).toContain('Refresh failed')
    expect(host.textContent).toContain('Showing previous data')
    expect(host.textContent).toContain('2026-09-14 00:00:00 GMT')
    await act(async () => root.render(scoped(<MarketCalendarSourceStatus text={text} source={{ eventType: 'financial-event',
      status: 'success-empty', sourceObservedAt: time }} />)))
    expect(host.textContent).toContain('No events this time')
    expect(host.textContent).toContain('Not refreshed this session')
    expect(host.textContent).not.toContain('Refresh failed')
  } finally { await act(async () => root.unmount()) }
})

it('shows a refused automatic collection with its verdict, origin and time in the source line', async () => {
  const { MarketCalendarSourceStatus } = await import('./MarketCalendarSourceStatus')
  const host = document.createElement('div'); const root = createRoot(host)
  const text = productText['en-US'].pages.intelligence.portal.calendar
  const observedAt = '2026-10-14T02:45:00.000Z'
  try {
    await act(async () => root.render(scoped(<MarketCalendarSourceStatus text={text} source={{ eventType: 'economic-indicator',
      status: 'success', sourceObservedAt: observedAt, latestAttempt: { state: 'failed' as const,
        attemptedAt: '2026-10-14T13:00:00.000Z', failureCode: 'storage-pressure' as const, trigger: 'automatic' as const } }} />)))
    // Before this line existed, an automatic tick refused by the ceiling left no trace at all.
    expect(host.textContent).toContain('Refresh failed')
    expect(host.textContent).toContain('Automatic')
    expect(host.textContent).toContain('Storage limited')
    expect(host.textContent).toContain('Showing previous data')
    expect(host.textContent).toContain('2026-10-14 02:45:00 GMT')
    // The verdict is localised, never the raw wire code.
    expect(host.textContent).not.toContain('storage-pressure')

    await act(async () => root.render(scoped(<MarketCalendarSourceStatus text={text} source={{ eventType: 'economic-indicator',
      status: 'success', sourceObservedAt: observedAt, latestAttempt: { state: 'failed', attemptedAt: '2026-10-14T13:00:00.000Z' } }} />)))
    expect(host.textContent).toContain('Refresh failed')
    expect(host.textContent).not.toContain('Storage limited')
  } finally { await act(async () => root.unmount()) }
})
