import { describe, expect, it } from 'vitest'

import { narwhalCanonicalIdentityKey } from './marketCalendarMetricIdentity'
import { decodeCalendarSourceEventId, narwhalStandardSourceEventId } from './marketCalendarSourceEventId'

/**
 * **标准行身份是四段**（方案 §2.4，架构师 2026-11-21 批）：
 * `国家|指标码|期|首次排期日`，与观测层那个三段串**不是同一个东西**。
 *
 * 为什么要四段：标准表行键含 `first_scheduled_date`，三段身份下两条排期共用同一个 id，
 * 而台账主键只有 `(provider, source_event_id)`——9 组里每组都有一行永远没有台账身份。
 */
describe('标准行身份：四段，且旧三段仍可解', () => {
  const encode = (plain: string) => Buffer.from(plain, 'utf8').toString('base64url')

  it('四段编码后再解码，四个字段都回来', () => {
    const id = narwhalStandardSourceEventId({
      countryCode: 'USA', metricKey: 'US.MICHIGAN_CURRENT.NONE.LEVEL',
      periodKey: '2026-11', firstScheduledDate: '2026-11-06'
    })
    expect(decodeCalendarSourceEventId(id)).toEqual({
      countryCode: 'USA', metricKey: 'US.MICHIGAN_CURRENT.NONE.LEVEL',
      periodKey: '2026-11', firstScheduledDate: '2026-11-06'
    })
  })

  it('旧三段 id 照常解出國家/码/期，`firstScheduledDate` 是 undefined', () => {
    const legacy = JSON.stringify([encode('USA|US.CPI.NSA.YOY|2026-10'), 1])
    const decoded = decodeCalendarSourceEventId(legacy)
    expect(decoded?.countryCode).toBe('USA')
    expect(decoded?.metricKey).toBe('US.CPI.NSA.YOY')
    expect(decoded?.periodKey).toBe('2026-10')
    expect(decoded?.firstScheduledDate).toBeUndefined()
  })

  it('分工不许交叉：四段 id 喂严格三段的 `narwhalCanonicalIdentityKey` 必得 undefined', () => {
    const id = narwhalStandardSourceEventId({
      countryCode: 'USA', metricKey: 'US.CPI.NSA.YOY', periodKey: '2026-10', firstScheduledDate: '2026-10-15'
    })
    // 事实层（market_fact_key / candidate_key）只认三段；标准行 id 走另一个解码函数。
    expect(narwhalCanonicalIdentityKey(id)).toBeUndefined()
    expect(decodeCalendarSourceEventId(id)?.firstScheduledDate).toBe('2026-10-15')
  })

  it('最长码 + 周度期次 + 排期日：token 107 / JSON 113，都在 128 以内', () => {
    const id = narwhalStandardSourceEventId({
      countryCode: 'USA',
      metricKey: 'US.EMPIRE_STATE_MANUFACTURING.PRICES_RECEIVED.SA.LEVEL',
      periodKey: '2026-11-05', firstScheduledDate: '2026-11-20'
    })
    const [token] = JSON.parse(id) as [string, number]
    // 上限来自 decodeNarwhalIdentityToken 的 `/^[A-Za-z0-9_-]{4,128}$/`：加一段之后仍有余量。
    expect(token.length).toBe(107)
    expect(id.length).toBe(113)
    expect(token.length).toBeLessThanOrEqual(128)
    expect(decodeCalendarSourceEventId(id)?.periodKey).toBe('2026-11-05')
  })
})
