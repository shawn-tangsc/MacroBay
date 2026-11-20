// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'
import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'
import { IndicatorCards, type IndicatorCardGroup } from './IndicatorCards'
import { macroIndicatorDrawerText } from './macroIndicatorDrawerText'
import { productText } from '../../shared/i18n/productText'
import type { MacroIndicatorCardFact } from '../../../service/intelligence/macro-calendar/macroIndicatorCardFacts'

/**
 * 三张卡「这一格没有数」的三种状态**不许互相冒充**（用户 2026-11-14 报「三张卡一转眼全空了」）：
 *
 * - 还没读完（`facts` 缺席）→ 等待态，不写任何结论；
 * - 整次读取失败（`unreadable`）→ 「暂时读不到」；
 * - 读到了、这一期确实没盘 → 「本期暂无预期（盘未开）」。
 *
 * 之前四行全缺一律画成最后那句：市场明明开着，卡上说「盘未开」。这一屏是那句错的唯一判据。
 */
const text = macroIndicatorDrawerText['zh-CN']
const calendarText = productText['zh-CN'].pages.intelligence.portal.calendar

const groups: readonly IndicatorCardGroup[] = [
  {
    id: 'cpi',
    title: 'CPI 年率',
    rows: [
      { metricKey: 'US.CPI.NSA.YOY', label: text.cardRows.yoy, kind: 'yoy' },
      { metricKey: 'US.CPI.SA.MOM', label: text.cardRows.mom, kind: 'mom' }
    ]
  }
]

const releaseAt = '2026-12-10T13:30:00.000Z'

/** 两行都排上了下一期，但都没有预期：这是「确实没盘」那一档。 */
const closedMarket: readonly MacroIndicatorCardFact[] = [
  { metricKey: 'US.CPI.NSA.YOY', state: 'missing-current', period: '2026-10', releasedAt: '2026-11-10T13:30:00.000Z', previousAsPublished: 3.7, unit: 'percent', next: { period: '2026-11', releaseAt, timePrecision: 'minute', expectedState: 'no-market' } },
  { metricKey: 'US.CPI.SA.MOM', state: 'missing-current', period: '2026-10', releasedAt: '2026-11-10T13:30:00.000Z', previousAsPublished: 0.1, unit: 'percent', next: { period: '2026-11', releaseAt, timePrecision: 'minute', expectedState: 'no-market' } }
]

/** 同样没有预期，但原因是**读失败**：不许画成「盘未开」。 */
const unreadableRow: readonly MacroIndicatorCardFact[] = [
  closedMarket[0]!,
  { ...closedMarket[1]!, next: { period: '2026-11', releaseAt, timePrecision: 'minute' as const, expectedState: 'unreadable' as const } }
]

let root: Root | undefined
let host: HTMLDivElement | undefined

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  host?.remove()
})

async function renderCards(input: Readonly<{
  facts?: readonly MacroIndicatorCardFact[]
  unreadable?: boolean
}>): Promise<string> {
  await act(async () => {
    root!.render(<ShellLanguageProvider language="zh-CN"><ShellTimeZoneProvider timeZone="Asia/Shanghai">
      <IndicatorCards groups={groups}
        {...(input.facts === undefined ? {} : { facts: input.facts })}
        {...(input.unreadable === true ? { unreadable: true } : {})}
        text={text} calendarText={calendarText} timeZone="Asia/Shanghai"
        now="2026-11-14T00:00:00.000Z" resolveKey={() => ''} />
    </ShellTimeZoneProvider></ShellLanguageProvider>)
  })
  return document.body.querySelector('[data-card="upcoming"]')?.textContent ?? ''
}

describe('card expectations: unreadable is not the same as no market', () => {
  it('says 读取失败 when the whole read failed, never 盘未开', async () => {
    const card = await renderCards({ unreadable: true })
    expect(card).toContain('读取失败')
    expect(card).not.toContain('盘未开')
  })

  it('keeps an unreadable row distinct from a row whose market is really closed', async () => {
    const card = await renderCards({ facts: unreadableRow })
    // 读不到的那一行写「读取失败」，另一行才是「暂无预期」；整页不折叠成一句「盘未开」。
    expect(card).toContain('读取失败')
    expect(card).toContain('暂无预期')
    expect(card).not.toContain('本期暂无预期（盘未开）')
  })

  it('still writes 盘未开 when the read succeeded and this period really has no market', async () => {
    const card = await renderCards({ facts: closedMarket })
    expect(card).toContain('本期暂无预期（盘未开）')
    expect(card).not.toContain('读取失败')
  })

  it('writes no verdict at all while the read is still in flight', async () => {
    const card = await renderCards({})
    expect(card).not.toContain('盘未开')
    expect(card).not.toContain('读取失败')
    // 等待态走统一的 LoadingState，不写「暂无」这类结论句。
    expect(document.body.querySelector('[class*="loading"]')).not.toBeNull()
  })
})

/**
 * 发布日与观测日是两件事（Chief 2026-11-14）：
 * - **发布日**回答「那次发布什么时候发生」→ 走「刚发布 / 昨天发布 / N 天前」；
 * - **观测日**只回答「我们什么时候看到这个数」→ 写「更新于 MM-DD」，**不许出现「发布」**。
 *
 * 混用会让读者以为那天有一场发布，而日历上根本没有——这条是那件事的唯一判据。
 */
describe('released page: 发布 and 更新于 are two different sentences', () => {
  /** 切到已发布页：点卡头那颗真按钮，不走手势。 */
  async function renderReleased(facts: readonly MacroIndicatorCardFact[]): Promise<string> {
    await renderCards({ facts })
    const nav = document.body.querySelectorAll<HTMLButtonElement>('[data-card="upcoming"] .mk-nav button')
    await act(async () => { nav[0]?.click() })
    return document.body.querySelector('[data-card="released"]')?.textContent ?? ''
  }

  /** 官方序列给了数、日历库里没有那场发布：只有观测日。 */
  const observedOnly: readonly MacroIndicatorCardFact[] = [
    { metricKey: 'US.CPI.NSA.YOY', state: 'provided', period: '2026-09', seriesObservedAt: '2026-09-26T00:00:00.000Z', value: 3.7, unit: 'percent', previousAsPublished: 3.4 },
    { metricKey: 'US.CPI.SA.MOM', state: 'provided', period: '2026-09', seriesObservedAt: '2026-09-26T00:00:00.000Z', value: 0.3, unit: 'percent' }
  ]

  /** 真有一场发布：两个时间都有，发布日在前。 */
  const released: readonly MacroIndicatorCardFact[] = [
    { metricKey: 'US.CPI.NSA.YOY', state: 'provided', period: '2026-09', releasedAt: '2026-09-26T12:30:00.000Z', seriesObservedAt: '2026-10-01T00:00:00.000Z', value: 3.7, unit: 'percent', previousAsPublished: 3.4 },
    { metricKey: 'US.CPI.SA.MOM', state: 'provided', period: '2026-09', releasedAt: '2026-09-26T12:30:00.000Z', value: 0.3, unit: 'percent' }
  ]

  it('says 更新于 with the observation date when there is no release at all', async () => {
    const card = await renderReleased(observedOnly)
    expect(card).toContain('更新于 09-26')
    // 那天没有一场发布：整个卡面一个字都不许提「发布」。
    expect(card).not.toContain('发布')
  })

  it('keeps the release wording when there really was a release', async () => {
    const card = await renderReleased(released)
    expect(card).toContain('发布')
    expect(card).not.toContain('更新于')
  })
})

/**
 * 四种「这一格没有数」不许互相冒充（产品 41 号文，Chief 2026-11-19）：
 * 待发布 / 无此数据 / 未提供 / 读取失败——其中「读取失败」已在上面那一组盯着。
 * 再从「上一期」这一页验：它才是读者看数的那一页。
 */
describe('released page: four reasons a cell can have no number', () => {
  const at = '2026-10-30T12:30:00.000Z'
  /**
   * 第一行**有值**：上一期整页有数，箭头才翻得动——否则按用户规则箭头是禁用的，
   * 这一页根本看不见（那正是 PCE 那张卡现在的状态）。被测的那一格挂在第二行。
   */
  const gapFacts = (gap: MacroIndicatorCardFact['gap']): readonly MacroIndicatorCardFact[] => [
    { metricKey: 'US.CPI.NSA.YOY', state: 'provided', period: '2026-10', releasedAt: at, value: 3.7, unit: 'percent' },
    { metricKey: 'US.CPI.SA.MOM', state: 'missing-current', period: '2026-10', releasedAt: at, gap }
  ]

  /** 切到「上一期」那页；上一期有数才翻得动，所以夹具里带一条有值的。 */
  async function renderPastRow(facts: readonly MacroIndicatorCardFact[]): Promise<HTMLElement> {
    await renderCards({ facts })
    const prev = document.body.querySelectorAll<HTMLButtonElement>('[data-card="upcoming"] .mk-nav button')[0]!
    await act(async () => { prev.click() })
    return document.body.querySelector('[data-card="released"]') as HTMLElement
  }

  it('writes 待发布 for a period that is not due yet', async () => {
    const card = await renderPastRow(gapFacts({ pending: { period: '2026-10', releaseAt: '2026-11-25T13:30:00.000Z' } }))
    expect(card.textContent).toContain('待发布')
    // 有值那一行照常给数：一个状态只影响它自己那一格。
    expect(card.textContent).toContain('3.7')
  })

  it('writes 无此数据 with the basis in the ⓘ for structural-no-source', async () => {
    const card = await renderPastRow(gapFacts({ missing: { reason: 'structural-no-source', basis: '2025-10 的 CPI 从未发布' } }))
    expect(card.textContent).toContain('无此数据')
    // ⓘ 的正文在浮层里，DOM 必到的是那颗按钮与它的读屏名（依据来自库里的那句）。
    expect(card.querySelector('[data-cell-state="no-such-data"] button')).not.toBeNull()
  })

  it('writes 未提供 with its own ⓘ for source-no-value', async () => {
    const card = await renderPastRow(gapFacts({ missing: { reason: 'source-no-value' } }))
    expect(card.textContent).toContain('未提供')
    expect(card.querySelector('[data-cell-state="source-no-value"] button')).not.toBeNull()
  })

  it('keeps two states apart on the same card', async () => {
    await renderCards({ facts: [
      { metricKey: 'US.CPI.NSA.YOY', state: 'provided', period: '2026-09', releasedAt: at, value: 3.7, unit: 'percent' },
      { metricKey: 'US.CPI.SA.MOM', state: 'missing-current', period: '2026-09', releasedAt: at,
        gap: { missing: { reason: 'structural-no-source', basis: '分母不存在' } } }
    ] })
    const prev = document.body.querySelectorAll<HTMLButtonElement>('[data-card="upcoming"] .mk-nav button')[0]!
    await act(async () => { prev.click() })
    const card = document.body.querySelector('[data-card="released"]') as HTMLElement
    expect(card.textContent).toContain('3.7')
    expect(card.textContent).toContain('无此数据')
  })
})

/**
 * 翻页箭头（用户 2026-11-19）：「上一期那张卡里一个数据都没有，不可翻」——
 * 判据是上一期整页有没有值，不是「整体有没有可翻的期次」，也不是「箭头不渲染」。
 */
describe('paging: the previous period is off limits when it has no data at all', () => {
  const at = '2026-10-30T12:30:00.000Z'

  it('can go back when the previous period has at least one number', async () => {
    await renderCards({ facts: [
      { metricKey: 'US.CPI.NSA.YOY', state: 'provided', period: '2026-09', releasedAt: at, value: 3.7, unit: 'percent' },
      { metricKey: 'US.CPI.SA.MOM', state: 'missing-current', period: '2026-09', releasedAt: at }
    ] })
    const prev = document.body.querySelectorAll<HTMLButtonElement>('[data-card="upcoming"] .mk-nav button')[0]!
    expect(prev.disabled).toBe(false)
    await act(async () => { prev.click() })
    expect(document.body.querySelector('[data-card="released"]')?.textContent).toContain('3.7')
  })

  it('still lets the reader back in when the only content is a stated reason', async () => {
    // 「无此数据」本身是可看的内容（告诉读者这一期为什么没有），与四格全空的「未提供」不同。
    await renderCards({ facts: [
      { metricKey: 'US.CPI.NSA.YOY', state: 'missing-current', period: '2026-10', releasedAt: at,
        gap: { missing: { reason: 'structural-no-source', basis: '基期不存在' } } },
      { metricKey: 'US.CPI.SA.MOM', state: 'missing-current', period: '2026-10', releasedAt: at }
    ] })
    const prev = document.body.querySelectorAll<HTMLButtonElement>('[data-card="upcoming"] .mk-nav button')[0]!
    expect(prev.disabled).toBe(false)
  })

  it('disables the arrow when the previous period has no value at all', async () => {
    await renderCards({ facts: [
      { metricKey: 'US.CPI.NSA.YOY', state: 'missing-current', period: '2026-10', releasedAt: at },
      { metricKey: 'US.CPI.SA.MOM', state: 'missing-current', period: '2026-10', releasedAt: at }
    ] })
    const prev = document.body.querySelectorAll<HTMLButtonElement>('[data-card="upcoming"] .mk-nav button')[0]!
    expect(prev.disabled).toBe(true)
    // 位置不跳：点了仍是「下一期」那页，不弹错误。
    await act(async () => { prev.click() })
    expect(document.body.querySelector('[data-card="upcoming"]')).not.toBeNull()
    expect(document.body.textContent).not.toContain('读取失败')
  })
})
