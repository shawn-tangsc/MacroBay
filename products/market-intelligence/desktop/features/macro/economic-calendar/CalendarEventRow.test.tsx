// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { productText } from '../../../shared/i18n/productText'
// 文案端口是组件 prop 的类型（两种语言的联合），测试的 render 助手要用它，不能绑死在中文那份上。
import type { EconomicCalendarText } from './economicCalendarText'
import type { CalendarDayItem } from './economicCalendarDayModel'

// These cases mount the real row component (and read the stylesheet) instead of asserting data
// shapes, so each one costs real React work. Six of them pass in under three seconds on an idle
// machine, but a whole-suite parallel run has twice pushed them past the shared five-second
// limit — a red that disappears when the file runs alone. The fix belongs here, not in the global
// limit: that five-second signal is what would catch a real slowdown.
const MOUNT_TIMEOUT_MS = 20_000


// These cases mount the real row component (and read the stylesheet) instead of asserting data
// shapes, so they cost tens of milliseconds of React work each. Six of them in one file pass in
// under three seconds on an idle machine, but a parallel run across the whole suite has twice
// pushed them past the shared five-second limit and produced a red that disappears when the file
// runs alone. The fix belongs here, not in the global limit: that five-second signal is what
// catches a real slowdown. Raise it per file, with the reason written down.
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
    event: { eventKey: 'derived', title: 'Derived full topic', importance: 'high', eventType: 'economic-indicator', source: 'Narwhal', consensus: { displayValue: '456' } } } as CalendarDayItem
  try {
    await act(async () => root.render(<CalendarEventRow item={event} text={text} statusNow="2026-09-10T00:00:00.000Z" onSelect={() => {}} />))
    // 国家这一格现在永远有内容（用户 2026-11-16：没有国家数据时显示「未知国家」），所以整行文本里有它。
    expect(host.textContent).toBe('08:30未知国家Derived full topic')
    expect(host.querySelector('button')?.getAttribute('aria-label')).toContain('Derived full topic · 时间待定')
    expect(host.querySelector('button')?.hasAttribute('title')).toBe(false)
    expect(host.querySelector('button')?.getAttribute('data-event-status')).toBe('time-pending')
    expect(host.textContent).not.toMatch(/0xRouter|456/)
  } finally { await act(async () => root.unmount()) }
}, MOUNT_TIMEOUT_MS)

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
    // 国家是**固定的第二列**（用户 2026-11-16 第二次要求「事件前面要显示国家」）：它不在标题里，
    // 而是网格第二个子元素——这样列宽固定，有没有国家的行标题都从同一个 x 开始。
    // （2026-11-16 之前它确实是标题里的行内片段，理由是省下窄月格的宽度；那条判断已被用户推翻。）
    const row = host.querySelector('button')!
    const cells = Array.from(row.children) as HTMLElement[]
    expect(cells).toHaveLength(3)
    expect(cells[1]).toBe(chip)
    expect(chip!.className).toContain('mi-economic-calendar__event-country')
    const title = host.querySelector('.mi-economic-calendar__event-title')!
    expect(title.contains(chip)).toBe(false)
    expect(title.textContent).toBe('9月未季调消费者物价指数(年率)')
    expect(row.getAttribute('aria-label')).toContain('美国')
    // 三列：时间固定 | 国家固定 | 标题弹性。第二列是固定值，标题的起始 x 才是结构上相等的。
    const css = readFileSync('products/market-intelligence/desktop/features/macro/economic-calendar/economicCalendar.css', 'utf8')
    expect(css).toMatch(/\.mi-economic-calendar__event\s*\{[^}]*grid-template-columns: var\(--mi-calendar-time-width\) var\(--mi-calendar-country-width\) minmax\(0, 1fr\)/)
    expect(css).toMatch(/--mi-calendar-country-width:\s*\d+px/)
    // 国家这一格自己不设宽度（宽度由列给），只负责「不撑开、超长省略」。
    const countryRule = css.slice(css.indexOf('.mi-economic-calendar__event-country {'))
    const countryBody = countryRule.slice(0, countryRule.indexOf('}'))
    expect(countryBody).toContain('overflow: hidden')
    expect(countryBody).toContain('text-overflow: ellipsis')
    expect(countryBody).not.toMatch(/(^|;)\s*width:/)

    await act(async () => root.render(<CalendarEventRow item={official} text={text} statusNow="2026-10-14T00:00:00.000Z" onSelect={() => {}} />))
    // The official route is US-only and says so in its own copy; a chip there would be noise.
    expect(host.querySelector('[data-event-country]')).toBeNull()
  } finally { await act(async () => root.unmount()) }
}, MOUNT_TIMEOUT_MS)

it('never leaves the country cell blank: an unmapped code is shown exactly as the source wrote it', async () => {
  // 用户 2026-11-16：名字是什么就显示什么。映射表只认两字母码，`USA` 查不到名字时**原样显示
  // `USA`**——空掉等于把「读不到」画成「没有」，整列会静默消失。名字命中时仍显示名字。
  const { CalendarEventRow } = await import('./CalendarEventRow')
  const text = productText['zh-CN'].pages.intelligence.portal.calendar
  const host = document.createElement('div'); const root = createRoot(host)
  const row = (event: Record<string, unknown>) => ({ key: 'market:x', source: 'market', date: '2026-10-14', time: '20:30', event }) as CalendarDayItem
  try {
    // ① 查不到名字 → 显示源给的原值，不替它改名、不猜
    await act(async () => root.render(<CalendarEventRow item={row({ eventKey: 'usa-cpi', title: '9月CPI', countryCode: 'USA', importance: 'high', eventType: 'economic-indicator' })} text={text} statusNow="2026-10-14T00:00:00.000Z" onSelect={() => {}} />))
    expect(host.querySelector('[data-event-country]')?.textContent).toBe('USA')
    expect(host.querySelector('.mi-economic-calendar__event-title')?.textContent).toBe('9月CPI')
    expect(host.querySelector('button')?.getAttribute('aria-label')).toContain('USA')

    // ② 映射命中 → 显示名字，不是码
    await act(async () => root.render(<CalendarEventRow item={row({ eventKey: 'us-cpi', title: '9月CPI', countryCode: 'US', countryName: '美国', importance: 'high', eventType: 'economic-indicator' })} text={text} statusNow="2026-10-14T00:00:00.000Z" onSelect={() => {}} />))
    expect(host.querySelector('[data-event-country]')?.textContent).toBe('美国')

    // ③ 两者都没有 → 显示「未知国家」（不是空白、不是「—」），事件本身照常
    await act(async () => root.render(<CalendarEventRow item={row({ eventKey: 'no-country', title: '无国家的事件', importance: 'high', eventType: 'economic-indicator', scheduledAt: '2026-10-13T00:00:00.000Z', providerActual: { displayValue: '1.2' } })} text={text} statusNow="2026-10-14T00:00:00.000Z" onSelect={() => {}} />))
    expect(host.querySelector('[data-event-country]')?.textContent).toBe('未知国家')
    expect(host.querySelector('.mi-economic-calendar__event-time')?.textContent).toBe('20:30')
    expect(host.textContent).toContain('无国家的事件')
    expect(host.querySelector('button')?.getAttribute('data-event-status')).toBe('data-received')
  } finally { await act(async () => root.unmount()) }
}, MOUNT_TIMEOUT_MS)

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
}, MOUNT_TIMEOUT_MS)

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
    // 2026-11-16 五态口径：过期且没值 = **待补值**。以前这里读「待发布」，正是用户 11-10 CPI
    // 那幕的直接来源（发布完了还当没发）。断言改成新词，语义没放宽。
    expect(host.querySelector('button')!.getAttribute('aria-label')).toContain('待补值')

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
}, MOUNT_TIMEOUT_MS)
it('marks a high-importance row before its name, on the calendar cell and the day list alike', async () => {
  const { CalendarEventRow } = await import('./CalendarEventRow')
  const text = productText['zh-CN'].pages.intelligence.portal.calendar
  const english = productText['en-US'].pages.intelligence.portal.calendar
  const host = document.createElement('div'); const root = createRoot(host)
  const market = (importance: 'high' | 'medium' | 'low') => ({ key: `market:${importance}`, source: 'market', date: '2026-09-10', time: '08:30',
    event: { eventKey: importance, title: 'Derived topic', importance, eventType: 'economic-indicator' } }) as CalendarDayItem
  const official = (importance?: 'high' | 'medium' | 'low') => ({ key: 'official:cpi', source: 'official', date: '2026-09-10', time: '08:30',
    event: { eventKey: 'US.CPI.RELEASE.2026-M09', labelKey: 'cpi', ...(importance === undefined ? {} : { importance }) } }) as CalendarDayItem
  // Both surfaces draw this same row, so one mark covers the cell and the standing day list.
  const render = async (item: CalendarDayItem, copy: EconomicCalendarText = text) => {
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

    await render(official('high'))
    expect(host.querySelector('[data-importance-marker]'), 'an official row is high because its record says so').not.toBeNull()

    // 官方行没带重要性就是「判不出」：不戴高标记，也不在无障碍名里说「高」。
    await render(official())
    expect(host.querySelector('[data-importance-marker]'), 'a record with no importance is not high').toBeNull()
    expect(host.querySelector('button')?.getAttribute('aria-label')).not.toContain(text.details.importance)

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
}, MOUNT_TIMEOUT_MS)
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
  const render = async (item: CalendarDayItem, copy: EconomicCalendarText = text) => {
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
}, MOUNT_TIMEOUT_MS)

it('marks a period that was released more than once, and stays silent when it was released once', async () => {
  // 合并之后同一期可能来自多次发布（GDP 二读/三读）：不显示次数，读者会把二读当初值。
  // 反向也钉住：1 次不显示——那是常态，挂上去就是噪声。
  const { CalendarEventRow } = await import('./CalendarEventRow')
  const text = productText['zh-CN'].pages.intelligence.portal.calendar
  const host = document.createElement('div'); const root = createRoot(host)
  const item = (releaseCount?: number) => ({ key: 'market:gdp', source: 'market', date: '2026-10-30', time: '08:30',
    event: { eventKey: 'gdp', title: 'GDP 年化', countryCode: 'US', countryName: '美国', importance: 'high',
      eventType: 'economic-indicator', scheduledAt: '2026-10-30T00:30:00.000Z', ...(releaseCount === undefined ? {} : { releaseCount }) } } as unknown as CalendarDayItem)
  try {
    await act(async () => root.render(<CalendarEventRow item={item(2)} text={text} statusNow="2026-10-30T07:00:00.000Z" onSelect={() => {}} repeatCountLabel="本期 {count} 次" />))
    expect(host.querySelector('[data-release-count]')?.textContent).toBe('本期 2 次')
    await act(async () => root.render(<CalendarEventRow item={item(undefined)} text={text} statusNow="2026-10-30T07:00:00.000Z" onSelect={() => {}} repeatCountLabel="本期 {count} 次" />))
    expect(host.querySelector('[data-release-count]')).toBeNull()
  } finally { await act(async () => root.unmount()) }
}, MOUNT_TIMEOUT_MS)
