// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'
import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'
import { productText } from '../../shared/i18n/productText'
import { resolveProductTextKey } from '../../shared/i18n/productTextKey'
import { MarketCalendarCard } from './MarketCalendarCard'
import type { CalendarCardRow } from './projectUpcomingCalendarCard'

const styles = readFileSync(resolve(process.cwd(), 'products/market-intelligence/desktop/pages/intelligence/intelligence.css'), 'utf8')

function calendarText(language: 'zh-CN' | 'en-US') {
  const portal = productText[language].pages.intelligence.portal
  return {
    ...portal.calendarCard,
    // The card's own short labels, not the calendar page's: the rail is 84px wide.
    categories: portal.calendarCard.categories,
    // 三条线的名字归跨资产那份词表（`crossAsset.assets`），卡片不再抄一份。
    assets: portal.dashboard.crossAsset.assets,
    readableNames: portal.analysisWorkspace.readableNames
  }
}
const text = calendarText('zh-CN')
/** 夹具按域类型写：`Record<string, unknown>` 会把 `surprise.direction` 放宽成 `string`，整条行就对不上了。 */
const row = (overrides: Partial<CalendarCardRow> = {}): CalendarCardRow => ({
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

it('says "sources are not enabled" as one whole-card line with one action, not an empty list', async () => {
  // 三态之二（共享类）：没启用不是「确实没有」。整卡一句 + 一颗动作，正文不出现空列表/「暂无」。
  const host = await render(<MarketCalendarCard projection={{ today: [], upcoming: [row()], state: 'available' }}
    sourcesState="disabled" onOpenCalendar={() => undefined} onRefresh={() => undefined} text={text} />)
  const card = host.querySelector('.mi-source-card')
  expect(card?.getAttribute('data-state')).toBe('disabled')
  const sentence = host.querySelector('.mi-source-state')
  expect(sentence?.getAttribute('data-state')).toBe('disabled')
  expect(sentence?.textContent).toContain(productText['zh-CN'].pages.intelligence.portal.data.sourcesNotEnabled)
  // 一颗动作：去启用（共享文案键，不写字面量）。
  const actions = card?.querySelectorAll('button') ?? []
  expect(actions).toHaveLength(1)
  expect(actions[0]?.textContent).toBe(productText['zh-CN'].pages.intelligence.portal.data.enableSources)
  // 不画列表、不摆「本月没有」。
  expect(host.querySelector('.mi-calendar-card__list')).toBeNull()
  expect(host.textContent).not.toContain(text.empty)
})

it('says "no source configured" with the configure action, still one line and one action', async () => {
  const host = await render(<MarketCalendarCard projection={{ today: [], upcoming: [], state: 'empty' }}
    sourcesState="missing" onOpenCalendar={() => undefined} onRefresh={() => undefined} text={text} />)
  const sentence = host.querySelector('.mi-source-state')
  expect(sentence?.getAttribute('data-state')).toBe('missing')
  expect(sentence?.textContent).toContain(productText['zh-CN'].pages.intelligence.portal.data.sourcesNotConfigured)
  const actions = host.querySelector('.mi-source-card')?.querySelectorAll('button') ?? []
  expect(actions).toHaveLength(1)
  expect(actions[0]?.textContent).toBe(productText['zh-CN'].pages.intelligence.portal.data.configureSources)
  // 未配置不用错误色：图标只在读不到那一态用 danger（类名约定，样式在共享表里）。
  expect(host.querySelector('.mi-source-state')?.getAttribute('data-state')).not.toBe('unreadable')
})

it('puts the provider country next to the kind chip, so two same-named events stay apart', async () => {
  const host = await render(<MarketCalendarCard projection={{ today: [], upcoming: [row({ titleKey: '9月未季调消费者物价指数(年率)', countryName: '美国' }), row({ eventKey: 'other', titleKey: '9月未季调消费者物价指数(年率)', countryName: '日本' })], state: 'available' }}
    onOpenCalendar={() => undefined} onRefresh={() => undefined} text={text} />)
  expect([...host.querySelectorAll('[data-country]')].map(node => node.textContent)).toEqual(['美国', '日本'])
})

it('never shows the raw event key, and shows a date when there is no clock time', async () => {
  const host = await render(<MarketCalendarCard projection={{ today: [], upcoming: [row({ titleKey: 'core-cpi', at: null, date: '2026-10-14' })], state: 'available' }}
    onOpenCalendar={() => undefined} onRefresh={() => undefined} text={text} />)
  expect(host.textContent).not.toContain('core-cpi')
  expect(host.textContent).toContain('核心 CPI')
  expect(host.textContent).toContain('10-14')
  expect(host.textContent).toContain('时间待定')
})

it('shows both sections with the event name, time and importance', async () => {
  const host = await render(<MarketCalendarCard projection={{ today: [row({ kind: 'released-changed', at: '2026-10-11T06:00:00.000Z', actual: '0.3%', previous: '0.1%' })], upcoming: [row()], state: 'available' }}
    onOpenCalendar={() => undefined} onRefresh={() => undefined} text={text} />)
  expect(host.textContent).toContain(text.title)
  expect(host.textContent).toContain(text.todaySection)
  expect(host.textContent).toContain(text.upcomingSection)
  expect(host.textContent).toContain('消费者物价指数（CPI）')
  // The row shows the day and the clock in the reader's zone, not the ISO instant.
  expect(host.textContent).toContain('10-13 12:30')
  expect(host.querySelectorAll('[data-calendar-card-row]')).toHaveLength(2)
  // Without a statable surprise the readings stay: the card has no verdict to replace them with.
  // The clock and the kind share the left metadata rail; the right side is the event stack.
  const firstRow = host.querySelector('.mi-calendar-card__row')!
  expect(firstRow.querySelector('.mi-calendar-card__row-when time')?.textContent).toContain('10-11 06:00')
  expect(firstRow.querySelector('.mi-calendar-card__row-when .mi-calendar-card__row-kind')?.textContent).toBe('经济指标')
  expect(firstRow.querySelector('.mi-calendar-card__row-main .mi-calendar-card__row-title')?.textContent).not.toContain('经济指标')
  expect(firstRow.querySelector('.mi-calendar-card__row-main .mi-calendar-card__row-value')?.textContent).toContain('实际值 0.3%')
  expect(host.textContent).toContain('实际值 0.3%')
  expect(host.textContent).toContain('前值 0.1%')
  // No verdict to state: the readings speak for themselves instead of an extra "no consensus" badge.
  expect(firstRow.querySelector('[data-calendar-surprise]')).toBeNull()
})

it('replaces the three readings with the verdict when the surprise is statable', async () => {
  const host = await render(<MarketCalendarCard projection={{ today: [row({ kind: 'released-changed', at: '2026-10-11T06:00:00.000Z', actual: '3.4%', previous: '3.4%', consensus: '3.1%',
    surprise: { direction: 'beat', value: 0.2999999999999998, unit: 'pp', reason: null } })], upcoming: [], state: 'available' }}
    onOpenCalendar={() => undefined} onRefresh={() => undefined} text={text} />)

  const firstRow = host.querySelector('.mi-calendar-card__row')!
  expect(firstRow.querySelector('.mi-calendar-card__row-value')).toBeNull()
  expect(firstRow.querySelector('[data-calendar-surprise="beat"]')?.textContent).toBe('超预期 +0.3 个百分点')
  // The values are not printed anywhere on the card once the verdict states the difference.
  expect(host.textContent).not.toContain('实际值 3.4%')
  expect(host.textContent).not.toContain('市场预期 3.1%')
  expect(host.textContent).not.toContain('前值 3.4%')
})

it('names the event and its values in the reader language, not the conclusion language', async () => {
  const english = calendarText('en-US')
  const host = await render(<MarketCalendarCard projection={{ today: [], upcoming: [row({ titleKey: 'cpi', actual: '1.2%', previous: '-0.7%', consensus: '0.9%', kind: 'released-changed' })], state: 'available' }}
    onOpenCalendar={() => undefined} onRefresh={() => undefined} text={english} />)
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
    onOpenCalendar={() => undefined} onRefresh={() => undefined} text={text} />)
  expect(host.textContent).toContain(text.empty)
})

it('reports a readable failure through the shared state view and offers a retry', async () => {
  const onRefresh = vi.fn()
  const host = await render(<MarketCalendarCard state="error" projection={{ today: [], upcoming: [], state: 'empty' }}
    onOpenCalendar={() => undefined} onRefresh={onRefresh} text={text} />)
  // The sentence now comes from the platform's state table; the card no longer owns a copy of it.
  expect(host.textContent).not.toContain(text.unavailable)
  expect(host.querySelector('.state-view')).not.toBeNull()
  await act(async () => host.querySelector('.state-view__action')?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
  expect(onRefresh).toHaveBeenCalledTimes(1)
})

it('copies a row instead of navigating, and keeps the calendar action for the month', async () => {
  const written: string[] = []
  // happy-dom exposes `clipboard` as a getter-only property, so it is defined rather than assigned.
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (value: string) => { written.push(value) } } })
  const onOpenCalendar = vi.fn()
  const host = await render(<MarketCalendarCard projection={{ today: [], upcoming: [row()], state: 'available' }}
    onOpenCalendar={onOpenCalendar} onRefresh={() => undefined} text={text} />)
  // Rows are text to copy, not links: there is no row callback any more.
  await act(async () => host.querySelector<HTMLButtonElement>('[data-calendar-row-action="copy"] button')!.click())
  expect(written).toEqual(['10-13 12:30 经济指标 消费者物价指数（CPI）'])
  expect(onOpenCalendar).not.toHaveBeenCalled()
  // The header action is the shared icon button now; its accessible name is the product key's sentence.
  const openLabel = resolveProductTextKey('zh-CN', 'pages.intelligence.portal.calendarCard.openCalendar')
  await act(async () => host.querySelector<HTMLButtonElement>(`button[aria-label="${openLabel}"]`)!.click())
  expect(onOpenCalendar).toHaveBeenCalledWith('2026-10')
})

it('hands a selected row to the caller as the agent context, and a copy click does not select', async () => {
  const onSelectEvent = vi.fn()
  const written: string[] = []
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (value: string) => { written.push(value) } } })
  const host = await render(<MarketCalendarCard onRefresh={() => undefined} projection={{ today: [], upcoming: [row()], state: 'available' }}
    onOpenCalendar={() => undefined} onSelectEvent={onSelectEvent} selectedEventKey="US.CPI.RELEASE.2026-M10" text={text} />)
  const line = host.querySelector<HTMLElement>('[data-calendar-card-row]')!
  expect(line.getAttribute('aria-pressed')).toBe('true')
  expect(line.getAttribute('data-selected')).toBe('true')
  await act(async () => line.click())
  expect(onSelectEvent).toHaveBeenCalledWith('US.CPI.RELEASE.2026-M10', '10-13 12:30 经济指标 消费者物价指数（CPI）', '2026-10')
  // Copying a row must not disturb the selection it is sitting in.
  await act(async () => host.querySelector<HTMLButtonElement>('[data-calendar-row-action="copy"] button')!.click())
  expect(written).toHaveLength(1)
  expect(onSelectEvent).toHaveBeenCalledTimes(1)
})

it('opens the whole calendar at one row without disturbing the selection', async () => {
  const onOpenEventInCalendar = vi.fn()
  const onSelectEvent = vi.fn()
  const host = await render(<MarketCalendarCard onRefresh={() => undefined} projection={{ today: [], upcoming: [row()], state: 'available' }}
    onOpenCalendar={() => undefined} onOpenEventInCalendar={onOpenEventInCalendar} onSelectEvent={onSelectEvent} text={text} />)

  // A row click selects the event as the agent's context; the calendar jump is a separate control.
  await act(async () => host.querySelector<HTMLButtonElement>('[data-calendar-row-action="open-event"] button')!.click())
  expect(onOpenEventInCalendar).toHaveBeenCalledWith('US.CPI.RELEASE.2026-M10', '2026-10')
  expect(onSelectEvent).not.toHaveBeenCalled()
})

it('offers no calendar jump when the card has no such action to hand over', async () => {
  const host = await render(<MarketCalendarCard projection={{ today: [], upcoming: [row()], state: 'available' }}
    onOpenCalendar={() => undefined} onRefresh={() => undefined} text={text} />)
  expect(host.querySelector('[data-calendar-row-action="open-event"]')).toBeNull()
})

it('is keyboard selectable, because a row that selects must be reachable without a mouse', async () => {
  const onSelectEvent = vi.fn()
  const host = await render(<MarketCalendarCard onRefresh={() => undefined} projection={{ today: [], upcoming: [row()], state: 'available' }}
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
    onOpenCalendar={() => undefined} onRefresh={() => undefined} text={text} />)
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
 * 「±30 分」反应（原型 ④）：已公布的行下面那一行 QQQ/BTC/ETH/美元。
 *
 * 它是行情事实，不是判断——数字用跨资产面板同一套格式（`crossAssetSignedValue`），所以表格里写
 * 「+0.31%」的地方，这里也是同一串字符。
 */
it('shows the ±30 minute reaction of the four lines on a released row', async () => {
  const host = await render(<MarketCalendarCard projection={{ today: [row({ kind: 'released-changed', actual: '0.3%', previous: '0.1%', reaction: { index: -0.12, btc: -0.18, eth: -0.21, dxy: 0.14 } })], upcoming: [], state: 'available' }}
    onOpenCalendar={() => undefined} onRefresh={() => undefined} text={text} />)
  const line = host.querySelector('[data-calendar-card-reaction]')
  // The reaction starts on the content column and may run to the card's right edge.
  expect(line?.closest('.mi-calendar-card__row')).not.toBeNull()
  expect(line?.textContent).not.toContain('±30')
  // The window is explained on hover by the same styled tooltip the agent controls use, not a
  // native title (which is slow and brings the question-mark cursor).
  await act(async () => { line?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })) })
  // 条件是「提示出现」，不是「等 300ms」：轮询一成立就返回，上限由 `vi.waitFor` 自己兜住。
  // 真等一段固定时长在慢机器上会红、在快机器上白等，也是「同一提交两次跑结果不一致」的来源。
  await vi.waitFor(() => { expect(document.body.textContent).toContain(text.reactionHint) })
  expect(line?.textContent).toContain('QQQ')
  expect(line?.textContent).toContain('−0.12%')
  expect(line?.textContent).toContain('BTC')
  expect(line?.textContent).toContain('−0.18%')
  expect(line?.textContent).toContain('ETH')
  expect(line?.textContent).toContain('−0.21%')
  // The dollar is a macro-proxy curve, not one of the three collected symbols.
  expect(line?.textContent).toContain(text.dxy)
  expect(line?.textContent).toContain('+0.14%')
  // No statable surprise on this row, so its readings stay above the reaction.
  expect(host.textContent).toContain('实际值 0.3%')
})

it('prints only the lines that answered, and nothing at all when none did', async () => {
  const partial = await render(<MarketCalendarCard projection={{ today: [row({ kind: 'released-changed', reaction: { index: 0.31, btc: null, eth: 0.28, dxy: 0 } })], upcoming: [], state: 'available' }}
    onOpenCalendar={() => undefined} onRefresh={() => undefined} text={text} />)
  const line = partial.querySelector('[data-calendar-card-reaction]')
  expect(line?.textContent).toContain('+0.31%')
  expect(line?.textContent).toContain('+0.28%')
  expect(line?.textContent).not.toContain(text.dxy)
  // 那一条没答出来的线连名字都不印：印个名字配「—」只会让读者以为它是 0。
  expect(line?.textContent).not.toContain('BTC')

  const none = await render(<MarketCalendarCard projection={{ today: [row({ kind: 'released-changed' })], upcoming: [], state: 'available' }}
    onOpenCalendar={() => undefined} onRefresh={() => undefined} text={text} />)
  expect(none.querySelector('[data-calendar-card-reaction]')).toBeNull()
  // 还没发布的行没有反应可看。
  const upcoming = await render(<MarketCalendarCard projection={{ today: [], upcoming: [row({ reaction: { index: 0.31, btc: 0.22, eth: 0.28, dxy: 0.05 } })], state: 'available' }}
    onOpenCalendar={() => undefined} onRefresh={() => undefined} text={text} />)
  expect(upcoming.querySelector('[data-calendar-card-reaction]')).toBeNull()
})

it('states a beat with its presentation unit, in the reader language', async () => {
  const released = (language: 'zh-CN' | 'en-US') => render(<MarketCalendarCard onRefresh={() => undefined} projection={{ today: [row({
    kind: 'released-changed', actual: '3.4%', consensus: '3.1%',
    surprise: { direction: 'beat', value: 0.2999999999999998, unit: 'pp', reason: null }
  })], upcoming: [], state: 'available' }} onOpenCalendar={() => undefined} text={calendarText(language)} />, language)

  const chinese = await released('zh-CN')
  const chip = chinese.querySelector('[data-calendar-surprise="beat"]')
  expect(chip?.textContent).toBe('超预期 +0.3 个百分点')
  // The verdict lives on its own line; the readings are hidden, not duplicated.
  expect(chinese.querySelector('.mi-calendar-card__row-value')).toBeNull()

  const english = await released('en-US')
  const englishChip = english.querySelector('[data-calendar-surprise="beat"]')
  expect(englishChip?.textContent).toBe('Above expectation +0.3pp')
})

it('does not repeat "no consensus" as a badge; the readings already say it', async () => {
  const host = await render(<MarketCalendarCard projection={{ today: [row({
    kind: 'released-changed', actual: '3.4%', consensus: null,
    surprise: { direction: 'consensus-unavailable', value: null, unit: null, reason: 'missing-consensus' }
  })], upcoming: [], state: 'available' }} onOpenCalendar={() => undefined} onRefresh={() => undefined} text={text} />)

  expect(host.querySelector('[data-calendar-surprise]')).toBeNull()
  expect(host.querySelector('.mi-calendar-card__row-value')?.textContent).toContain('实际值 3.4%')
  expect(host.textContent).not.toContain(text.surprise.unavailable)
})

it('says the difference is not comparable when both values exist but cannot be compared', async () => {
  const host = await render(<MarketCalendarCard projection={{ today: [row({
    kind: 'released-changed', actual: '250K', consensus: '240K',
    surprise: { direction: 'consensus-unavailable', value: null, unit: null, reason: 'non-numeric' }
  })], upcoming: [], state: 'available' }} onOpenCalendar={() => undefined} onRefresh={() => undefined} text={text} />)

  // Here the readings exist but no difference can be stated, so the badge explains why.
  expect(host.querySelector('.mi-calendar-card__row-value')?.textContent).toContain('实际值 250K')
  const chip = host.querySelector('[data-calendar-surprise="unavailable"]')
  expect(chip?.textContent).toBe(text.surprise.notComparable)
  expect(chip?.textContent).not.toMatch(/[\d—−]/)
})

it('calls an in-line release in line without adding a zero difference', async () => {
  const host = await render(<MarketCalendarCard projection={{ today: [row({
    kind: 'released-changed', actual: '3.1%', consensus: '3.1%',
    surprise: { direction: 'inline', value: 0, unit: 'pp', reason: null }
  })], upcoming: [], state: 'available' }} onOpenCalendar={() => undefined} onRefresh={() => undefined} text={text} />)

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
  })], upcoming: [row({ eventKey: 'upcoming' })], state: 'available' }} onOpenCalendar={() => undefined} onRefresh={() => undefined} text={text} />)

  await act(async () => host.querySelector<HTMLButtonElement>('[data-calendar-row-action="copy"] button')!.click())
  expect(written[0]).toContain('超预期 +10%')
  // The clipboard mirrors the row: no readings when the verdict replaced them.
  expect(written[0]).not.toContain('实际值 165')
  expect(written[0]).not.toContain('市场预期 150')
  // Only the released row carries a verdict; a scheduled event has nothing to compare yet.
  expect(host.querySelectorAll('[data-calendar-surprise]')).toHaveLength(1)
})

it('scrolls only the rows: the header stays outside the scroll region', async () => {
  const host = await render(<MarketCalendarCard projection={{ today: [row({ kind: 'released-changed' })], upcoming: [row({ eventKey: 'later' })], state: 'available' }}
    onOpenCalendar={() => undefined} onRefresh={() => undefined} text={text} />)

  const body = host.querySelector('.mi-calendar-card__body')
  expect(body).not.toBeNull()
  // The title and the calendar action sit in the card's own header, not inside the scroller.
  expect(body!.querySelector('header')).toBeNull()
  expect(host.querySelector('.mi-calendar-card > header h2')?.textContent).toBe(text.title)
  // Everything that can grow with the schedule is inside it, sections included.
  expect(body!.querySelectorAll('[data-calendar-card-row]')).toHaveLength(2)
  expect(body!.querySelectorAll('.mi-calendar-card__section')).toHaveLength(2)
  // The card clips; the body owns the scrollbar, so the header cannot scroll away with the rows.
  expect(styles).toContain('.mi-calendar-card { display: flex; flex-direction: column; min-height: 0; overflow: hidden;')
  const bodyStart = styles.indexOf('.mi-calendar-card__body {')
  const bodyRule = styles.slice(bodyStart, styles.indexOf('}', bodyStart))
  expect(bodyRule).toContain('overflow: auto')
  expect(bodyRule).toContain('min-height: 0')
})

it('styles the verdict as a coloured badge, with the direction distinguishable', () => {
  const beat = styles.slice(styles.indexOf(".mi-calendar-card__row-surprise[data-calendar-surprise='beat']"))
  const miss = styles.slice(styles.indexOf(".mi-calendar-card__row-surprise[data-calendar-surprise='miss']"))
  expect(beat).toContain('background: color-mix')
  expect(beat).toContain('var(--accent)')
  expect(miss).toContain('var(--danger)')
  expect(styles).toContain('font-weight: 650')
  expect(styles).toContain('.mi-calendar-card__row-reaction { display: flex; grid-column: 2 / -1; flex-wrap: wrap;')
  // The row keeps the metadata rail; the gutter is deliberate, not an empty time column.
  expect(styles).toContain('.mi-calendar-card__row { display: grid; grid-template-columns: 84px minmax(0, 1fr) auto;')
  expect(styles).toContain('.mi-calendar-card__row-when { display: flex; grid-row: 1 / span 2; flex-direction: column; align-items: flex-end;')
  expect(styles).toContain('border-right: 1px solid color-mix')
  // The rail covers the reaction row too; the reaction sits 5px under the event stack, not a full gap below.
  expect(styles).toContain('gap: 0 10px')
  expect(styles).toContain('margin-top: 5px')
})

it('keeps the category tag inside the 84px rail instead of letting the card clip it', () => {
  // The tag is right-aligned in a fixed rail. With `white-space: nowrap` a longer English label
  // overflowed to the left, past the card edge, where `overflow: auto` cut its first letters off.
  const start = styles.indexOf('.mi-calendar-card__row-kind {')
  const rule = styles.slice(start, styles.indexOf('}', start))
  expect(rule).toContain('max-width: 100%')
  expect(rule).toContain('text-align: right')
  expect(rule).not.toContain('white-space: nowrap')
})

// An empty released section must say which window it is empty for. Blank space reads as "the
// feature is broken"; «no released events in the last 3 days» is a fact the reader can act on.
it('says its own window when nothing was released, instead of leaving the section blank', async () => {
  const projection = { today: [], upcoming: [row()], state: 'available' as const }
  const props = { projection, onOpenCalendar: () => undefined, onRefresh: () => undefined }
  const zh = await render(<MarketCalendarCard {...props} text={text} />)
  expect(zh.textContent).toContain('最近 3 天内没有已公布的事件')
  // 这里原来有一次空的 `await act(async () => {})`：它不等待任何条件，只让 React 刷一次微任务。
  // 渲染本身已经在 `act` 里做完了，那次空转只是噪音，删掉后两条断言照旧。
  const en = await render(<MarketCalendarCard {...props} text={calendarText('en-US')} />, 'en-US')
  expect(en.textContent).toContain('No released events in the last 3 days.')
})

it('drops that line as soon as one release is listed', async () => {
  const released = row({ eventKey: 'released', kind: 'released-changed', actual: '1.2%', previous: '1.0%' })
  const host = await render(<MarketCalendarCard projection={{ today: [released], upcoming: [], state: 'available' }}
    onOpenCalendar={() => undefined} onRefresh={() => undefined} text={text} />)
  expect(host.textContent).not.toContain('没有已公布的事件')
})

it('opens on loading, never on the failure state, before the first read answers', async () => {
  const host = await render(<MarketCalendarCard state="loading" projection={{ today: [], upcoming: [row()], state: 'available' }}
    onOpenCalendar={() => undefined} onRefresh={() => undefined} text={text} />)
  expect(host.textContent).toContain(text.loading)
  expect(host.querySelector('.state-view--error')).toBeNull()
  expect(host.textContent).not.toContain(text.unavailable)
  // A projection handed in while loading must not leak its rows onto the first frame.
  expect(host.querySelector('[data-calendar-card-row]')).toBeNull()
})

it('shows the error state with a retry only after the read actually failed', async () => {
  const onRefresh = vi.fn()
  const host = await render(<MarketCalendarCard state="error" projection={{ today: [], upcoming: [], state: 'empty' }}
    onOpenCalendar={() => undefined} onRefresh={onRefresh} text={text} />)
  const failure = host.querySelector<HTMLElement>('.state-view--error')
  expect(failure).not.toBeNull()
  expect(failure?.querySelector('.state-view__action')).not.toBeNull()
  expect(host.querySelector('[data-calendar-card-row]')).toBeNull()
  const retry = failure?.querySelector<HTMLButtonElement>('.state-view__action button')
    ?? failure?.querySelector<HTMLButtonElement>('button')
  await act(async () => retry!.click())
  expect(onRefresh).toHaveBeenCalledTimes(1)
})

it('keeps the previous rows and says they are previous when a refresh failed', async () => {
  const host = await render(<MarketCalendarCard state="ready" stale projection={{ today: [row()], upcoming: [], state: 'available' }}
    onOpenCalendar={() => undefined} onRefresh={() => undefined} text={text} />)
  expect(host.querySelector('[data-calendar-card-stale]')?.textContent).toBe(text.staleNotice)
  // The rows stay: a failed refresh is not a reason to blank a card that already has readings.
  expect(host.querySelectorAll('[data-calendar-card-row]').length).toBeGreaterThan(0)
  expect(host.querySelector('.state-view--error')).toBeNull()
})
