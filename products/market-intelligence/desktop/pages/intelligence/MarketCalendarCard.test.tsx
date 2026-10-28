// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'
import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'
import { productText } from '../../shared/i18n/productText'
import { MarketCalendarCard } from './MarketCalendarCard'

const styles = readFileSync(resolve(process.cwd(), 'products/market-intelligence/desktop/pages/intelligence/intelligence.css'), 'utf8')

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
function calendarText(language: 'zh-CN' | 'en-US') {
  const portal = productText[language].pages.intelligence.portal
  return {
    ...portal.calendarCard,
    categories: portal.calendar.market.kinds,
    // 三条线的名字归跨资产那份词表（`crossAsset.assets`），卡片不再抄一份。
    assets: portal.dashboard.crossAsset.assets,
    readableNames: portal.analysisWorkspace.readableNames
  }
}
const text = calendarText('zh-CN')
const row = (overrides: Record<string, unknown> = {}) => ({
  eventKey: 'US.CPI.RELEASE.2026-M10', titleKey: 'cpi', month: '2026-10', date: '2026-10-13', at: '2026-10-13T12:30:00.000Z',
  importance: 'high' as const, kind: 'upcoming' as const, category: 'economic-indicator' as const, actual: null, previous: null, consensus: null,
  surprise: { direction: 'consensus-unavailable', value: null, unit: null, reason: 'missing-consensus' },
  awaitingData: false, ...overrides
})

async function render(node: React.ReactElement, language: 'zh-CN' | 'en-US' = 'zh-CN') {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(
    <ShellLanguageProvider language={language}><ShellTimeZoneProvider timeZone="UTC">{node}</ShellTimeZoneProvider></ShellLanguageProvider>
  ))
  return host
}

it('puts the provider country next to the kind chip, so two same-named events stay apart', async () => {
  const host = await render(<MarketCalendarCard projection={{ today: [], upcoming: [row({ titleKey: '9月未季调消费者物价指数(年率)', countryName: '美国' }), row({ eventKey: 'other', titleKey: '9月未季调消费者物价指数(年率)', countryName: '日本' })], state: 'available' }}
    onOpenCalendar={() => undefined} text={text} />)
  expect([...host.querySelectorAll('[data-country]')].map(node => node.textContent)).toEqual(['美国', '日本'])
})

it('never shows the raw event key, and shows a date when there is no clock time', async () => {
  const host = await render(<MarketCalendarCard projection={{ today: [], upcoming: [row({ titleKey: 'core-cpi', at: null, date: '2026-10-14' })], state: 'available' }}
    onOpenCalendar={() => undefined} text={text} />)
  expect(host.textContent).not.toContain('core-cpi')
  expect(host.textContent).toContain('核心 CPI')
  expect(host.textContent).toContain('10-14')
  expect(host.textContent).toContain('时间待定')
})

it('shows both sections with the event name, time and importance', async () => {
  const host = await render(<MarketCalendarCard projection={{ today: [row({ kind: 'released-changed', at: '2026-10-11T06:00:00.000Z', actual: '0.3%', previous: '0.1%', consensus: '0.2%' })], upcoming: [row()], state: 'available' }}
    onOpenCalendar={() => undefined} text={text} />)
  expect(host.textContent).toContain(text.title)
  expect(host.textContent).toContain(text.todaySection)
  expect(host.textContent).toContain(text.upcomingSection)
  expect(host.textContent).toContain('消费者物价指数（CPI）')
  // The row shows the day and the clock in the reader's zone, not the ISO instant.
  expect(host.textContent).toContain('10-13 12:30')
  expect(host.querySelectorAll('[data-calendar-card-row]')).toHaveLength(2)
  // A released row has to say what was published, next to what it is compared with.
  // The clock rides the title line, so the row has no half-empty time column.
  const firstRow = host.querySelector('.mi-calendar-card__row')!
  expect(firstRow.querySelector('.mi-calendar-card__row-main .mi-calendar-card__row-title time')?.textContent).toContain('10-11 06:00')
  expect(firstRow.querySelector('.mi-calendar-card__row-main .mi-calendar-card__row-title')?.textContent).toBeTruthy()
  expect(firstRow.querySelector('.mi-calendar-card__row-main .mi-calendar-card__row-value')?.textContent).toContain('实际值 0.3%')
  expect(host.textContent).toContain('实际值 0.3%')
  expect(host.textContent).toContain('市场预期 0.2%')
  expect(host.textContent).toContain('前值 0.1%')
})

it('names the event and its values in the reader language, not the conclusion language', async () => {
  const english = calendarText('en-US')
  const host = await render(<MarketCalendarCard projection={{ today: [], upcoming: [row({ titleKey: 'cpi', actual: '1.2%', previous: '-0.7%', consensus: '0.9%', kind: 'released-changed' })], state: 'available' }}
    onOpenCalendar={() => undefined} text={english} />)
  expect(host.textContent).toContain(english.title)
  expect(host.textContent).toContain('CPI')
  expect(host.textContent).toContain('Actual 1.2%')
  expect(host.textContent).toContain('Previous -0.7%')
  expect(host.textContent).toContain('Consensus 0.9%')
  expect(host.textContent).not.toContain('实际值')
  expect(host.textContent).not.toContain('前值')
  expect(host.textContent).not.toContain('消费者物价指数')
})

it('reports an empty window instead of rendering nothing', async () => {
  const host = await render(<MarketCalendarCard projection={{ today: [], upcoming: [], state: 'empty' }}
    onOpenCalendar={() => undefined} text={text} />)
  expect(host.textContent).toContain(text.empty)
})

it('reports unavailable data and offers a refresh', async () => {
  const onRefresh = vi.fn()
  const host = await render(<MarketCalendarCard projection={{ today: [], upcoming: [], state: 'unavailable' }}
    onOpenCalendar={() => undefined} onRefresh={onRefresh} text={text} />)
  expect(host.textContent).toContain(text.unavailable)
  await act(async () => host.querySelector('button.ant-btn')?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
  expect(onRefresh).toHaveBeenCalledTimes(1)
})

it('copies a row instead of navigating, and keeps the calendar action for the month', async () => {
  const written: string[] = []
  // happy-dom exposes `clipboard` as a getter-only property, so it is defined rather than assigned.
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (value: string) => { written.push(value) } } })
  const onOpenCalendar = vi.fn()
  const host = await render(<MarketCalendarCard projection={{ today: [], upcoming: [row()], state: 'available' }}
    onOpenCalendar={onOpenCalendar} text={text} />)
  // Rows are text to copy, not links: there is no row callback any more.
  await act(async () => host.querySelector<HTMLButtonElement>('.mi-calendar-card__copy')!.click())
  expect(written).toEqual(['10-13 12:30 经济指标 消费者物价指数（CPI）'])
  expect(onOpenCalendar).not.toHaveBeenCalled()
  await act(async () => host.querySelector<HTMLButtonElement>('.mi-calendar-card__open')!.click())
  expect(onOpenCalendar).toHaveBeenCalledWith('2026-10')
})

it('hands a selected row to the caller as the agent context, and a copy click does not select', async () => {
  const onSelectEvent = vi.fn()
  const written: string[] = []
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (value: string) => { written.push(value) } } })
  const host = await render(<MarketCalendarCard projection={{ today: [], upcoming: [row()], state: 'available' }}
    onOpenCalendar={() => undefined} onSelectEvent={onSelectEvent} selectedEventKey="US.CPI.RELEASE.2026-M10" text={text} />)
  const line = host.querySelector<HTMLElement>('[data-calendar-card-row]')!
  expect(line.getAttribute('aria-pressed')).toBe('true')
  expect(line.getAttribute('data-selected')).toBe('true')
  await act(async () => line.click())
  expect(onSelectEvent).toHaveBeenCalledWith('US.CPI.RELEASE.2026-M10', '10-13 12:30 经济指标 消费者物价指数（CPI）', '2026-10')
  // Copying a row must not disturb the selection it is sitting in.
  await act(async () => host.querySelector<HTMLButtonElement>('.mi-calendar-card__copy')!.click())
  expect(written).toHaveLength(1)
  expect(onSelectEvent).toHaveBeenCalledTimes(1)
})

it('opens the whole calendar at one row without disturbing the selection', async () => {
  const onOpenEventInCalendar = vi.fn()
  const onSelectEvent = vi.fn()
  const host = await render(<MarketCalendarCard projection={{ today: [], upcoming: [row()], state: 'available' }}
    onOpenCalendar={() => undefined} onOpenEventInCalendar={onOpenEventInCalendar} onSelectEvent={onSelectEvent} text={text} />)

  // A row click selects the event as the agent's context; the calendar jump is a separate control.
  await act(async () => host.querySelector<HTMLButtonElement>('.mi-calendar-card__open-event')!.click())
  expect(onOpenEventInCalendar).toHaveBeenCalledWith('US.CPI.RELEASE.2026-M10', '2026-10')
  expect(onSelectEvent).not.toHaveBeenCalled()
})

it('offers no calendar jump when the card has no such action to hand over', async () => {
  const host = await render(<MarketCalendarCard projection={{ today: [], upcoming: [row()], state: 'available' }}
    onOpenCalendar={() => undefined} text={text} />)
  expect(host.querySelector('.mi-calendar-card__open-event')).toBeNull()
})

it('is keyboard selectable, because a row that selects must be reachable without a mouse', async () => {
  const onSelectEvent = vi.fn()
  const host = await render(<MarketCalendarCard projection={{ today: [], upcoming: [row()], state: 'available' }}
    onOpenCalendar={() => undefined} onSelectEvent={onSelectEvent} text={text} />)
  const line = host.querySelector<HTMLElement>('[data-calendar-card-row]')!
  await act(async () => { line.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' })) })
  expect(onSelectEvent).toHaveBeenCalledTimes(1)
})

it('says which row is waiting for its value, and only that row', async () => {
  // 读者 2026-10-16：已到发布时刻、值没到，要能看出是**哪一个**在等。标记落在那条事件自己的行上。
  const host = await render(<MarketCalendarCard projection={{ today: [], state: 'available', upcoming: [
    row({ titleKey: 'core-cpi', awaitingData: true }),
    row({ eventKey: 'other', titleKey: 'cpi' })
  ] }}
    onOpenCalendar={() => undefined} text={text} />)
  const markers = [...host.querySelectorAll('[data-calendar-card-waiting]')]
  expect(markers).toHaveLength(1)
  expect(markers[0]!.textContent).toBe(text.awaitingData)
  const waitingRow = markers[0]!.closest('li')!
  const rows = [...host.querySelectorAll('li')]
  expect(rows.indexOf(waitingRow)).toBe(0)
  expect(waitingRow.textContent).toContain('核心 CPI')
  expect(rows[1]!.querySelector('[data-calendar-card-waiting]')).toBeNull()
})

/**
 * 「±30 分」反应（原型 ④）：已公布的行下面那一行 QQQ/BTC/ETH。
 *
 * 它是行情事实，不是判断——数字用跨资产面板同一套格式（`crossAssetSignedValue`），所以表格里写
 * 「+0.31%」的地方，这里也是同一串字符。
 */
it('shows the ±30 minute reaction of the three lines on a released row', async () => {
  const host = await render(<MarketCalendarCard projection={{ today: [row({ kind: 'released-changed', actual: '0.3%', previous: '0.1%', consensus: '0.2%', reaction: { index: -0.12, btc: -0.18, eth: -0.21 } })], upcoming: [], state: 'available' }}
    onOpenCalendar={() => undefined} text={text} />)
  const line = host.querySelector('[data-calendar-card-reaction]')
  expect(line?.textContent).toContain(text.reactionWindow)
  expect(line?.textContent).toContain('QQQ')
  expect(line?.textContent).toContain('−0.12%')
  expect(line?.textContent).toContain('BTC')
  expect(line?.textContent).toContain('−0.18%')
  expect(line?.textContent).toContain('ETH')
  expect(line?.textContent).toContain('−0.21%')
  // 行上原本的值一条都不能少：反应是加在它们下面的，不是替换。
  expect(host.textContent).toContain('实际值 0.3%')
})

it('prints only the lines that answered, and nothing at all when none did', async () => {
  const partial = await render(<MarketCalendarCard projection={{ today: [row({ kind: 'released-changed', reaction: { index: 0.31, btc: null, eth: 0.28 } })], upcoming: [], state: 'available' }}
    onOpenCalendar={() => undefined} text={text} />)
  const line = partial.querySelector('[data-calendar-card-reaction]')
  expect(line?.textContent).toContain('+0.31%')
  expect(line?.textContent).toContain('+0.28%')
  // 那一条没答出来的线连名字都不印：印个名字配「—」只会让读者以为它是 0。
  expect(line?.textContent).not.toContain('BTC')

  const none = await render(<MarketCalendarCard projection={{ today: [row({ kind: 'released-changed' })], upcoming: [], state: 'available' }}
    onOpenCalendar={() => undefined} text={text} />)
  expect(none.querySelector('[data-calendar-card-reaction]')).toBeNull()
  // 还没发布的行没有反应可看。
  const upcoming = await render(<MarketCalendarCard projection={{ today: [], upcoming: [row({ reaction: { index: 0.31, btc: 0.22, eth: 0.28 } })], state: 'available' }}
    onOpenCalendar={() => undefined} text={text} />)
  expect(upcoming.querySelector('[data-calendar-card-reaction]')).toBeNull()
})

it('states a beat with its presentation unit, in the reader language', async () => {
  const released = (language: 'zh-CN' | 'en-US') => render(<MarketCalendarCard projection={{ today: [row({
    kind: 'released-changed', actual: '3.4%', consensus: '3.1%',
    surprise: { direction: 'beat', value: 0.2999999999999998, unit: 'pp', reason: null }
  })], upcoming: [], state: 'available' }} onOpenCalendar={() => undefined} text={calendarText(language)} />, language)

  const chinese = await released('zh-CN')
  const chip = chinese.querySelector('[data-calendar-surprise="beat"]')
  expect(chip?.textContent).toBe('超预期 +0.3 个百分点')
  // The verdict lives on its own line, not twice on the value line.
  expect(chinese.querySelector('.mi-calendar-card__row-value')?.textContent).not.toContain('超预期')

  const english = await released('en-US')
  const englishChip = english.querySelector('[data-calendar-surprise="beat"]')
  expect(englishChip?.textContent).toBe('Above expectation +0.3pp')
})

it('says "no consensus" without printing any number as the difference', async () => {
  const host = await render(<MarketCalendarCard projection={{ today: [row({
    kind: 'released-changed', actual: '3.4%', consensus: null,
    surprise: { direction: 'consensus-unavailable', value: null, unit: null, reason: 'missing-consensus' }
  })], upcoming: [], state: 'available' }} onOpenCalendar={() => undefined} text={text} />)

  const chip = host.querySelector('[data-calendar-surprise="unavailable"]')
  expect(chip?.textContent).toBe(text.surprise.unavailable)
  expect(chip?.textContent).not.toMatch(/[\d—−]/)
})

it('says the difference is not comparable when both values exist but cannot be compared', async () => {
  const host = await render(<MarketCalendarCard projection={{ today: [row({
    kind: 'released-changed', actual: '250K', consensus: '240K',
    surprise: { direction: 'consensus-unavailable', value: null, unit: null, reason: 'non-numeric' }
  })], upcoming: [], state: 'available' }} onOpenCalendar={() => undefined} text={text} />)

  const chip = host.querySelector('[data-calendar-surprise="unavailable"]')
  expect(chip?.textContent).toBe(text.surprise.notComparable)
  expect(chip?.textContent).not.toMatch(/[\d—−]/)
})

it('calls an in-line release in line without adding a zero difference', async () => {
  const host = await render(<MarketCalendarCard projection={{ today: [row({
    kind: 'released-changed', actual: '3.1%', consensus: '3.1%',
    surprise: { direction: 'inline', value: 0, unit: 'pp', reason: null }
  })], upcoming: [], state: 'available' }} onOpenCalendar={() => undefined} text={text} />)

  const chip = host.querySelector('[data-calendar-surprise="inline"]')
  expect(chip?.textContent).toBe(text.surprise.inline)
  expect(chip?.textContent).not.toMatch(/\d/)
})

it('copies the surprise with the row, and gives an upcoming row no surprise at all', async () => {
  const written: string[] = []
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (value: string) => { written.push(value) } } })
  const host = await render(<MarketCalendarCard projection={{ today: [row({
    kind: 'released-changed', actual: '165', consensus: '150',
    surprise: { direction: 'beat', value: 10.000000000000002, unit: 'relative-percent', reason: null }
  })], upcoming: [row({ eventKey: 'upcoming' })], state: 'available' }} onOpenCalendar={() => undefined} text={text} />)

  await act(async () => host.querySelector<HTMLButtonElement>('.mi-calendar-card__copy')!.click())
  expect(written[0]).toContain('超预期 +10%')
  // Only the released row carries a verdict; a scheduled event has nothing to compare yet.
  expect(host.querySelectorAll('[data-calendar-surprise]')).toHaveLength(1)
})

it('styles the verdict as a coloured badge, with the direction distinguishable', () => {
  const beat = styles.slice(styles.indexOf(".mi-calendar-card__row-surprise[data-calendar-surprise='beat']"))
  const miss = styles.slice(styles.indexOf(".mi-calendar-card__row-surprise[data-calendar-surprise='miss']"))
  expect(beat).toContain('background: color-mix')
  expect(beat).toContain('var(--accent)')
  expect(miss).toContain('var(--danger)')
  expect(styles).toContain('font-weight: 650')
  // The row is one content column; the clock is no longer a separate 84px column.
  expect(styles).toContain('.mi-calendar-card__row { display: grid; grid-template-columns: minmax(0, 1fr) auto;')
  expect(styles).not.toContain('grid-template-columns: 84px minmax(0, 1fr) auto')
})
