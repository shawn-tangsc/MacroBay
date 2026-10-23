// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { productText } from '../../../shared/i18n/productText'
import type { CalendarDayItem } from './economicCalendarDayModel'
globalThis.IS_REACT_ACT_ENVIRONMENT = true
it('declares uniform six-row day geometry through feature-local layout tokens', () => {
  const css = readFileSync('products/market-intelligence/desktop/features/macro/economic-calendar/economicCalendar.css', 'utf8')
  for (const rule of ['--mi-calendar-day-height: 200px', '--mi-calendar-row-height: 22px', '--mi-calendar-title-size: 12px',
    '--mi-calendar-time-size: 11px', '--mi-calendar-time-width: 40px', '--mi-calendar-date-size: 13px', '--mi-calendar-day-padding: 8px']) expect(css).toContain(rule)
  expect(css).toMatch(/\.mi-economic-calendar__day\s*\{[^}]*height: var\(--mi-calendar-day-height\)/)
  expect(css).toMatch(/\.mi-calendar-month-scroll\s*\{[^}]*overflow-y: auto/)
  expect(css).toMatch(/\.mi-economic-calendar__date\s*\{[^}]*text-align: left/)
})
it('centers the day number inside the current-day marker on both axes', () => {
  // The marker is a fixed 22px square while its number is 13px, so the line box has to be centered
  // rather than left to sit at the top of the square: the date read as if it were drifting upwards.
  const css = readFileSync('products/market-intelligence/desktop/features/macro/economic-calendar/economicCalendar.css', 'utf8')
  const marker = /\.mi-economic-calendar__date\[aria-current='date'\]\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
  expect(marker).toContain('place-items: center')
  expect(marker).toContain('width: var(--mi-calendar-row-height)')
  expect(marker).toContain('height: var(--mi-calendar-row-height)')
  expect(marker).toContain('border-radius: 50%')
})
it('uses only localized time and full accessible topic for both event sources', async () => {
  const { CalendarEventRow } = await import('./CalendarEventRow')
  const text = productText['zh-CN'].pages.intelligence.portal.calendar
  const host = document.createElement('div'); const root = createRoot(host)
  const event = { key: 'market:derived', source: 'market', date: '2026-09-10', time: '08:30',
    event: { eventKey: 'derived', title: 'Derived full topic', importance: 'high', eventType: 'economic-indicator', source: '0xRouter', consensus: { displayValue: '456' } } } as CalendarDayItem
  try {
    await act(async () => root.render(<CalendarEventRow item={event} text={text} statusNow="2026-09-10T00:00:00.000Z" onSelect={() => {}} />))
    expect(host.textContent).toBe('08:30Derived full topic')
    expect(host.querySelector('button')?.getAttribute('aria-label')).toContain('Derived full topic · 时间待定')
    expect(host.querySelector('button')?.hasAttribute('title')).toBe(false)
    expect(host.querySelector('button')?.getAttribute('data-event-status')).toBe('time-pending')
    expect(host.textContent).not.toMatch(/0xRouter|456/)
  } finally { await act(async () => root.unmount()) }
})

it('shows the provider country before the title, and never a country for an official event', async () => {
  const { CalendarEventRow } = await import('./CalendarEventRow')
  const text = productText['zh-CN'].pages.intelligence.portal.calendar
  const host = document.createElement('div'); const root = createRoot(host)
  // The reader's ask: a list of indicators is unreadable once two countries share an event name.
  const provider = { key: 'market:cn-cpi', source: 'market', date: '2026-10-14', time: '20:30',
    event: { eventKey: 'cn-cpi', title: '9月未季调消费者物价指数(年率)', countryName: '美国', importance: 'high', eventType: 'economic-indicator' } } as CalendarDayItem
  const official = { key: 'official:cpi', source: 'official', date: '2026-10-14', time: '20:30', event: { eventKey: 'US.CPI.RELEASE.2026-M09', labelKey: 'cpi' } } as CalendarDayItem
  try {
    await act(async () => root.render(<CalendarEventRow item={provider} text={text} statusNow="2026-10-14T00:00:00.000Z" onSelect={() => {}} />))
    const chip = host.querySelector('[data-event-country]')
    expect(chip?.textContent).toBe('美国')
    // Inside the title, not a third grid child: a box of its own collapsed the title to an ellipsis
    // in the month cell (the row is `time | minmax(0, 1fr)`), which is the regression this guards.
    const title = host.querySelector('.mi-economic-calendar__event-title')!
    expect(title.contains(chip)).toBe(true)
    expect(title.textContent).toBe('美国9月未季调消费者物价指数(年率)')
    expect(host.querySelector('button')?.getAttribute('aria-label')).toContain('美国')
    // The row keeps exactly two columns, so the title still owns the flexible one.
    const css = readFileSync('products/market-intelligence/desktop/features/macro/economic-calendar/economicCalendar.css', 'utf8')
    expect(css).toMatch(/\.mi-economic-calendar__event\s*\{[^}]*grid-template-columns: var\(--mi-calendar-time-width\) minmax\(0, 1fr\)/)
    // And the country rule introduces no layout box of its own.
    const countryRule = css.slice(css.indexOf('.mi-economic-calendar__event-country {'))
    expect(countryRule.slice(0, countryRule.indexOf('}'))).not.toMatch(/flex|padding|border|width/)

    await act(async () => root.render(<CalendarEventRow item={official} text={text} statusNow="2026-10-14T00:00:00.000Z" onSelect={() => {}} />))
    // The official route is US-only and says so in its own copy; a chip there would be noise.
    expect(host.querySelector('[data-event-country]')).toBeNull()
  } finally { await act(async () => root.unmount()) }
})

it('exposes the same status color state and localized tooltip label to assistive technology', async () => {
  const { CalendarEventRow } = await import('./CalendarEventRow')
  const text = productText['zh-CN'].pages.intelligence.portal.calendar
  const host = document.createElement('div'); const root = createRoot(host)
  const event = { key: 'market:received', source: 'market', date: '2026-09-10', time: '08:30',
    event: { eventKey: 'received', title: 'Published value', importance: 'high', eventType: 'economic-indicator', scheduledAt: '2026-09-09T00:00:00.000Z', providerActual: { displayValue: '0' } } } as CalendarDayItem
  try {
    await act(async () => root.render(<CalendarEventRow item={event} text={text} statusNow="2026-09-10T00:00:00.000Z" onSelect={() => {}} />))
    const row = host.querySelector('button')!
    expect(row.dataset.eventStatus).toBe('data-received')
    expect(row.getAttribute('aria-label')).toContain('Published value · 数据已获取')
  } finally { await act(async () => root.unmount()) }
})

it('never lets an overdue cell read as "no data": storage-limited and not-yet-published are different rows', async () => {
  const { CalendarEventRow } = await import('./CalendarEventRow')
  const text = productText['zh-CN'].pages.intelligence.portal.calendar
  const english = productText['en-US'].pages.intelligence.portal.calendar
  const host = document.createElement('div'); const root = createRoot(host)
  const observedAt = '2026-10-14T02:45:00.000Z'
  const item = { key: 'market:cpi', source: 'market', date: '2026-10-14', time: '20:30',
    event: { eventKey: 'cpi', title: '9月未季调消费者物价指数(年率)', importance: 'high', eventType: 'economic-indicator',
      scheduledAt: '2026-10-14T12:30:00.000Z', providerActual: null, sourceObservedAt: observedAt } } as CalendarDayItem
  const refused = [{ eventType: 'economic-indicator' as const, status: 'success' as const, sourceObservedAt: observedAt,
    latestAttempt: { state: 'failed' as const, attemptedAt: '2026-10-14T13:00:00.000Z', failureCode: 'storage-pressure' as const, trigger: 'automatic' as const } }]
  const statusNow = '2026-10-14T14:00:00.000Z'
  try {
    await act(async () => root.render(<CalendarEventRow item={item} marketSources={refused} text={text} statusNow={statusNow} onSelect={() => {}} />))
    expect(host.querySelector('button')!.dataset.eventStatus).toBe('storage-limited')
    expect(host.querySelector('button')!.getAttribute('aria-label')).toContain('存储受限')

    // Without the source verdict the same row cannot claim a storage limit: the claim comes
    // from the page's source state, never from the absence of a value.
    await act(async () => root.render(<CalendarEventRow item={item} text={text} statusNow={statusNow} onSelect={() => {}} />))
    expect(host.querySelector('button')!.dataset.eventStatus).toBe('awaiting-data')

    await act(async () => root.render(<CalendarEventRow item={item} marketSources={refused} text={text} statusNow={statusNow} onSelect={() => {}} />))

    // The source answered after the release and still published nothing: that is its own
    // answer, not our storage limit, so the same refusal must not relabel it.
    const answered = { ...item, event: { ...item.event, sourceObservedAt: '2026-10-14T13:05:00.000Z' } } as CalendarDayItem
    await act(async () => root.render(<CalendarEventRow item={answered} marketSources={refused} text={text} statusNow={statusNow} onSelect={() => {}} />))
    expect(host.querySelector('button')!.dataset.eventStatus).toBe('awaiting-data')
    expect(host.querySelector('button')!.getAttribute('aria-label')).toContain('待发布')

    // Two different meanings, two different sentences, in both locales.
    for (const copy of [text, english]) {
      expect(copy.eventStatus['storage-limited']).not.toBe(copy.eventStatus['awaiting-data'])
      expect(copy.eventStatus['storage-limited']).not.toMatch(/^\s*$/)
    }
    // And the new state is painted from a token, never a literal colour on the row.
    const css = readFileSync('products/market-intelligence/desktop/features/macro/economic-calendar/economicCalendar.css', 'utf8')
    expect(css).toMatch(/\[data-event-status='storage-limited'\]\s*\{[^}]*var\(--mi-calendar-status-limited\)/)
    expect(css).toMatch(/--mi-calendar-status-limited:/)
  } finally { await act(async () => root.unmount()) }
})
it('marks a high-importance row before its name, on the calendar cell and the day list alike', async () => {
  const { CalendarEventRow } = await import('./CalendarEventRow')
  const text = productText['zh-CN'].pages.intelligence.portal.calendar
  const english = productText['en-US'].pages.intelligence.portal.calendar
  const host = document.createElement('div'); const root = createRoot(host)
  const market = (importance: 'high' | 'medium' | 'low') => ({ key: `market:${importance}`, source: 'market', date: '2026-09-10', time: '08:30',
    event: { eventKey: importance, title: 'Derived topic', importance, eventType: 'economic-indicator' } }) as CalendarDayItem
  const official = { key: 'official:cpi', source: 'official', date: '2026-09-10', time: '08:30',
    event: { eventKey: 'US.CPI.RELEASE.2026-M09', labelKey: 'cpi' } } as CalendarDayItem
  // Both surfaces draw this same row, so one mark covers the cell and the standing day list.
  const render = async (item: CalendarDayItem, copy = text) => {
    await act(async () => root.render(<CalendarEventRow item={item} text={copy} statusNow="2026-09-10T12:00:00.000Z" onSelect={() => {}} />))
  }
  try {
    await render(market('high'))
    const title = host.querySelector('.mi-economic-calendar__event-title')!
    const marker = title.querySelector<HTMLElement>('[data-importance-marker]')
    expect(marker, 'a high-importance row wears a marker').not.toBeNull()
    // Inside the title and immediately ahead of the name — the kind glyph leads the run.
    expect(title.textContent).toBe('Derived topic')
    expect(marker!.nextSibling?.textContent).toBe('Derived topic')
    // The mark is not the only carrier: the accessible name states the importance too.
    expect(host.querySelector('button')?.getAttribute('aria-label')).toContain(`${text.details.importance} ${text.importance.high}`)

    await render(official)
    expect(host.querySelector('[data-importance-marker]'), 'an official row is high by its own route').not.toBeNull()

    for (const importance of ['medium', 'low'] as const) {
      await render(market(importance))
      expect(host.querySelector('[data-importance-marker]'), `${importance} is not high importance`).toBeNull()
      expect(host.querySelector('button')?.getAttribute('aria-label')).not.toContain(text.details.importance)
    }

    await render(market('high'), english)
    expect(host.querySelector('button')?.getAttribute('aria-label')).toContain(`${english.details.importance} ${english.importance.high}`)

    // Painted from the workspace's own token, never a literal colour on the row.
    const css = readFileSync('products/market-intelligence/desktop/features/macro/economic-calendar/economicCalendar.css', 'utf8')
    expect(css).toMatch(/\.mi-economic-calendar__event-marker\s*\{[^}]*var\(--/)
    expect(css).not.toMatch(/\.mi-economic-calendar__event-marker\s*\{[^}]*#[0-9a-f]{3,8}/i)
  } finally { await act(async () => root.unmount()) }
})
it('leads every row with a glyph for its kind, on the calendar cell and the day list alike', async () => {
  // The cell has no room for 经济指标/央行活动/财经事件 and the day list's headings scroll away, so a
  // row that mixes kinds has to say its own kind. Both surfaces draw this same row.
  const { CalendarEventRow } = await import('./CalendarEventRow')
  const text = productText['zh-CN'].pages.intelligence.portal.calendar
  const english = productText['en-US'].pages.intelligence.portal.calendar
  const host = document.createElement('div'); const root = createRoot(host)
  const market = (eventType: 'economic-indicator' | 'financial-event' | 'central-bank-activity') => ({ key: `market:${eventType}`, source: 'market', date: '2026-09-10', time: '08:30',
    event: { eventKey: eventType, title: 'Derived topic', importance: 'high' as const, eventType } }) as CalendarDayItem
  const official = { key: 'official:cpi', source: 'official', date: '2026-09-10', time: '08:30',
    event: { eventKey: 'US.CPI.RELEASE.2026-M09', labelKey: 'cpi' } } as CalendarDayItem
  const render = async (item: CalendarDayItem, copy = text) => {
    await act(async () => root.render(<CalendarEventRow item={item} text={copy} statusNow="2026-09-10T12:00:00.000Z" onSelect={() => {}} />))
  }
  try {
    for (const [eventType, icon] of [['economic-indicator', 'lucide-trending-up'], ['central-bank-activity', 'lucide-landmark'], ['financial-event', 'lucide-newspaper']] as const) {
      await render(market(eventType))
      const glyph = host.querySelector<HTMLElement>('[data-event-kind]')!
      expect(glyph, `${eventType} names its own kind`).not.toBeNull()
      expect(glyph.dataset.eventKind).toBe(eventType)
      // One distinct glyph per kind, decorative, leading the title run ahead of the name.
      expect(glyph.querySelector(`.${icon}`)).not.toBeNull()
      expect(glyph.getAttribute('aria-hidden')).toBe('true')
      expect(host.querySelector('.mi-economic-calendar__event-title')?.firstElementChild).toBe(glyph)
      // ...and the accessible name says the kind in words, so the glyph is never the only carrier.
      expect(host.querySelector('button')?.getAttribute('aria-label')).toContain(text.market.kinds[eventType])
    }
    // The official route is an economic indicator, and the words follow the app's language.
    await render(official)
    expect(host.querySelector<HTMLElement>('[data-event-kind]')?.dataset.eventKind).toBe('economic-indicator')
    await render(market('central-bank-activity'), english)
    expect(host.querySelector('button')?.getAttribute('aria-label')).toContain(english.market.kinds['central-bank-activity'])

    // Painted from the workspace's own tokens, never a literal colour on the row.
    const css = readFileSync('products/market-intelligence/desktop/features/macro/economic-calendar/economicCalendar.css', 'utf8')
    expect(css).toMatch(/\.mi-economic-calendar__event-kind\s*\{[^}]*var\(--/)
    expect(css).not.toMatch(/\.mi-economic-calendar__event-kind\s*\{[^}]*#[0-9a-f]{3,8}/i)
  } finally { await act(async () => root.unmount()) }
})
