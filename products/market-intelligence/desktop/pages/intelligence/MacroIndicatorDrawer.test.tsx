// @vitest-environment happy-dom
import { act, createElement, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'
import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'
import { MacroIndicatorDrawer } from './MacroIndicatorDrawer'
import { EXPECTATION_BIN_PX } from './ExpectationChart'
import { readFileSync } from 'node:fs'
import { productText } from '../../shared/i18n/productText'
import type { MarketCalendarEvent } from '../../../contracts/macro/marketCalendarQueryContracts'
import { macroIndicatorDrawerText } from './macroIndicatorDrawerText'
import type { PolicyPathReading } from '../../../service/intelligence/policy-path/policyPathQueryService'
import type { MacroIndicatorCardFact } from '../../../service/intelligence/macro-calendar/macroIndicatorCardFacts'

const text = productText['zh-CN'].pages.intelligence.portal.dashboard.policyPath

let root: Root | undefined
let host: HTMLDivElement | undefined
const originalRect = Element.prototype.getBoundingClientRect

/**
 * 图的尺寸只认「量到的值」，量不到就不画。happy-dom 没有布局，所以这里把格子与卡片的尺寸喂进去；
 * 需要验「没量到」的用例，把这个桩设为 0。
 */
function stubLayout(width = 490, height = 192): void {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => width })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => height })
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => height })
  Element.prototype.getBoundingClientRect = () => ({
    x: 0, y: 0, top: 0, left: 0, right: width, bottom: height, width, height, toJSON: () => ({})
  }) as DOMRect
}

beforeEach(() => stubLayout())

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  host?.remove()
  host = undefined
  document.body.innerHTML = ''
  for (const key of ['clientWidth', 'clientHeight', 'offsetHeight']) {
    delete (HTMLElement.prototype as unknown as Record<string, unknown>)[key]
  }
  Element.prototype.getBoundingClientRect = originalRect
})

function Harness({ onOpened }: Readonly<{ onOpened: () => void }>): React.ReactElement {
  const [open, setOpen] = useState(false)
  return <>
    <button type="button" onClick={() => { setOpen(true); onOpened() }}>open</button>
    {open ? <MacroIndicatorDrawer locale="zh-CN" onClose={() => setOpen(false)} onRetryPolicy={() => undefined} policyText={text} /> : null}
  </>
}

describe('key-indicator drawer', () => {
  it('mounts as a modal drawer with a mask, and closes when the mask is clicked', async () => {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    let opened = 0
    await act(async () => {
      root!.render(<ShellLanguageProvider language="zh-CN"><Harness onOpened={() => { opened += 1 }} /></ShellLanguageProvider>)
    })
    const trigger = Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'open')!
    await act(async () => { trigger.click() })
    expect(opened).toBe(1)
    // The drawer is portalled to body: a drawer rendered inside the rail gets clipped by it, and
    // that looks exactly like "the button does nothing".
    // 平台 modal 抽屉：遮罩 + 右侧浮层由 antd 负责，本组件只提供内容。
    const drawer = document.body.querySelector('.ant-drawer')
    expect(drawer).not.toBeNull()
    expect(drawer!.querySelector('.mk-sec')).not.toBeNull()
    const mask = document.body.querySelector('.ant-drawer-mask')
    expect(mask).not.toBeNull()
    // 兜底那条 CSS 的命中条件，逐项钉住（`:has()` 本身由浏览器实现，这里验它的前提）：
    const drawerRoot = document.body.querySelector('.ant-drawer')!
    expect(drawerRoot.classList.contains('drawer--modal')).toBe(true)
    expect(drawerRoot.querySelector('.drawer__panel.mk-drawer')).not.toBeNull()
    // 遮罩必须是 `.ant-drawer` 的直接子元素，`:has(...) > .ant-drawer-mask` 才可能命中。
    expect(drawerRoot.querySelector(':scope > .ant-drawer-mask')).toBe(mask)
    await act(async () => { (mask as HTMLElement).click() })
    expect(document.body.querySelector('.mk-sec')).toBeNull()
  })

  it('draws the real month, switches pages, and re-reads when the refresh button is pressed', async () => {
    const reads: string[] = []
    const readMarketEvents = async (month: string) => { reads.push(month); return month === '2026-11' ? calendarEvents : [] }
    await renderDrawer({ now: '2026-11-13T10:00:00.000Z', readMarketEvents })
    const byName = (name: string) => document.body.querySelector(`button[aria-label="${name}"]`) as HTMLButtonElement
    const title = () => document.body.querySelector('.mk-minical__h h3')!.textContent
    expect(title()).toContain('2026 年 11 月')
    expect(byName('回到本月').disabled).toBe(true)
    await act(async () => { byName('上一个月').click() })
    expect(title()).toContain('2026 年 10 月')
    expect(byName('回到本月').disabled).toBe(false)
    await act(async () => { byName('回到本月').click() })
    expect(title()).toContain('2026 年 11 月')
    // 刷新是真的再读一次（不是一段假等待）：读入口被第二次调用。
    const before = reads.length
    await act(async () => { byName('刷新市场日历').click() })
    expect(reads.length).toBeGreaterThan(before)
  })

  it('lists three release rows in the cell and marks the rest with a corner badge', async () => {
    // 一天 5 条 → 格子里三条 + 角标「+2」；数据来自那次按月读，不是内建示例。
    const busyDay = [1, 2, 3, 4, 5].map((index) => dayEvent(`busy-${index}`, `事件 ${index}`, `2026-11-13T${String(9 + index).padStart(2, '0')}:00:00.000Z`))
    await renderDrawer({ now: '2026-11-13T10:00:00.000Z', readMarketEvents: async () => busyDay })
    const cell = Array.from(document.body.querySelectorAll<HTMLButtonElement>('button.mk-minical__day'))
      .find(value => value.querySelector('em')?.textContent === '13')!
    expect(cell.querySelectorAll('.mk-mcell__row')).toHaveLength(3)
    const badge = cell.querySelector('.mk-mcell__more')!
    // 角标数的是「没显示出来的条数」，不是「重要条数」——所以是 +2，不是「2 条重要」。
    expect(badge.textContent).toBe('+2')
    expect(badge.getAttribute('aria-label')).toBe('还有 2 条未显示')
    // 角标不排在事件行里：它不再和事件名挤在同一列。
    for (const row of Array.from(cell.querySelectorAll('.mk-mcell__row'))) {
      expect(row.contains(badge)).toBe(false)
    }
  })

  /**
   * 角标是**角标**：绝对定位在右上角、不占行高，所以格子高度与事件行数都不因它变。
   * 把它改回事件列之后（或压到最后一行下面），这条即红。
   */
  it('pins the corner badge absolutely so it cannot take a row', () => {
    const styles = readFileSync('products/market-intelligence/desktop/pages/intelligence/macroIndicatorDrawer.css', 'utf8')
    const rule = styles.slice(styles.indexOf('.mk-mcell__more'))
    const body = rule.slice(0, rule.indexOf('}'))
    expect(body).toContain('position: absolute')
    expect(body).toContain('top:')
    expect(body).not.toContain('bottom:')
  })

  it('defaults to today when today has events, and lists only what explains rate expectations', async () => {
    await renderDrawer({ now: '2026-11-13T10:00:00.000Z', readMarketEvents: async () => calendarEvents })
    expect(rightColumnTitle()).toContain('2026-11-13')
    expect(rightColumn()!.textContent).toContain('新增就业')
    // EIA 是 importance=high，但它解释不了利率预期：按判据不进核心层（也不按 importance 筛）。
    expect(rightColumn()!.textContent).not.toContain('上周EIA原油库存变化')
    // 右上角只写一个数：第二个数本来就有自己那行可点展开，放进标题行会让读者以为有两处入口。
    expect(rightColumn()!.querySelector('[data-day-summary]')?.textContent).toBe('与利率相关 1 条')
  })

  it('picks the nearest day that has events when today is quiet', async () => {
    // 11-13 没有事件，最近的是 11-14 → 右列应落在 11-14，而不是一个空日子。
    const events = [dayEvent('e-14', '11月消费者信心', '2026-11-14T05:00:00.000Z'), dayEvent('e-06', '10月新增就业', '2026-11-06T13:30:00.000Z')]
    await renderDrawer({ now: '2026-11-13T10:00:00.000Z', readMarketEvents: async () => events })
    expect(rightColumnTitle()).toContain('2026-11-14')
  })

  it('switches the right column to the day the reader clicks, and folds the rest into one expandable line', async () => {
    await renderDrawer({ now: '2026-11-13T10:00:00.000Z', readMarketEvents: async () => calendarEvents })
    const cell = (day: string) => Array.from(document.body.querySelectorAll<HTMLButtonElement>('button.mk-minical__day'))
      .find(value => value.querySelector('em')?.textContent === day)!
    await act(async () => { cell('14').click() })
    expect(rightColumnTitle()).toContain('2026-11-14')
    expect(cell('14').getAttribute('aria-pressed')).toBe('true')
    // 11-14 只有一条非核心事件：核心层为空 → 给空态句，其余折成一行。
    expect(rightColumn()!.textContent).toContain(macroIndicatorDrawerText['zh-CN'].mkDay.none)
    expect(rightColumn()!.textContent).toContain('其他 1 条')
    // 就地展开：抽屉内的按钮，aria-expanded 真的翻转，展开后那一行才出现。
    const more = rightColumn()!.querySelector('.mk-col-r__more') as HTMLButtonElement
    expect(more.getAttribute('aria-expanded')).toBe('false')
    // 收起态写「其他 N 条」，展开态必须写「收起 N 条」——同一行两种状态不能都写「其他」。
    expect(more.textContent).toContain('其他 1 条')
    await act(async () => { more.click() })
    const expanded = rightColumn()!.querySelector('.mk-col-r__more') as HTMLButtonElement
    expect(expanded.getAttribute('aria-expanded')).toBe('true')
    expect(expanded.textContent).toContain('收起 1 条')
    expect(rightColumn()!.textContent).toContain('11月消费者信心')
    // 展开态是平铺清单：分组标题不再出现（再分三组会把 12 条撑成 15 行）。
    expect(rightColumn()!.querySelector('h3')).toBeNull()
  })

  it('draws the right empty sentence for a day without events, never a blank column', async () => {
    await renderDrawer({ now: '2026-11-13T10:00:00.000Z', readMarketEvents: async () => calendarEvents })
    const cell = Array.from(document.body.querySelectorAll<HTMLButtonElement>('button.mk-minical__day'))
      .find(value => value.querySelector('em')?.textContent === '20')!
    await act(async () => { cell.click() })
    expect(rightColumnTitle()).toContain('2026-11-20')
    // 当天一条事件都没有 → 「这一天没有已收录的事件」，不是「没有影响利率预期的」——两句不能共用。
    expect(rightColumn()!.textContent).toContain(productText['zh-CN'].pages.intelligence.portal.calendar.unifiedDay.empty)
    // 核心为 0 时右上角留白，不写「0 条」。
    expect(rightColumn()!.querySelector('[data-day-summary]')).toBeNull()
    expect(document.body.querySelectorAll('.mk-col-r [data-calendar-row]')).toHaveLength(0)
  })

  /**
   * 用户 2026-11-13：日期详情只以抽屉形态出现，「跳到日历页看某一天」的入口一律不许有。
   * 所以在详情抽屉被复用之前，右列的行**不是控件**——不是画成按钮再写死空函数。
   */
  it('draws the day rows as non-interactive lines until the detail drawer is reused', async () => {
    await renderDrawer({ now: '2026-11-13T10:00:00.000Z', readMarketEvents: async () => calendarEvents })
    const rows = Array.from(document.body.querySelectorAll('.mk-col-r [data-calendar-row]'))
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) expect(row.tagName).toBe('DIV')
    expect(document.body.querySelector('.mk-col-r button[data-calendar-row]')).toBeNull()
  })

  it('shows the error state with a retry when the month cannot be read, and no rows at all', async () => {
    let calls = 0
    const readMarketEvents = async () => { calls += 1; return null }
    await renderDrawer({ now: '2026-11-13T10:00:00.000Z', readMarketEvents })
    expect(document.body.querySelector('.mk-col-r .state-view')).not.toBeNull()
    expect(document.body.querySelectorAll('.mk-col-r .mi-economic-calendar__event')).toHaveLength(0)
    const retry = document.body.querySelector('.mk-col-r .state-view button') as HTMLButtonElement | null
    expect(retry).not.toBeNull()
    const before = calls
    await act(async () => { retry!.click() })
    expect(calls).toBeGreaterThan(before)
  })

  it('says 暂无日程数据 in a month with no releases', async () => {
    await renderDrawer({ now: '2026-11-13T10:00:00.000Z', readMarketEvents: async () => [] })
    expect(document.body.querySelector('.mk-minical__nodata')?.textContent).toBe('暂无日程数据')
  })

  it('carries no sample-data markers any more (ratchet)', () => {
    // 这一笔之后抽屉里没有任何示意数据：源码里再出现 MOCK / 示意数据 就是回退。
    for (const file of ['MacroIndicatorDrawer.tsx', 'MiniReleaseCalendar.tsx', 'macroIndicatorDrawerText.ts', 'useCalendarMonthReleases.ts']) {
      const source = readFileSync(`products/market-intelligence/desktop/pages/intelligence/${file}`, 'utf8')
      expect(source).not.toMatch(/\bMOCK\b|mockTag/)
    }
  })

  it('keeps the header to a title and one close control — no calendar link', async () => {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => {
      root!.render(<ShellLanguageProvider language="zh-CN"><MacroIndicatorDrawer locale="zh-CN" onClose={() => undefined} onRetryPolicy={() => undefined} policyText={text} /></ShellLanguageProvider>)
    })
    const header = document.body.querySelector('.ant-drawer-header')!
    expect(header.textContent).toContain('关键指标 · 预期变化')
    expect(header.textContent).not.toContain('经济日历')
    // 页头只剩一个按钮（关闭）；多一个就是又长出了入口。
    expect(header.querySelectorAll('button')).toHaveLength(1)
    // Chief 的点名判据：页头里的链接数量必须是 0。
    expect(header.querySelectorAll('a')).toHaveLength(0)
    // `.mk-drawer` 必须真的包住正文——样式选择器写错时这条会红。
    expect(document.body.querySelector('.mk-drawer .ant-drawer-body')).not.toBeNull()
  })

  it('reuses the calendar day list, with the real events of the selected day', async () => {
    await renderDrawer({ now: '2026-11-13T10:00:00.000Z', readMarketEvents: async () => calendarEvents })
    const list = document.body.querySelector('.mk-col-r .mi-calendar-day-list')
    expect(list).not.toBeNull()
    expect(list!.textContent).toContain('新增就业')
    // 分组标题用的是日历页同一份词汇，不是这里另写一套。
    expect(list!.textContent).toContain(productText['zh-CN'].pages.intelligence.portal.calendar.market.kinds['economic-indicator'])
  })

  /**
   * 计数与标题同一行、右对齐；**不许**回到「计数单独一段」——
   * 那样在 300px 的右列里会换行，和下面的分组标题挤在一起（用户报的「字样和内容重叠」）。
   */
  it('keeps the day count on the title row instead of its own paragraph', async () => {
    await renderDrawer({ now: '2026-11-13T10:00:00.000Z', readMarketEvents: async () => calendarEvents })
    const list = document.body.querySelector('.mk-col-r .mi-calendar-day-list')!
    const head = list.querySelector(':scope > .mi-calendar-day-list__head')
    expect(head).not.toBeNull()
    expect(head!.querySelector('h2')).not.toBeNull()
    expect(head!.querySelector('[data-day-summary]')).not.toBeNull()
    expect(list.querySelector(':scope > [data-day-summary]')).toBeNull()
  })

  /**
   * 结构守卫（CSS 层）：标题先让位、计数保完整。
   * 去掉 `margin-left:auto`（计数紧贴标题）或给标题 `flex:1` 吃掉计数，这两条就会红。
   */
  it('keeps the count pinned right and lets the title be the one that truncates', () => {
    const styles = readFileSync('products/market-intelligence/desktop/features/macro/economic-calendar/economicCalendar.css', 'utf8')
    const head = styles.slice(styles.indexOf('.mi-calendar-day-list__head > h2'))
    const titleRule = head.slice(0, head.indexOf('}'))
    const countRuleStart = head.indexOf('.mi-calendar-day-list__head > [data-day-summary]')
    const countRule = head.slice(countRuleStart, head.indexOf('}', countRuleStart))
    // 标题：可收缩 + 省略号
    expect(titleRule).toContain('min-width: 0')
    expect(titleRule).toContain('text-overflow: ellipsis')
    // 计数：贴右、不收缩、不换行——它不能被标题吃掉
    expect(countRule).toContain('margin: 0 0 0 auto')
    expect(countRule).toContain('flex: none')
    expect(countRule).toContain('white-space: nowrap')
  })

  /**
   * 「已发布却没值」只给**指标**行加行尾「未提供」；事件型（讲话/会议/报告）永远不加——
   * 它们不是缺值，是本来就没有这个概念。判据用类型，不用「时刻已过且没值」。
   */
  it('adds 未提供 to an indicator row that was published without a value, and never to a speech', async () => {
    const past = '2026-11-13T01:00:00.000Z'
    const indicator = { ...dayEvent('e-missing', '10月家庭债务', past, { measureKeys: [] }), providerActual: null }
    const speech = { ...dayEvent('e-speech', '央行讲话', past, { eventType: 'central-bank-activity' }), providerActual: null }
    await renderDrawer({ now: '2026-11-13T10:00:00.000Z', readMarketEvents: async () => [indicator, speech] })
    // 指标行进了「其他」（没有与利率相关的身份），展开后能看到行尾两个字。
    const more = rightColumn()!.querySelector('.mk-col-r__more') as HTMLButtonElement
    await act(async () => { more.click() })
    const rows = Array.from(rightColumn()!.querySelectorAll('[data-calendar-row]'))
    const indicatorRow = rows.find((row) => row.textContent?.includes('家庭债务'))!
    expect(indicatorRow.textContent).toContain('未提供')
    // 讲话类不进右列（不进层），所以这里连行都没有——事件型的「不加」由 `CalendarEventRow` 自己钉。
    expect(rows.some((row) => row.textContent?.includes('央行讲话'))).toBe(false)
  })

  it('says 暂无日程数据 in a month that has no releases', async () => {
    await renderDrawer({
      now: '2026-11-13T10:00:00.000Z',
      readMarketEvents: async (month: string) => month === '2027-01' ? [] : calendarEvents
    })
    const next = () => document.body.querySelector('button[aria-label="下一个月"]') as HTMLButtonElement
    for (let step = 0; step < 2; step += 1) await act(async () => { next().click() })
    await act(async () => {})
    expect(document.body.querySelector('.mk-minical__h h3')!.textContent).toContain('2027 年 1 月')
    expect(document.body.querySelector('.mk-minical__nodata')?.textContent).toBe('暂无日程数据')
  })
})

function dayEvent(key: string, title: string, scheduledAt: string, input: Readonly<{
  measureKeys?: readonly string[]
  eventType?: MarketCalendarEvent['eventType']
  importance?: MarketCalendarEvent['importance']
}> = {}): MarketCalendarEvent {
  return {
    eventKey: key, title, countryCode: 'US', countryName: '美国',
    eventType: input.eventType ?? 'economic-indicator', importance: input.importance ?? 'high',
    ...(input.measureKeys === undefined ? {} : { measureKeys: input.measureKeys }),
    scheduledAt, consensus: { displayValue: '—' }, providerPrevious: { displayValue: '+0.2%' },
    providerActual: { displayValue: '+0.3%' }, source: 'Narwhal',
    sourceObservedAt: '2026-11-13T00:00:00.000Z', coverage: 'observed-unverified'
  }
}

/** 真库里 11 月的几条（日期是读者时区的日期）。 */
const calendarEvents: readonly MarketCalendarEvent[] = [
  // 读侧时区固定 Asia/Shanghai：这些时刻分别落在 11-13 09:00 / 21:30、11-10 21:30、11-14 13:00。
  dayEvent('e-eia', '上周EIA原油库存变化', '2026-11-13T01:00:00.000Z', { measureKeys: ['US.EIA.CRUDE.STOCKS'] }),
  dayEvent('e-ppi', '10月生产者物价指数(年率)', '2026-11-13T13:30:00.000Z', { measureKeys: ['US.PPI.NSA.YOY'] }),
  dayEvent('e-nfp', '新增就业', '2026-11-13T12:30:00.000Z', { measureKeys: ['US.NONFARM.SA.CHANGE'] }),
  dayEvent('e-cpi', '10月CPI年率', '2026-11-10T13:30:00.000Z', { measureKeys: ['US.CPI.NSA.YOY'] }),
  dayEvent('e-14', '11月消费者信心', '2026-11-14T05:00:00.000Z')
]

const rightColumn = () => document.body.querySelector('.mk-col-r')
const rightColumnTitle = () => rightColumn()?.querySelector('h2')?.textContent ?? ''

async function renderDrawer(input: Readonly<{
  now: string
  readMarketEvents: (month: string, asOf: string) => Promise<readonly unknown[] | null>
}>): Promise<void> {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(<ShellLanguageProvider language="zh-CN"><ShellTimeZoneProvider timeZone="Asia/Shanghai">
      <MacroIndicatorDrawer locale="zh-CN"
        onClose={() => undefined} onRetryPolicy={() => undefined} policyText={text}
        now={input.now} readMarketEvents={input.readMarketEvents} />
    </ShellTimeZoneProvider></ShellLanguageProvider>)
  })
}

const reading: PolicyPathReading = {
  meetingDate: '2026-12-09', daysUntilMeeting: 26, hasProjectionMaterials: true,
  phase: { kind: 'normal' },
  targetRange: { lowerPercent: 3.75, upperPercent: 4 },
  lastDecision: { vote: { for: 10, against: 2 }, outcome: 'no-change' },
  probability: { venue: 'polymarket', asOf: '2026-11-12T02:10:00.000Z', outcome: 'hike-25', value: 0.878, changeInPp24h: 2.1 },
  staleness: 'live'
}

describe('the three simplified cards', () => {
  // 真库里的三条事实：CPI 本期空、上一期 3.7；非农 165/首发布上期 29；核心 PCE 本月没有发布行。
  const facts: readonly MacroIndicatorCardFact[] = [
    { metricKey: 'US.CPI.NSA.YOY', state: 'missing-current', period: '2026-10', releasedAt: '2026-11-10T13:30:00.000Z', previousAsPublished: 3.7, unit: 'percent' },
    { metricKey: 'US.CORE_CPI.NSA.YOY', state: 'missing-current', period: '2026-10', releasedAt: '2026-11-10T13:30:00.000Z', previousAsPublished: 2.6, unit: 'percent' },
    { metricKey: 'US.NONFARM.SA.CHANGE', state: 'provided', period: '2026-10', releasedAt: '2026-11-06T13:30:00.000Z', value: 165, previousAsPublished: 29, unit: 'thousands', source: 'narwhal' },
    { metricKey: 'US.CORE_PCE.NSA.YOY', state: 'not-recorded' },
    { metricKey: 'US.UNEMPLOYMENT.SA.RATE', state: 'provided', period: '2026-10', releasedAt: '2026-11-06T13:30:00.000Z', value: 4.1, unit: 'percent', source: 'narwhal' }
  ]

  const cardMainValues = () =>
    Array.from(document.body.querySelectorAll('.mk-card__v b')).map((cell) => cell.textContent ?? '')

  const renderCards = async (cardFacts?: readonly MacroIndicatorCardFact[], cardFactsUnreadable?: boolean) => {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => {
      root!.render(<ShellLanguageProvider language="zh-CN"><MacroIndicatorDrawer locale="zh-CN" onClose={() => undefined}
        onRetryPolicy={() => undefined} policyText={text} {...(cardFacts ? { cardFacts } : {})}
        {...(cardFactsUnreadable ? { cardFactsUnreadable: true } : {})} /></ShellLanguageProvider>)
    })
    return Array.from(document.body.querySelectorAll('.mk-card')).map((card) => card.textContent ?? '')
  }

  it('says 未提供 for this period and keeps last period, instead of passing it off as current', async () => {
    const [cpi] = await renderCards(facts)
    expect(cpi).toContain('未提供')
    expect(cpi).toContain('10 月 · 已到发布日期，首发布值未收录 · 上一期 3.7%')
    // 上一期 3.7% 不许出现在主值位（`mk-card__na` 是「未提供」那一格）。
    expect(document.body.querySelector('.mk-card__v b.mk-card__na')?.textContent).toBe('未提供')
    expect(cpi).not.toContain('较上期')
  })

  it('shows the payrolls value and the as-published change: 165 − 29 = +136K', async () => {
    const [, payrolls] = await renderCards(facts)
    expect(payrolls).toContain('+165K')
    expect(payrolls).toContain('较上期（未修正）+136K')
  })

  it('shows 失业率 from the same payroll release, not a second read', async () => {
    const [, payrolls] = await renderCards(facts)
    expect(payrolls).toContain('4.1%')
  })

  it('shows the next release from the same month read, and hides the cell when there is none', async () => {
    // 一条未来的 CPI 发布：卡片上「下次发布」就该有日期；非农/PCE 没有未来行 → 那两格不画。
    const future = dayEvent('e-cpi-next', '11月CPI年率', '2026-11-25T13:30:00.000Z', { measureKeys: ['US.CPI.NSA.YOY'] })
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => {
      root!.render(<ShellLanguageProvider language="zh-CN"><ShellTimeZoneProvider timeZone="Asia/Shanghai">
        <MacroIndicatorDrawer locale="zh-CN" onClose={() => undefined} onRetryPolicy={() => undefined} policyText={text}
          now="2026-11-13T10:00:00.000Z" readMarketEvents={async () => [...calendarEvents, future]} cardFacts={facts} />
      </ShellTimeZoneProvider></ShellLanguageProvider>)
    })
    const [cpi, payrolls, pce] = Array.from(document.body.querySelectorAll('.mk-card')).map((card) => card.textContent ?? '')
    expect(cpi).toContain('11-25')
    // 非农在当天稍后还有一次发布（12:30Z），所以这一格有日期——不是「凡是未来的都算下个月」。
    expect(payrolls).toContain('下次发布')
    // 核心 PCE 在这份数据里没有未来行：这一格整格不画，而不是写「未提供」。
    expect(pce).not.toContain('下次发布')
  })

  it('reads next month only when this month has no future release, and only once per snapshot', async () => {
    const reads: string[] = []
    const december = [dayEvent('e-cpi-dec', '11月CPI年率', '2026-12-10T13:30:00.000Z', { measureKeys: ['US.CPI.NSA.YOY'] })]
    const readMarketEvents = async (month: string) => {
      reads.push(month)
      return month === '2026-12' ? december : calendarEvents
    }
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => {
      root!.render(<ShellLanguageProvider language="zh-CN"><ShellTimeZoneProvider timeZone="Asia/Shanghai">
        <MacroIndicatorDrawer locale="zh-CN" onClose={() => undefined} onRetryPolicy={() => undefined} policyText={text}
          now="2026-11-13T10:00:00.000Z" readMarketEvents={readMarketEvents} cardFacts={facts} />
      </ShellTimeZoneProvider></ShellLanguageProvider>)
    })
    const cpiCard = () => document.body.querySelectorAll('.mk-card')[0]!.textContent ?? ''
    // 11 月这批里 CPI 没有未来行 → 读 12 月，格子写出 12-10。
    expect(cpiCard()).toContain('12-10')
    expect(reads.filter((month) => month === '2026-12')).toHaveLength(1)
    // 切日期、重渲染都不再打一次同一快照。
    const cell = Array.from(document.body.querySelectorAll<HTMLButtonElement>('button.mk-minical__day'))
      .find((value) => value.querySelector('em')?.textContent === '14')!
    await act(async () => { cell.click() })
    expect(reads.filter((month) => month === '2026-12')).toHaveLength(1)
  })

  it('says 未提供 for core PCE because this month has no release row', async () => {
    const [, , pce] = await renderCards(facts)
    expect(pce).toContain('未提供')
    expect(pce).toContain('本月未发布')
  })

  /**
   * 三态分开：**没读到**（接口失败）写「暂时读不到」；**还在读**（既没事实也没报失败）
   * 一个数、一个字都不落。「未提供」只说「来源没给这一期的值」，不许拿来顶前两种。
   */
  it('never shows a number on a card when the facts were not read at all', async () => {
    const cards = await renderCards()
    expect(cards).toHaveLength(3)
    // 主值那一格空着：既没有数，也没有「未提供」——那两个字是「来源没给」的意思。
    expect(cardMainValues()).toEqual(['', '', ''])
    expect(cards.join('')).not.toContain('示意数据')
  })

  it('says 暂时读不到 when the read failed, never 未提供', async () => {
    await renderCards(undefined, true)
    expect(cardMainValues()).toEqual(['暂时读不到', '暂时读不到', '暂时读不到'])
  })
})

describe('policy card inside the drawer', () => {
  it('draws the reading the host already has, not a second read', async () => {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => {
      root!.render(<ShellLanguageProvider language="zh-CN"><MacroIndicatorDrawer locale="zh-CN" onClose={() => undefined} onRetryPolicy={() => undefined} policyText={text} policyReading={reading} /></ShellLanguageProvider>)
    })
    const slot = document.body.querySelector('.mk-policy-slot')!
    expect(slot.querySelector('.mi-policy-card')).not.toBeNull()
    expect(slot.textContent).toContain('87.8%')
  })

  it('shows the unreadable form rather than inventing a number', async () => {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => {
      root!.render(<ShellLanguageProvider language="zh-CN"><MacroIndicatorDrawer locale="zh-CN" onClose={() => undefined} onRetryPolicy={() => undefined} policyText={text} /></ShellLanguageProvider>)
    })
    const slot = document.body.querySelector('.mk-policy-slot')!
    expect(slot.textContent).not.toContain('%')
  })
})

describe('the note lives in the info popover', () => {
  const note = macroIndicatorDrawerText['zh-CN'].rateNote

  it('keeps the explanation out of the body text', async () => {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => {
      root!.render(<ShellLanguageProvider language="zh-CN"><MacroIndicatorDrawer locale="zh-CN" onClose={() => undefined} onRetryPolicy={() => undefined} policyText={text} /></ShellLanguageProvider>)
    })
    const head = document.body.querySelector('.mk-sechead')!
    expect(head.textContent).not.toContain('纵轴＝加权期望')
    expect(head.textContent).not.toContain('零以上')
  })

  it('shows the same sentence inside the icon popover, and the icon precedes the readout', async () => {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => {
      root!.render(<ShellLanguageProvider language="zh-CN"><MacroIndicatorDrawer locale="zh-CN" onClose={() => undefined} onRetryPolicy={() => undefined} policyText={text} /></ShellLanguageProvider>)
    })
    const head = document.body.querySelector('.mk-sechead')!
    const trigger = head.querySelector('button[aria-label="利率数学期望的说明"]') as HTMLButtonElement
    expect(trigger).not.toBeNull()
    // 标题 → ⓘ → 读数：图标必须在读数之前，不能跟到数字后面。
    const readout = head.querySelector('.mk-sec__v')!
    expect(trigger.compareDocumentPosition(readout) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(trigger.getAttribute('aria-describedby')).toBeTruthy()
    await act(async () => { trigger.click() })
    expect(document.body.textContent).toContain(note)
    expect(document.body.textContent).toContain('零以上')
  })
})

describe('expectation curve inside the drawer', () => {
  const early = { 'no-change': 0.2, 'hike-25': 0.75, 'hike-50-plus': 0.03, 'cut-25': 0.01, 'cut-50-plus': 0.01 }
  const late = { 'no-change': 0.1, 'hike-25': 0.8, 'hike-50-plus': 0.05, 'cut-25': 0.04, 'cut-50-plus': 0.01 }
  const withSeries: PolicyPathReading = {
    ...reading,
    probability: {
      ...reading.probability!,
      expectationChange24hBp: 0.4,
      series: [
        { at: '2026-10-30T00:00:00.000Z', values: early },
        { at: '2026-11-12T23:00:00.000Z', values: late }
      ]
    }
  }

  const render = async (drawerReading?: PolicyPathReading) => {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => {
      root!.render(<ShellLanguageProvider language="zh-CN"><MacroIndicatorDrawer locale="zh-CN" onClose={() => undefined} onRetryPolicy={() => undefined} policyText={text}
        {...(drawerReading ? { policyReading: drawerReading } : {})} /></ShellLanguageProvider>)
    })
  }

  it('draws the stored series: 25×hike25 + 50×hike50+ − 25×cut25 − 50×cut50+', async () => {
    await render(withSeries)
    // 末点：25×0.8 + 50×0.05 − 25×0.04 − 50×0.01 = 21.0bp，一位小数。
    expect(document.body.querySelector('.mk-sec__v')?.textContent).toBe('21.0bp')
    expect(document.body.querySelector('.mk-sec__d')?.textContent).toBe('↑ +0.4bp · 较上一日')
    const plot = document.body.querySelector('.mk-plot')!
    expect(plot.querySelector('.mk-plot__svg')).not.toBeNull()
    expect(plot.querySelector('.state-view')).toBeNull()
    // 数据全为正：零轴贴底，不出现蓝区（C3）。
    expect(plot.querySelector('rect[fill="url(#mk-g-blue)"]')).toBeNull()
  })

  it('says there is no history instead of printing +0.0bp', async () => {
    const { expectationChange24hBp: _dropped, ...withoutChange } = withSeries.probability!
    await render({ ...withSeries, probability: withoutChange })
    expect(document.body.querySelector('.mk-sec__d')?.textContent).toBe('无历史可比')
  })

  it('turns an unreadable read into the error state with one retry action, and draws no curve', async () => {
    await render()
    const plot = document.body.querySelector('.mk-plot')!
    expect(plot.querySelector('.mk-plot__svg')).toBeNull()
    expect(plot.querySelector('.state-view--error')).not.toBeNull()
    expect(document.body.querySelector('.mk-sec__v')?.textContent).toBe('暂时读不到')
  })

  it('bins the real volume — 1662 observations must not become 1662 vertices', async () => {
    const start = Date.parse('2026-10-30T10:46:22.223Z')
    const step = (13.5 * 86_400_000) / 1661
    const series = Array.from({ length: 1662 }, (_unused, index) => ({
      at: new Date(start + index * step).toISOString(),
      values: late
    }))
    await render({ ...withSeries, probability: { ...withSeries.probability!, series } })
    const line = document.body.querySelector('.mk-plot__svg path[stroke="var(--accent)"]')
    expect(line).not.toBeNull()
    const vertices = (line!.getAttribute('d')!.match(/[ML]/g) ?? []).length
    // 顶点数只由箱数决定（每箱 3px，图宽几百像素 → 一百多个箱），与观测条数无关。
    // happy-dom 量的宽度不稳，所以这里钉的是量级：远少于 1662，且不是几个点糊过去。
    expect(EXPECTATION_BIN_PX).toBe(3)
    expect(vertices).toBeGreaterThan(80)
    expect(vertices).toBeLessThan(200)
  })

  it('marks a release on the curve only when the curve actually moved', async () => {
    const before = { 'no-change': 0.45, 'hike-25': 0.5, 'hike-50-plus': 0.03, 'cut-25': 0.01, 'cut-50-plus': 0.01 }
    const after = { 'no-change': 0.25, 'hike-25': 0.7, 'hike-50-plus': 0.03, 'cut-25': 0.01, 'cut-50-plus': 0.01 }
    const reading: PolicyPathReading = {
      ...withSeries,
      probability: {
        ...withSeries.probability!,
        series: [
          { at: '2026-11-10T13:20:00.000Z', values: before },
          { at: '2026-11-10T13:40:00.000Z', values: after }
        ]
      }
    }
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => {
      root!.render(<ShellLanguageProvider language="zh-CN"><MacroIndicatorDrawer locale="zh-CN" onClose={() => undefined}
        onRetryPolicy={() => undefined} policyText={text} policyReading={reading}
        releaseEvents={[{ at: '2026-11-10T13:30:00.000Z', label: '10月未季调消费者物价指数(年率)', eventNameKey: 'US.CORE_CPI.SA.MOM', measureKeys: ['US.CORE_CPI.SA.MOM', 'US.CPI.NSA.YOY'] }]} /></ShellLanguageProvider>)
    })
    // 期望差：25×(0.70−0.50) = +5.0bp，标注贴在图顶。
    expect(document.body.querySelector('.mk-plot__svg')?.textContent).toContain('↑ +5.0bp CPI 年率')
  })

  it('shows no annotation when the host passes no events', async () => {
    await render(withSeries)
    expect(document.body.querySelector('.mk-plot__svg')?.textContent ?? '').not.toContain('bp CPI')
  })

  it('does not draw the chart before the cell has been measured', async () => {
    stubLayout(0, 0)
    await render(withSeries)
    expect(document.body.querySelector('.mk-plot__svg')).toBeNull()
    // 占位仍在：格子不塌，布局不跳。
    expect(document.body.querySelector('.mk-plot')).not.toBeNull()
  })

  it('draws exactly at the measured cell width, never wider', async () => {
    await render(withSeries)
    const svg = document.body.querySelector('.mk-plot__svg')!
    expect(Number(svg.getAttribute('width'))).toBe(490)
    const cell = document.body.querySelector('.mk-plot') as HTMLElement
    expect(Number(svg.getAttribute('width'))).toBeLessThanOrEqual(cell.clientWidth)
  })

  it('shows the empty state, not a flat line, when the reading carries no points', async () => {
    const { series: _noSeries, ...probability } = withSeries.probability!
    await render({ ...withSeries, probability })
    const plot = document.body.querySelector('.mk-plot')!
    expect(plot.querySelector('.mk-plot__svg')).toBeNull()
    expect(plot.querySelector('.state-view--empty')).not.toBeNull()
  })
})
