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
    // 一二级指标（CPI / 非农 / PCE）才露名字：格子里最多三条，其余进角标。
    const tieredMeasures = ['US.CPI.NSA.YOY', 'US.NONFARM.SA.CHANGE', 'US.CORE_PCE.NSA.YOY', 'US.CPI.NSA.YOY', 'US.NONFARM.SA.CHANGE']
    const busyDay = [1, 2, 3, 4, 5].map((index) => dayEvent(`busy-${index}`, `事件 ${index}`,
      `2026-11-13T${String(9 + index).padStart(2, '0')}:00:00.000Z`, { measureKeys: [tieredMeasures[index - 1]!] }))
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

  // 用户 2026-11-14：格子里**只写一级、二级**的名字，其余（央行讲话、库存这类未标级的）
  // 全部进角标数字。这条是「名字灌满格子」的反向判据：把 filterVisibleByTier 去掉即红。
  it('shows no names for untiered events and counts every one of them', async () => {
    const untiered = [
      dayEvent('speech-1', '欧洲央行行长拉加德讲话', '2026-11-13T02:00:00.000Z', { eventType: 'central-bank-activity' }),
      dayEvent('speech-2', '美联储理事讲话', '2026-11-13T03:00:00.000Z', { eventType: 'central-bank-activity' }),
      dayEvent('stock-1', '上周EIA原油库存变化', '2026-11-13T04:00:00.000Z', { measureKeys: ['US.EIA.CRUDE.STOCKS'] })
    ]
    await renderDrawer({ now: '2026-11-13T10:00:00.000Z', readMarketEvents: async () => untiered })
    const cell = Array.from(document.body.querySelectorAll<HTMLButtonElement>('button.mk-minical__day'))
      .find(value => value.querySelector('em')?.textContent === '13')!
    expect(cell.querySelectorAll('.mk-mcell__row')).toHaveLength(0)
    expect(cell.querySelector('.mk-mcell__more')?.textContent).toBe('+3')
  })

  /**
   * 换码过渡期：库里旧的**未季调**行（值空）还在，新的**季调**行要等下一轮采集。
   * 同一期同一发布日两条同时到场时，格子里只能露一条名字——露季调那条（读者在卡上看的就是它），
   * 未季调那条只进右上角数字，不许并列成两条「核心 PCE 年率」。
   *
   * 判据是**两条不同分级**的码走同一套可见性：未季调已降为未分级。谁把它改回一级，这条即红。
   */
  it('shows one core-PCE row when the stale NSA row and the SA row land on the same day', async () => {
    const both = [
      dayEvent('pce-nsa', '核心 PCE 年率（未季调）', '2026-11-13T13:30:00.000Z', { measureKeys: ['US.CORE_PCE.NSA.YOY'] }),
      dayEvent('pce-sa', '核心 PCE 年率（季调）', '2026-11-13T13:30:00.000Z', { measureKeys: ['US.CORE_PCE.SA.YOY'] })
    ]
    await renderDrawer({ now: '2026-11-13T10:00:00.000Z', readMarketEvents: async () => both })
    const cell = Array.from(document.body.querySelectorAll<HTMLButtonElement>('button.mk-minical__day'))
      .find(value => value.querySelector('em')?.textContent === '13')!
    const rows = Array.from(cell.querySelectorAll('.mk-mcell__row')).map((row) => row.textContent ?? '')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toContain('季调')
    // 未季调那条没丢：它进了角标数字（露出 + 计数 = 当天全部条目）。
    expect(cell.querySelector('.mk-mcell__more')?.textContent).toBe('+1')
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
    // 用户 2026-11-14：这一天的事件**全部列出**，不再分核心/其他两层、不折叠——EIA 也在。
    expect(rightColumn()!.textContent).toContain('上周EIA原油库存变化')
    // 右上角只写一个数：第二个数本来就有自己那行可点展开，放进标题行会让读者以为有两处入口。
    expect(rightColumn()!.querySelector('[data-day-summary]')?.textContent).toBe('与利率相关 1 条')
  })

  it('picks the nearest day that has events when today is quiet', async () => {
    // 11-13 没有事件，最近的是 11-14 → 右列应落在 11-14，而不是一个空日子。
    const events = [dayEvent('e-14', '11月消费者信心', '2026-11-14T05:00:00.000Z'), dayEvent('e-06', '10月新增就业', '2026-11-06T13:30:00.000Z')]
    await renderDrawer({ now: '2026-11-13T10:00:00.000Z', readMarketEvents: async () => events })
    expect(rightColumnTitle()).toContain('2026-11-14')
  })

  it('switches the right column to the day the reader clicks and lists every event of it', async () => {
    await renderDrawer({ now: '2026-11-13T10:00:00.000Z', readMarketEvents: async () => calendarEvents })
    const cell = (day: string) => Array.from(document.body.querySelectorAll<HTMLButtonElement>('button.mk-minical__day'))
      .find(value => value.querySelector('em')?.textContent === day)!
    await act(async () => { cell('14').click() })
    expect(rightColumnTitle()).toContain('2026-11-14')
    expect(cell('14').getAttribute('aria-pressed')).toBe('true')
    // 事件全部列出；折叠控件不存在（用户 2026-11-14：不许再折叠、不许把事件藏起来）。
    expect(rightColumn()!.textContent).toContain('11月消费者信心')
    expect(rightColumn()!.querySelector('.mk-col-r__more')).toBeNull()
  })

  it('explains why the shown day is not today', async () => {
    // 今天 11-13 没有发布，最近的一天是 11-14。
    await renderDrawer({ now: '2026-11-13T10:00:00.000Z', readMarketEvents: async () => [dayEvent('e-14', '11月消费者信心', '2026-11-14T05:00:00.000Z')] })
    const note = document.body.querySelector('.mk-col-r [data-day-not-today]')
    expect(note?.textContent).toBe(macroIndicatorDrawerText['zh-CN'].mkDay.notToday)
    // 读者自己挑的那天不加这句——标题里的日期就是他点的。
    const cell = Array.from(document.body.querySelectorAll<HTMLButtonElement>('button.mk-minical__day'))
      .find((value) => value.querySelector('em')?.textContent === '20')!
    await act(async () => { cell.click() })
    expect(document.body.querySelector('.mk-col-r [data-day-not-today]')).toBeNull()
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
  // 用户 2026-11-14：点右列一条事件，要像经济日历页那样**左侧弹出详情抽屉**。
  // 复用同一个 `CalendarInspector`（平台上按 Esc/× 关）与同一份 `MarketCalendarInspector` 正文，
  // 不在抽屉里另画一套详情。
  it('opens the shared detail drawer when a day row is clicked', async () => {
    // 一二级指标才露名字（上一条用例的规则），所以这里用一条 CPI 年率来点。
    const tiered = [dayEvent('e-cpi', '10月消费者物价指数(年率)', '2026-11-13T13:30:00.000Z', { measureKeys: ['US.CPI.NSA.YOY'] })]
    await renderDrawer({ now: '2026-11-13T10:00:00.000Z', readMarketEvents: async () => tiered })
    const row = Array.from(document.body.querySelectorAll<HTMLButtonElement>('.mk-col-r button[data-calendar-row]'))
      .find(candidate => (candidate.getAttribute('aria-label') ?? '').includes('消费者物价指数'))!
    expect(row, 'a day row is the click target').not.toBeNull()
    await act(async () => row.click())
    const detail = document.body.querySelector('[data-calendar-detail-container]')
    expect(detail, 'the detail drawer is reused, not re-drawn').not.toBeNull()
    // 正文是这条事件本身（标题出现在详情里，而不是一个空壳抽屉）。
    expect(detail!.textContent).toContain('10月消费者物价指数(年率)')
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
    // 分组标题按**事件类型**（用户 2026-11-15 改回来）：经济指标 / 财经事件 / 央行活动。
    // 分级只决定格子里露不露名字、进不进数字，不是分组维度。
    expect(list!.textContent).toContain('经济指标 · ')
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
    // 指标行进了「其他」（没有与利率相关的身份）；核心层为空时默认展开，直接能看到行尾两个字。
    const rows = Array.from(rightColumn()!.querySelectorAll('[data-calendar-row]'))
    const indicatorRow = rows.find((row) => row.textContent?.includes('家庭债务'))!
    expect(indicatorRow.textContent).toContain('未提供')
    // 讲话类**也在右列**（用户 2026-11-14：当天事件全部列出），只是行尾不加「未提供」——
    // 那两个字只属于「发布过但没给数值」的指标行。
    const speechRow = rows.find((row) => row.textContent?.includes('央行讲话'))
    expect(speechRow, 'a speech is listed like any other event of the day').not.toBeUndefined()
    expect(speechRow!.textContent).not.toContain('未提供')
  })

  /**
   * 市场侧的重要性是占位值（源里没有这个字段）。**占位值不许参与任何判断**：
   * 抽屉与迷你日历里出现按 `importance` 排序/筛选/画记号，就是把它当成了数据。
   */
  it('never decides anything from 市场的占位重要性', () => {
    for (const file of ['MacroIndicatorDrawer.tsx', 'MiniReleaseCalendar.tsx']) {
      const source = readFileSync(`products/market-intelligence/desktop/pages/intelligence/${file}`, 'utf8')
      const code = source.split('\n').filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*')).join('\n')
      expect(code).not.toMatch(/\.importance\b/)
    }
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
  calendarBlock?: React.ReactNode
}>): Promise<void> {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(<ShellLanguageProvider language="zh-CN"><ShellTimeZoneProvider timeZone="Asia/Shanghai">
      <MacroIndicatorDrawer locale="zh-CN"
        onClose={() => undefined} onRetryPolicy={() => undefined} policyText={text}
        now={input.now} readMarketEvents={input.readMarketEvents}
        {...(input.calendarBlock === undefined ? {} : { calendarBlock: input.calendarBlock })} />
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
    { metricKey: 'US.CORE_PCE.SA.YOY', state: 'not-recorded' },
    { metricKey: 'US.UNEMPLOYMENT.SA.RATE', state: 'provided', period: '2026-10', releasedAt: '2026-11-06T13:30:00.000Z', value: 4.1, unit: 'percent', source: 'narwhal' }
  ]

  /** 给三张卡装上「下一期」，日期由用例指定；PCE 故意不给，用来验证「没有就写暂无排期」。 */
  const withNextRelease = (list: readonly MacroIndicatorCardFact[], releaseAt: string): readonly MacroIndicatorCardFact[] =>
    list.map((fact) => fact.metricKey === 'US.CORE_PCE.SA.YOY'
      ? fact
      : { ...fact, next: { period: '2026-11', releaseAt, timePrecision: 'minute' as const } })

  /** 默认是未来页；要看已发布页的用例先统一翻过去。 */
  const renderReleased = async (cardFacts?: readonly MacroIndicatorCardFact[], cardFactsUnreadable?: boolean) => {
    const rows = await renderCards(cardFacts, cardFactsUnreadable)
    for (let index = 0; index < 3; index += 1) await switchPage(index, 'released')
    return rows
  }

  /** 一张卡位 = 一个轮播；文字取整个卡位（当前页的内容都在里面）。 */
  const carouselText = (index: number): string =>
    document.body.querySelectorAll('[data-pair]')[index]?.textContent ?? ''
  /** 切到另一页：点卡头那颗真按钮（不是手势）。 */
  const switchPage = async (index: number, direction: 'released' | 'next'): Promise<void> => {
    const nav = document.body.querySelectorAll('[data-pair]')[index]?.querySelectorAll<HTMLButtonElement>('.mk-nav button')


    const target = direction === 'next' ? nav?.[1] : nav?.[0]
    await act(async () => { target?.click() })
  }

  /** 用户 2026-11-14：默认打开**未来**那页；左箭头仍能翻回已发布页，数据是同一份。 */
  it('opens on the future page by default and can go back to the released page', async () => {
    await renderCards(facts)
    expect(carouselText(0)).toContain('下次发布')
    await switchPage(0, 'released')
    expect(carouselText(0)).toContain('发布')
    expect(carouselText(0)).not.toContain('下次发布')
  })

  /** 倒计时 tag 三档都用强调色：7 天外不是灰，24 小时内才实底反白。 */
  it('colours the countdown tag by how close the release is', async () => {
    await renderCards(withNextRelease(facts, '2026-12-10T13:30:00.000Z'))
    await switchPage(0, 'next')
    const tag = document.body.querySelectorAll('[data-pair]')[0]?.querySelector('.mk-tag')
    expect(tag?.getAttribute('data-tier')).toBe('far')
  })

  /** 四行全无预期时只剩一句「本期暂无预期」：写「另 4 项」会暗示还有别的内容。 */
  it('says one sentence when every row has no expectation, never 另 N 项', async () => {
    await renderCards(facts)
    await switchPage(0, 'next')
    const cpi = carouselText(0)
    expect(cpi).toContain('本期暂无预期（盘未开）')
    expect(cpi).not.toContain('另 4 项')
    // 只剩一句话时它居中（`mk-card__empty`），不贴着左上角——否则看着像没加载完。
    expect(document.body.querySelector('[data-pair] .mk-card--next .mk-card__empty')).not.toBeNull()
  })

  /** 一到三行缺时逐行写「暂无预期」，不折叠——折叠会把「少数有值」一起藏掉。 */
  it('writes 暂无预期 row by row when only some rows are missing', async () => {    const withOneExpected = facts.map((fact) => fact.metricKey === 'US.CPI.NSA.YOY'
      ? { ...fact, next: { period: '2026-11', releaseAt: '2026-12-10T13:30:00.000Z', timePrecision: 'minute' as const } }
      : fact)
    await renderCards(withOneExpected)
    await switchPage(0, 'next')
    const cpi = carouselText(0)
    expect(cpi).toContain('暂无预期')
    expect(cpi).not.toContain('另 3 项')
  })

  /** 取消整卡变灰，同时时间标签**无条件渲染**：旧了不代表坏了，但要让人看得出多久以前。 */
  it('keeps the card normal and still shows how long ago it was published', async () => {
    await renderReleased(facts)
    expect(document.body.querySelector('[data-dim="true"]')).toBeNull()
    expect(carouselText(0)).toMatch(/天前|刚发布|昨天发布|前天发布/)
  })
  const cardMainValues = () =>
    Array.from(document.body.querySelectorAll('.mk-vrow dd')).map((cell) => cell.textContent ?? '')

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

  it('says 未提供 for rows this period did not provide, instead of a blank', async () => {
    await renderReleased(facts)
    const cpi = carouselText(0)
    expect(cpi).toContain('未提供')
    // 卡面只有字段和值：缺的那几行写「未提供」，解释句进 ⓘ，不在正文里。
    expect(cpi).not.toContain('本期无此数')
  })

  it('shows the payrolls value and the expectation gap chip', async () => {
    await renderReleased(facts)
    const payrolls = carouselText(1)
    expect(payrolls).toContain('+165K')
    // 「较上期」这一行已从卡面去掉（用户 2026-11-14 定稿）；卡上给的是预期差。
    expect(payrolls).not.toContain('较上期')
  })

  /**
   * 「下次发布」在轮播的**未来页**上：切过去才看得到。原来那套「同月找不到就读下个月」的现算已删，
   * 现在读模型的唯一实现（`fact.next`），三条验收（三个月后 / 今天还没到点 / 今天只有日期）在下一组。
   */
  it('shows the next release on the future page, and hides the line when the read model has none', async () => {
    await renderCards(withNextRelease(facts, '2026-12-10T13:30:00.000Z'))
    await switchPage(0, 'next')
    expect(carouselText(0)).toContain('下次发布')
    expect(carouselText(0)).toContain('12-10')
    // 核心 PCE 没有排期 → 未来页写「暂无排期」，已发布页写「本月未发布」（两页各说各自的）。
    await switchPage(2, 'next')
    expect(carouselText(2)).toContain('暂无排期')
  })

  it('does not read a second month for 下次发布 anymore', async () => {
    const reads: string[] = []
    const readMarketEvents = async (month: string) => { reads.push(month); return calendarEvents }
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => {
      root!.render(<ShellLanguageProvider language="zh-CN"><ShellTimeZoneProvider timeZone="Asia/Shanghai">
        <MacroIndicatorDrawer locale="zh-CN" onClose={() => undefined} onRetryPolicy={() => undefined} policyText={text}
          now="2026-11-13T10:00:00.000Z" readMarketEvents={readMarketEvents}
          cardFacts={withNextRelease(facts, '2026-12-10T13:30:00.000Z')} />
      </ShellTimeZoneProvider></ShellLanguageProvider>)
    })
    expect(new Set(reads)).toEqual(new Set(['2026-11']))
  })

  /**
   * 原来这里有一条「下个月那次读失败 → 这一格说暂时读不到」。
   * 那个路径已经不存在：`next` 由读数服务给出，读失败会让**整份读数**失败，
   * 由「says 暂时读不到 when the read failed」那条接管——同一件事，覆盖整卡而不是一格。
   */

  it('says 未提供 on every PCE row because this month has no release row', async () => {
    await renderReleased(facts)
    const pce = carouselText(2)
    expect(pce).toContain('未提供')
    expect(pce).not.toContain('+165K')
  })

  it('never shows a number on a card when the facts were not read at all', async () => {
    const cards = await renderReleased()
    expect(cards).toHaveLength(3)
    // 主值那一格空着：既没有数，也没有「未提供」——那两个字是「来源没给」的意思。
    expect(cardMainValues()).toHaveLength(12)
    expect(cardMainValues().every((value) => value === '')).toBe(true)
    expect(cards.join('')).not.toContain('示意数据')
  })

  it('says 暂时读不到 when the read failed, never 未提供', async () => {
    await renderReleased(undefined, true)
    expect(cardMainValues()).toHaveLength(12)
    expect(cardMainValues().every((value) => value === '暂时读不到')).toBe(true)
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
    // 读屏名归平台的 `helpTrigger`（`ui.help.trigger`）：同一个 ⓘ 在哪一页都是这一句。
    const trigger = head.querySelector('button[aria-label="查看说明"]') as HTMLButtonElement
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

/**
 * 用户 2026-11-15：打开事件详情时，**日历抽屉本身不许往左挪**，要始终贴在右边。
 *
 * antd `Drawer` 的推动规则：**内层**打开时会调用外层的 `push()`（这步不看内层自己的 `push`
 * 参数），外层用**它自己**的 `pushDistance` 做 `translateX(-距离)`，默认 180。所以
 * `push={false}` 必须加在**外层**那只抽屉上；加在内层是没用的（那控制的是内层的子抽屉）。
 * 这条拿源码断外层的 `<Drawer>` 带 `push={false}`：改回去即红。
 */
it('pins the indicator drawer so an inner drawer cannot push it left', () => {
  const source = readFileSync('products/market-intelligence/desktop/pages/intelligence/MacroIndicatorDrawer.tsx', 'utf8')
  const drawerOpen = source.indexOf('<Drawer')
  expect(drawerOpen).toBeGreaterThan(-1)
  const head = source.slice(drawerOpen, source.indexOf('>', drawerOpen))
  expect(head).toContain('push={false}')
})

/**
 * 用户 2026-11-15（第三次、最终口述）：**类型组照旧，经济指标组内再按分级分子组**。
 *
 * 三层：① 经济指标 / 财经事件 / 央行活动；② 只对经济指标再拆 一级/二级/未分级（标题带条数，
 * 子组条数之和 = 该组总数）；③ 央行活动、财经事件不再拆分级——它们本来没有指标码。
 * 把分级子组去掉 → 红；把类型组并成「其他指标」→ 也红。
 */
it('groups by event type first, then by metric tier inside 经济指标 only', async () => {
  const mixed = [
    dayEvent('e-tier1', '10月消费者物价指数(年率)', '2026-11-13T01:00:00.000Z', { measureKeys: ['US.CPI.NSA.YOY'] }),
    dayEvent('e-tier2', '第三季度GDP(年化季率)', '2026-11-13T01:30:00.000Z', { measureKeys: ['US.GDP.SA.ANNUALIZED_QOQ'] }),
    dayEvent('e-tier0', '10月零售销售(月率)', '2026-11-13T01:45:00.000Z'),
    dayEvent('e-speech', '央行讲话', '2026-11-13T02:00:00.000Z', { eventType: 'central-bank-activity' }),
    dayEvent('e-stock', '上周EIA原油库存变化', '2026-11-13T03:00:00.000Z', { eventType: 'financial-event' })
  ]
  await renderDrawer({ now: '2026-11-13T10:00:00.000Z', readMarketEvents: async () => mixed })
  const list = document.body.querySelector('.mk-col-r .mi-calendar-day-list')!
  const groups = [...list.querySelectorAll('[data-calendar-group]')]
  const typeHeadings = groups.map(group => group.querySelector('h3')?.textContent ?? '')
  expect(typeHeadings.some(heading => heading.startsWith('经济指标 · '))).toBe(true)
  expect(typeHeadings.some(heading => heading.startsWith('央行活动 · '))).toBe(true)
  expect(typeHeadings.some(heading => heading.startsWith('财经事件 · '))).toBe(true)
  expect(typeHeadings.some(heading => heading.includes('其他指标'))).toBe(false)

  // 第二层：只有「经济指标」组内有分级子组，标题带条数，条数之和 = 该组总数。
  const indicator = groups.find(group => (group.querySelector('h3')?.textContent ?? '').startsWith('经济指标'))!
  const subgroups = [...indicator.children].filter(child => child.hasAttribute('data-calendar-subgroup'))
  const subheadings = subgroups.map(group => group.querySelector('h4')?.textContent ?? '')
  expect(subheadings).toEqual(['一级指标 · 1 条', '二级指标 · 1 条', '未分级 · 1 条'])
  const counts = subgroups.map(group => group.querySelectorAll('[role="listitem"]').length)
  expect(counts.reduce((sum, count) => sum + count, 0))
    .toBe(indicator.querySelectorAll('[role="listitem"]').length)

  // 另外两组不拆分级：组内没有小标题。
  for (const group of groups.filter(entry => !(entry.querySelector('h3')?.textContent ?? '').startsWith('经济指标'))) {
    expect(group.querySelector('h4'), 'a non-indicator group is not split by tier').toBeNull()
  }
  // 分级照旧只管露名字：一级那条在「一级指标」子组里仍然写着它的名字。
  expect(list.textContent).toContain('消费者物价指数')
})

/**
 * 用户 2026-11-15：把「接下来要看的」那一块收到抽屉右列**上方**，事件列表放它下面。
 * 块由 layout 用**它自己那份 cardData** 构造后作为节点注入——抽屉不复制写法、也不新读一次日历。
 */
it('renders the injected calendar block above the day list, without reading the calendar again', async () => {
  await renderDrawer({ now: '2026-11-13T10:00:00.000Z', readMarketEvents: async () => calendarEvents,
    calendarBlock: <div data-test-calendar-block="">接下来要看的</div> })
  const rail = document.body.querySelector('.mk-col-r')!
  const injected = rail.querySelector('[data-test-calendar-block]')
  const list = rail.querySelector('.mi-calendar-day-list')
  expect(injected, 'the block is drawn from the injected node').not.toBeNull()
  expect(list).not.toBeNull()
  // 顺序：块在前、列表在后（同一个滚动区里）。
  expect(injected!.compareDocumentPosition(list!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
})
