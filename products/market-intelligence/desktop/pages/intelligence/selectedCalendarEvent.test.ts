import { expect, it, vi } from 'vitest'
import { chartEventSelection, chartEventSelectionPolicy, openEventDetailThenRecord } from './selectedCalendarEvent'
import type { CrossAssetEventLine, CrossAssetEventLineEvent } from '../../features/industry/cross-asset/crossAssetEventLines'

/**
 * What the page records when the reader clicks a line on the chart.
 *
 * The line is one minute and may carry several events, so the page has to name the one the drawer
 * opens on — and it must be the released one whenever there is one, because that is the event that
 * explains the shape the reader was looking at.
 */
const event = (overrides: Partial<CrossAssetEventLineEvent> = {}): CrossAssetEventLineEvent => ({
  eventKey: 'US.CPI.RELEASE.2026-M10', title: '消费者物价指数（CPI）', countryCode: 'US',
  eventType: 'economic-indicator', lifecycleState: 'released', ...overrides
})
const line = (overrides: Partial<CrossAssetEventLine> = {}): CrossAssetEventLine => ({
  atMs: Date.parse('2026-10-13T12:30:00.000Z'), events: [event()], published: true,
  label: '消费者物价指数（CPI）', sources: 1, ...overrides
})

it('records the event a line stands for, in the calendar month that instant belongs to', () => {
  expect(chartEventSelection(line())).toEqual({
    eventKey: 'US.CPI.RELEASE.2026-M10', month: '2026-10', label: '消费者物价指数（CPI）'
  })
})

it('records the released event of a shared minute, whichever position it holds', () => {
  const scheduled = event({ eventKey: 'US.NFP.2026-M10', lifecycleState: 'scheduled', title: '非农就业人数' })
  const selection = chartEventSelection(line({
    events: [scheduled, event()], label: '非农就业人数、消费者物价指数（CPI）（2）'
  }))
  // The released one is the event that explains a move that already happened.
  expect(selection?.eventKey).toBe('US.CPI.RELEASE.2026-M10')
  // The label stays the line's own, which names every event in the minute.
  expect(selection?.label).toBe('非农就业人数、消费者物价指数（CPI）（2）')
})

it('records the line\'s first event while all of them are still ahead', () => {
  const first = event({ eventKey: 'US.NFP.2026-M10', lifecycleState: 'scheduled', title: '非农就业人数' })
  const second = event({ eventKey: 'US.CPI.2026-M11', lifecycleState: 'scheduled' })
  expect(chartEventSelection(line({ events: [first, second], published: false, label: '非农就业人数、消费者物价指数（CPI）（2）' }))?.eventKey)
    .toBe('US.NFP.2026-M10')
})

it('records nothing for a line that carries no event at all', () => {
  expect(chartEventSelection(line({ events: [] }))).toBeUndefined()
})

it('takes the month from a month boundary instant in the calendar\'s own UTC months', () => {
  expect(chartEventSelection(line({ atMs: Date.parse('2026-10-31T23:30:00.000Z') }))?.month).toBe('2026-10')
  expect(chartEventSelection(line({ atMs: Date.parse('2026-11-01T00:30:00.000Z') }))?.month).toBe('2026-11')
})

it('keeps the month the panel read the event from over the instant it happened at', () => {
  // Filed under September, detected after midnight: the Agent's facts are read by month, and the
  // month the calendar filed it under is the only one that finds it.
  expect(chartEventSelection(line({ atMs: Date.parse('2026-10-01T02:00:00.000Z') }), '2026-09')?.month).toBe('2026-09')
})

it('opens the detail first and records second, and a failed record still leaves it open', () => {
  // The click means "show me what that was"; recording the event for the Agent is additive, so a
  // recorder that throws must not cost the reader the detail they asked for.
  const order: string[] = []
  const record = vi.fn(() => { order.push('record'); throw new Error('agent-unavailable') })
  expect(() => openEventDetailThenRecord({ eventKey: 'k', month: '2026-09' }, () => order.push('open'), record)).not.toThrow()
  expect(order).toEqual(['open', 'record'])
  expect(record).toHaveBeenCalledTimes(1)
})

it('records the official row when a line carries both routes\' copies of one release', () => {
  // 评审 ④：同一行里官方行与 provider 行并存时，读者点开的应当是能自己核对的那一份。
  const event = (source: 'official' | 'provider', eventKey: string, lifecycleState: 'released' | 'scheduled') =>
    ({ source, eventKey, lifecycleState, title: eventKey }) as never
  const line = { atMs: 1_000, events: [
    event('provider', 'provider-copy', 'released'), event('official', 'US.CPI.RELEASE.2026-M09', 'released')
  ] } as never
  expect(chartEventSelectionPolicy.representative(line)).toMatchObject({ source: 'official', eventKey: 'US.CPI.RELEASE.2026-M09' })
  // 官方那条还没发布时，仍然记录已发布的 provider 行（它解释读者刚看的波动）。
  const ahead = { atMs: 1_000, events: [event('provider', 'provider-copy', 'released'), event('official', 'US.CPI.RELEASE.2026-M09', 'scheduled')] } as never
  expect(chartEventSelectionPolicy.representative(ahead)).toMatchObject({ source: 'provider' })
})
