import { describe, expect, it } from 'vitest'

import { notificationDedupeBuilders } from './notificationDedupeKeys'

/**
 * 键构造函数（契约 §7.1）：**一次发生**的身份。
 *
 * 这里判的是「两个不同的发生必须得到两个键、同一次发生的两种合法写法必须得到同一个键」——
 * 键错了不是「合并失败」，是**说错话**：标题取第一次、正文取最新，读者会看到
 * 「BTC 的标题 + ETH 的正文」。
 */
describe('notification dedupe key builders', () => {
  const observedAt = '2026-11-02T06:37:12.000Z'

  it('normalizes module, asset and rule spellings to the same key', () => {
    const canonical = notificationDedupeBuilders.moduleSignal({
      moduleId: 'OI',
      ruleId: 'oi-spike',
      asset: 'BTC',
      cadence: 'intraday'
    })
    const alias = notificationDedupeBuilders.moduleSignal({
      moduleId: 'oi',
      ruleId: ' OI-Spike ',
      asset: 'btc',
      cadence: 'intraday'
    })
    // 产品内部 id 与枚举别名走同一张归一表，前后空白与大小写不改变身份；日内键里没有时间。
    expect(canonical).toBe('module-signal:OI:oi-spike:BTC')
    expect(alias).toBe(canonical)
  })

  it('两次发生在不同时刻仍是同一个键（日内不带时间，这是四次推送的根因）', () => {
    const earlier = notificationDedupeBuilders.moduleSignal({
      moduleId: 'OI',
      ruleId: 'oi-spike',
      asset: 'BTC',
      cadence: 'intraday'
    })
    const later = notificationDedupeBuilders.moduleSignal({
      moduleId: 'OI',
      ruleId: 'oi-spike',
      asset: 'BTC',
      cadence: 'intraday'
    })
    expect(later).toBe(earlier)
    // 旧实现把 15 分钟桶折进键：`2026-11-02T06:30` 与 `06:45` 是两个键 ⇒ 两次推送。
    expect(earlier).not.toContain('2026-11-02')
  })

  it('keeps different assets in the same bucket apart', () => {
    const btc = notificationDedupeBuilders.moduleSignal({
      moduleId: 'open-interest',
      ruleId: 'oi-spike',
      asset: 'BTC',
      cadence: 'intraday'
    })
    const eth = notificationDedupeBuilders.moduleSignal({
      moduleId: 'open-interest',
      ruleId: 'oi-spike',
      asset: 'ETH',
      cadence: 'intraday'
    })
    expect(btc).not.toBe(eth)
  })

  it('uses one UTC day token for trading-day cadences, without a bucket parameter', () => {
    expect(notificationDedupeBuilders.moduleSignal({
      moduleId: 'etf-flows',
      ruleId: 'etf-inflow',
      asset: 'market',
      observedAt,
      cadence: 'trading-day'
    })).toBe('module-signal:ETF:etf-inflow:market:2026-11-02')
  })

  it('refuses to build a key instead of truncating or falling back to an empty string', () => {
    const invalid = [
      // 时刻不是 Z 结尾整毫秒：时区与格式都不许猜。
      notificationDedupeBuilders.moduleSignal({ moduleId: 'OI', ruleId: 'r', asset: null, observedAt: '2026-11-02T06:37:12+08:00', cadence: 'trading-day' }),
      // 桶宽非法（0 / 超过一天）：截断或补齐都会撞键。
      // 日内键不带时间：`observedAt` / `bucketMs` 传进来就是错的形状（旧口径残留）。
      notificationDedupeBuilders.moduleSignal({ moduleId: 'OI', ruleId: 'r', asset: null, cadence: 'intraday', observedAt } as never),
      notificationDedupeBuilders.moduleSignal({ moduleId: 'OI', ruleId: 'r', asset: null, cadence: 'intraday', bucketMs: 900_000 } as never),
      // 规则名不是「小写连字符分段」。
      notificationDedupeBuilders.moduleSignal({ moduleId: 'OI', ruleId: 'OI Spike', asset: null, observedAt, cadence: 'trading-day' }),
      // 不认识的模块：不猜，也不落到别的腿。
      notificationDedupeBuilders.moduleSignal({ moduleId: 'sentiment', ruleId: 'r', asset: null, observedAt, cadence: 'trading-day' }),
      // 来源 id 形状不对。
      notificationDedupeBuilders.sourceIssue({ sourceId: '' })
    ]
    for (const key of invalid) expect(key).toBeUndefined()
  })

  it('builds one source-issue key per source', () => {
    expect(notificationDedupeBuilders.sourceIssue({ sourceId: 'cn-holiday' })).toBe('source-issue:cn-holiday')
    expect(notificationDedupeBuilders.sourceIssue({ sourceId: ' cn-holiday ' })).toBe('source-issue:cn-holiday')
    expect(notificationDedupeBuilders.sourceIssue({ sourceId: 'cn-holiday' }))
      .not.toBe(notificationDedupeBuilders.sourceIssue({ sourceId: 'treasury' }))
  })
})
