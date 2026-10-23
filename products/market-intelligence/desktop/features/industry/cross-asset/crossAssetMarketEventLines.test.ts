import { describe, expect, it } from 'vitest'
import { crossAssetMarketEventLinePolicy, crossAssetMarketEventSources, officialEventKeysInWindow } from './crossAssetMarketEventLines'

/**
 * 0xRouter 市场路线进竖线（设计 140 §3.2）。
 *
 * 图的竖线原先只读官方路线（CPI/非农/PCE/GDP/FOMC 九个 family），所以像 10-15 那三条
 * 高重要性发布（初请、零售销售、PPI）——日历页面和卡片都看得见——图上一条都没有。
 * 市场路线接上后只画**数据发布**：讲话、会议、报告解释不了曲线的台阶，
 * 而且它们会把图糊成栅栏（读者 §7.2 定的是纯 high，这里再收一层）。
 */
const policy = crossAssetMarketEventLinePolicy

/** 一条 0xRouter 观测，形状取自 `MarketCalendarEvent`（这里只列这个模块读的字段）。 */
const event = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  eventKey: 'a1b2c3d4-0000-4000-8000-000000000001', title: '9月零售销售(月率)', countryCode: 'US',
  eventType: 'economic-indicator', importance: 'high', scheduledAt: '2026-10-15T12:30:00.000Z', ...overrides
})
const sources = (events: readonly unknown[], officialEventKeys: readonly string[] = []) => crossAssetMarketEventSources(events, officialEventKeys)

describe('the market route as chart lines', () => {
  it('keeps a high-importance US data release, named by the provider and dashed while it is still ahead', () => {
    const [line] = sources([event()])
    expect(line).toMatchObject({
      titleKey: 'a1b2c3d4-0000-4000-8000-000000000001', title: '9月零售销售(月率)', countryCode: 'US',
      importance: 'high', eventType: 'economic-indicator', lifecycleState: 'scheduled', source: 'market',
      atMs: Date.parse('2026-10-15T12:30:00.000Z')
    })
  })

  it('draws it solid once the provider has published a value', () => {
    expect(sources([event({ providerActual: { displayValue: '0.8%' } })])[0]?.lifecycleState).toBe('released')
  })

  it('refuses a speech, a summit or a report, however important the provider rates it', () => {
    // The three kinds the calendar page groups separately: only 经济指标 explains a step in the curves.
    expect(policy.eventType).toBe('economic-indicator')
    expect(sources([
      event({ eventType: 'central-bank-activity', title: '美联储理事鲍曼参加一场炉边谈话' }),
      event({ eventType: 'financial-event', title: '20国集团(G20)财长和央行行长会议' })
    ])).toEqual([])
  })

  it('refuses the rest of the world\'s calendar and everything below high importance', () => {
    // The official route this chart already draws is US-only (`countryCode === 'US'` in its own
    // contract), so one chart never mixes two calendars. A UK CPI cannot explain a US-hours move.
    expect(policy.countryCode).toBe('US')
    expect(sources([
      event({ countryCode: 'GB', title: '英国 8月工业产出(年率)' }),
      event({ countryCode: null, title: '8月制造业装船(月率)' }),
      event({ importance: 'medium', title: '10月费城联储制造业指数' }),
      event({ importance: 'low', title: '8月制造业库存(月率)' })
    ])).toEqual([])
  })

  it('drops the provider report of an event the official route is already drawing', () => {
    // Both routes carry the CPI; the official row is the one the calendar page names, and drawing the
    // provider's copy too would put two names on one release.
    const linked = event({
      eventKey: 'ffffffff-0000-4000-8000-000000000002', title: '9月未季调消费者物价指数(年率)',
      officialLink: { officialEventKey: 'US.CPI.RELEASE.2026-M09' }
    })
    expect(sources([linked], ['US.CPI.RELEASE.2026-M09'])).toEqual([])
    // …and keeps it when the official route has not collected that release, so nothing is lost.
    expect(sources([linked])[0]).toMatchObject({ title: '9月未季调消费者物价指数(年率)', source: 'market' })
  })

  it('ignores an entry with no usable instant or no title', () => {
    expect(sources([event({ scheduledAt: 'not-an-instant' }), event({ title: '' }), event({ title: undefined })])).toEqual([])
    expect(sources([null, 'x', 42])).toEqual([])
  })

  it('carries the official key as the identity when the title names a registered release', () => {
    // 命名映射（设计 145 §8 B）：provider 的措辞命中了就会认成官方那条发布，图上两条并成一条。
    const [cpi] = sources([event({ eventKey: 'ffffffff-0000-4000-8000-000000000003', title: '9月未季调消费者物价指数(年率)' })])
    expect(cpi?.titleKey).toBe('cpi')
    // 名字仍是 provider 自己的：这一条单独出现时两个渲染面都用它（设计 145 §8 D 的长尾规则）。
    expect(cpi?.title).toBe('9月未季调消费者物价指数(年率)')
    // 长尾发布没有官方身份，带的仍是自己的事件键——它不成身份，图上退回按措辞去重。
    const [retail] = sources([event()])
    expect(retail?.titleKey).toBe('a1b2c3d4-0000-4000-8000-000000000001')
  })
})

it('only counts official rows that will actually be drawn as "the official route already has it"', () => {
  // 评审 ⑤：此前用整月的官方键去去重，窗口外的官方行也会把 provider 的副本吞掉——那条发布在图上
  // 整个消失。判据是"这条官方行在不在窗口里"，而窗口用的是画线时的同一个 atMs。
  const events = [
    { eventKey: 'in-window', atMs: 1_000 },
    { eventKey: 'before-window', atMs: 10 },
    { eventKey: 'after-window', atMs: 9_000 }
  ]
  expect(officialEventKeysInWindow(events, 500, 2_000)).toEqual(['in-window'])
})
