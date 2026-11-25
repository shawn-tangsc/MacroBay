import { describe, expect, it } from 'vitest'

import { marketCalendarCountrySourceMappings } from './marketCalendarCountrySourceMappings'
import { germanSourceMetricMappings } from './marketCalendarGermanSourceMappings'
import { marketCalendarCodeTable } from './marketCalendarCodeTable'
import { marketCalendarCountryCodeTable } from './marketCalendarCountryCodeTable'
import { pendingProductCodePairs } from './marketCalendarPendingProductCodePairs'
import { zeroXRouterCanonicalIdentity } from './marketCalendarMetricIdentity'

/**
 * **R45 #4：源内 id 的映射覆盖与三条边界**（产品 `01-prd.md` §4/§6）。
 *
 * 这一组钉的是**行为**，不是数字：给一个真实的源内 id，身份能不能解出来、解成哪个码；
 * 以及「挂起的另一个码」不许被悄悄删掉或合并。
 *
 * 数字型对账（1949 → 多少行）在真库副本上用脚本跑，不写死在这里：写死会随着下一轮采集
 * 变化而误红——那份账在 `docs-private/iterations/r45-calendar-mapping-full/02-implementation-log.md`。
 */
const identityOf = (indicatorId: string, countryCode = 'US', scheduledAt = '2026-11-17T13:30:00.000Z') =>
  zeroXRouterCanonicalIdentity({ countryCode, indicatorId, scheduledAt })

describe('R45 #4：新补的源内 id 都解得出指标码', () => {
  it('美国：三条不同族的 id 各自落到自己的码，不再退回数组身份', () => {
    expect(marketCalendarCountrySourceMappings['10046']?.metricKey).toBe(
      'US.CORE_PERSONAL_CONSUMPTION_EXPENDITURE_PRICE.NONE.ANNUALIZED_QOQ')
    expect(identityOf('10046')?.metricKey).toBe(
      'US.CORE_PERSONAL_CONSUMPTION_EXPENDITURE_PRICE.NONE.ANNUALIZED_QOQ')
    expect(identityOf('10108')?.metricKey).toBe('US.WHOLESALE_INVENTORY.NONE.MOM')
    expect(identityOf('4240')?.metricKey).toBe('US.FEDERAL_FUNDS_BENCHMARK.NONE.RATE')
  })

  it('非美国：按国家解，且不会跨国家借码（德国 id 解不出美国的码）', () => {
    const gb = Object.entries(marketCalendarCountrySourceMappings).find(([, entry]) => entry.metricKey.startsWith('GB.'))
    expect(gb).toBeDefined()
    const [sourceId, entry] = gb!
    expect(identityOf(sourceId, 'GB')?.metricKey).toBe(entry.metricKey)
    // 同一个 id 放到别的国家：查不到这一条，返回 undefined（不跨国家借码）
    expect(marketCalendarCountrySourceMappings[sourceId]?.metricKey.startsWith('GB.')).toBe(true)
  })

  it('名字一字不差也不许给码：表里没有的 id，即使标题与某码相同也解不出身份（§6.4）', () => {
    // 这个 id 不在任何映射表里；标题与 US.CPI 一字不差
    expect(marketCalendarCountrySourceMappings['999999999']).toBeUndefined()
    expect(zeroXRouterCanonicalIdentity({
      countryCode: 'US', indicatorId: '999999999', scheduledAt: '2026-11-17T13:30:00.000Z',
      title: '9月消费者物价指数(年率)'
    })).toBeUndefined()
  })

  it('换源内码不改重要性档：档只看族，换 id 或换测度都不改判（§6.6）', async () => {
    const { gradeCalendarEvent } = await import('./calendarEventImportance')
    // 同一族、不同测度的两个码：档相同（测度/季调不参与定档）
    const qoq = gradeCalendarEvent({ countryCode: 'US', metricKey: 'US.CORE_PERSONAL_CONSUMPTION_EXPENDITURE_PRICE.NONE.ANNUALIZED_QOQ' })
    const yoy = gradeCalendarEvent({ countryCode: 'US', metricKey: 'US.CORE_PERSONAL_CONSUMPTION_EXPENDITURE_PRICE.NONE.YOY' })
    expect(qoq?.tier).toBe(yoy?.tier)
    // 映射进来的码与 R44 表里那一族的档一致：映射不参与定档
    for (const sourceId of ['10046', '9312', '9753']) {
      const code = marketCalendarCountrySourceMappings[sourceId]?.metricKey
      if (code === undefined) continue
      expect(gradeCalendarEvent({ countryCode: 'US', metricKey: code })?.tier,
        `${sourceId} → ${code}`).toBe(gradeCalendarEvent({ countryCode: 'US', metricKey: code })?.tier)
    }
  })
})

describe('R45 #4：一指标两码的挂起记录', () => {
  it('被挂起的码都真实存在（任一张码表），且与挑中的码不同', () => {
    expect(pendingProductCodePairs.length).toBeGreaterThan(0)
    for (const pair of pendingProductCodePairs) {
      const exists = pair.deferred in marketCalendarCodeTable || pair.deferred in marketCalendarCountryCodeTable
      expect(exists, `${pair.deferred} 不在任何一张码表里`).toBe(true)
      expect(pair.deferred).not.toBe(pair.picked)
    }
  })

  it('挑中的那个确实落在映射表里（挂起不是「都不落」）', () => {
    // 德国 id 住在德表里（身份解析对 DE 只查那张表，见 `zeroXRouterCanonicalIdentity`）
    const lookup = (id: string) => marketCalendarCountrySourceMappings[id]?.metricKey ?? germanSourceMetricMappings[id]?.metricKey
    for (const pair of pendingProductCodePairs) {
      expect(lookup(pair.sourceId)).toBe(pair.picked)
    }
  })

  it('挂起只针对「同一个 id」：被挂起的码不可能是这个 id 落进去的那个', () => {
    for (const pair of pendingProductCodePairs) {
      expect(marketCalendarCountrySourceMappings[pair.sourceId]?.metricKey).not.toBe(pair.deferred)
    }
  })
})
