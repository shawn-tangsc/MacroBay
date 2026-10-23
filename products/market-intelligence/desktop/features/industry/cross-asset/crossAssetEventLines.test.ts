import { describe, expect, it } from 'vitest'

import { crossAssetEventLinePolicy, crossAssetEventLines, type CrossAssetEventLineSource } from './crossAssetEventLines'

/**
 * The event lines drawn on the same-anchor chart.
 *
 * The chart answers "how much did each line move"; these lines answer "what happened there". They are
 * one column of facts — the same calendar events the calendar page shows, read through the same
 * importance rule — reduced to what a 169-point plot can carry: high importance only, one line per
 * minute, and one line per event even though the same event arrives from two providers.
 */
const minute = 60_000
const windowStart = Date.UTC(2026, 9, 15, 8, 0, 0)
const at = (offsetMinutes: number) => windowStart + offsetMinutes * minute
const event = (input: Partial<CrossAssetEventLineSource> & Pick<CrossAssetEventLineSource, 'eventKey' | 'atMs'>): CrossAssetEventLineSource => ({
  // 一个**没有**官方身份的键：这些夹具走的是"同一分钟里同措辞就是同一条"的老规则。
  // 已注册发布（官方键）的身份用例显式传 `titleKey`，见下面的 describe。
  titleKey: 'not-a-registered-release', title: '消费者物价指数', countryCode: 'US', importance: 'high',
  eventType: 'economic-indicator', lifecycleState: 'released', source: 'official', ...input
})
const lines = (events: readonly CrossAssetEventLineSource[], toMs: number = at(60)) =>
  crossAssetEventLines({ events, fromMs: windowStart, toMs })

describe('the chart event lines', () => {
  it('keeps only high importance, because medium and low would fence the plot', () => {
    const result = lines([
      event({ eventKey: 'a', atMs: at(10) }),
      event({ eventKey: 'b', atMs: at(20), importance: 'medium' }),
      event({ eventKey: 'c', atMs: at(30), importance: 'low' })
    ])
    expect(result.lines.map(line => line.events[0]!.eventKey)).toEqual(['a'])
  })

  it('draws one line per event even when both providers report it, preferring the official source', () => {
    const result = lines([
      event({ eventKey: 'official-1', atMs: at(10), source: 'official', title: '核心消费者物价指数' }),
      // The same release, from the aggregate provider: same country, same title, inside the same minute.
      event({ eventKey: 'market-1', atMs: at(10) + 20_000, source: 'market', title: '核心消费者物价指数' })
    ])
    expect(result.lines).toHaveLength(1)
    expect(result.lines[0]!.events).toHaveLength(1)
    expect(result.lines[0]!.events[0]!.eventKey).toBe('official-1')
    expect(result.lines[0]!.sources).toBe(2)
  })

  it('gathers a minute into one line with a count, and never merges the minute beside it', () => {
    const result = lines([
      event({ eventKey: 'a', atMs: at(10) }),
      event({ eventKey: 'b', atMs: at(10) + 30_000, title: '生产者物价指数' }),
      event({ eventKey: 'c', atMs: at(11), title: '零售销售' })
    ])
    expect(result.lines).toHaveLength(2)
    expect(result.lines[0]!.events.map(item => item.eventKey)).toEqual(['a', 'b'])
    expect(result.lines[0]!.label).toContain('消费者物价指数')
    expect(result.lines[0]!.label).toContain('生产者物价指数')
    expect(result.lines[0]!.label).toContain('2')
    expect(result.lines[1]!.events.map(item => item.eventKey)).toEqual(['c'])
  })

  it('keeps the window boundaries and drops what falls outside them', () => {
    const result = lines([
      event({ eventKey: 'before', atMs: windowStart - minute }),
      event({ eventKey: 'first', atMs: windowStart }),
      event({ eventKey: 'last', atMs: at(60) }),
      event({ eventKey: 'after', atMs: at(61) })
    ])
    expect(result.lines.map(line => line.events[0]!.eventKey)).toEqual(['first', 'last'])
  })

  it('draws a published cluster solid and one that is still ahead dashed', () => {
    const result = lines([
      event({ eventKey: 'out', atMs: at(10), lifecycleState: 'released' }),
      event({ eventKey: 'due', atMs: at(20), lifecycleState: 'scheduled' })
    ])
    expect(result.lines.map(line => [line.events[0]!.eventKey, line.published])).toEqual([['out', true], ['due', false]])
  })

  it('caps how many lines a plot carries, keeps what already happened, and says how many it folded', () => {
    const many = Array.from({ length: crossAssetEventLinePolicy.maximumLines + 3 }, (_, index) =>
      event({ eventKey: `scheduled-${index}`, atMs: at(index + 1), lifecycleState: 'scheduled' }))
    const result = crossAssetEventLines({
      events: [...many, event({ eventKey: 'published-late', atMs: at(59), lifecycleState: 'released' })],
      fromMs: windowStart, toMs: at(60)
    })
    expect(result.lines).toHaveLength(crossAssetEventLinePolicy.maximumLines)
    expect(result.collapsed).toBe(4)
    // A release that already happened is kept ahead of a wall of things that have not: it is the one a
    // reader is looking for when the line beside it moved.
    expect(result.lines.some(line => line.events[0]!.eventKey === 'published-late')).toBe(true)
    // Lines stay in time order for drawing, whatever order the cap selected them in.
    expect([...result.lines].map(line => line.atMs)).toEqual([...result.lines].map(line => line.atMs).sort((a, b) => a - b))
  })

  it('draws nothing at all when there is nothing to draw', () => {
    expect(lines([])).toEqual({ lines: [], collapsed: 0 })
  })
})

/**
 * 官方↔provider 的身份：命名映射（设计 145 §8 B）。
 *
 * 两条路线对同一次发布的措辞不同（官方「消费者物价指数（CPI）」，provider「9月未季调消费者物价指数
 * (年率)」），所以同一分钟里比措辞会把一条发布画两遍；而比"同国同时刻"会把同在 8:30 ET 的 CPI、PPI、
 * 零售销售并成一条。身份是**官方键**：映射到了就并成一条，映射不到就两条都留，并说出"没确认"。
 */
describe('one registered release, one line', () => {
  it('merges the two routes\' wordings of one registered release into one line named by the official row', () => {
    const result = lines([
      event({ eventKey: 'US.CPI.RELEASE.2026-M09', atMs: at(10), titleKey: 'cpi', title: '消费者物价指数（CPI）' }),
      event({
        eventKey: 'a1b2c3d4-0000-4000-8000-000000000001', atMs: at(10) + 20_000, titleKey: 'cpi',
        title: '9月未季调消费者物价指数(年率)', source: 'market'
      })
    ])
    expect(result.lines).toHaveLength(1)
    // One event, the official one, under the official name — the provider copy is not a second line and
    // not a second name.
    expect(result.lines[0]!.events.map(item => item.eventKey)).toEqual(['US.CPI.RELEASE.2026-M09'])
    expect(result.lines[0]!.label).toBe('消费者物价指数（CPI）')
    expect(result.lines[0]!.sources).toBe(2)
    expect(result.lines[0]!.identityUnconfirmed).toBe(false)
  })

  it('never merges two different registered releases that share the minute', () => {
    // 8:30 ET 那一分钟：CPI 与非农是两条不同的发布，身份键不同就不能并。
    const result = lines([
      event({ eventKey: 'US.CPI.RELEASE.2026-M09', atMs: at(10), titleKey: 'cpi', title: '消费者物价指数（CPI）' }),
      event({ eventKey: 'US.NONFARM_PAYROLLS.RELEASE.2026-M09', atMs: at(10) + 5_000, titleKey: 'nonfarm-payrolls', title: '非农就业人数' })
    ])
    expect(result.lines).toHaveLength(1)
    expect(result.lines[0]!.events.map(item => item.eventKey)).toEqual(['US.CPI.RELEASE.2026-M09', 'US.NONFARM_PAYROLLS.RELEASE.2026-M09'])
    expect(result.lines[0]!.label).toContain('（2）')
  })

  it('keeps both names and leaves a trace when a provider release could not be identified', () => {
    // 未映射的长尾发布（零售销售）与官方 CPI 同分钟：没有身份可依，两条都留，并说明没确认过。
    const result = lines([
      event({ eventKey: 'US.CPI.RELEASE.2026-M09', atMs: at(10), titleKey: 'cpi', title: '消费者物价指数（CPI）' }),
      event({
        eventKey: 'a1b2c3d4-0000-4000-8000-000000000002', atMs: at(10) + 20_000,
        titleKey: 'a1b2c3d4-0000-4000-8000-000000000002', title: '9月零售销售(月率)', source: 'market'
      })
    ])
    expect(result.lines).toHaveLength(1)
    expect(result.lines[0]!.events).toHaveLength(2)
    expect(result.lines[0]!.label).toContain('消费者物价指数（CPI）')
    expect(result.lines[0]!.label).toContain('9月零售销售(月率)')
    expect(result.lines[0]!.identityUnconfirmed).toBe(true)
  })

  it('says nothing when an unidentified provider release stands on its own minute', () => {
    // 一个 provider 发布自己占一分钟：没有"官方那条也是它吗"的问题，不留痕。
    const result = lines([
      event({ eventKey: 'US.CPI.RELEASE.2026-M09', atMs: at(10), titleKey: 'cpi', title: '消费者物价指数（CPI）' }),
      event({ eventKey: 'provider-retail', atMs: at(20), titleKey: 'provider-retail', title: '9月零售销售(月率)', source: 'market' })
    ])
    expect(result.lines.map(line => line.identityUnconfirmed)).toEqual([false, false])
  })
})
