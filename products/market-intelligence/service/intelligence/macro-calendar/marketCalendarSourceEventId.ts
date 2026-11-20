import type { MarketCalendarCanonicalIdentity } from './marketCalendarMetricIdentity'
import { encodeIdentityToken } from './marketCalendarMetricIdentity'

/**
 * **标准行 `source_event_id` 的编码与解码**（方案 §2.4，架构师 2026-11-21 批）。
 *
 * 从 `marketCalendarMetricIdentity.ts` 抽出来（体积门禁：那个文件 537 行）。两件事要记牢：
 * - 标准行是**四段**（多一个首次排期日）；观测层仍是三段，两层**不是同一个串**，靠 `(id, 排期日)` 关联；
 * - 解码**同时接受**三段（旧行）与四段（新行）；遇到三段不许抛错、不许把第 3 段当排期日。
 *   与 `narwhalCanonicalIdentityKey`（严格三段，只服务 `market_fact_key` / `candidate_key`）分工不许交叉。
 */

/**
 * 标准行身份：四段 `国家|指标码|期|首次排期日`**（方案 §2.4，架构师 2026-11-21 批）。
 *
 * 为什么比观测层多一段：标准表的行键是 `(country_code, metric_key, period_key, first_scheduled_date)`，
 * 排期是行键的一部分（初值 11-06 / 终值 11-20 是两行）。观测层那个三段串在这里不够用——两条排期
 * 会共用同一个 id，而台账主键只有 `(provider, source_event_id)`，于是 9 组里每组都有一行永远没有台账身份。
 *
 * **它不是观测层那个串**：观测层仍是三段（`market_fact_key` / `candidate_key`），两层靠 `(id, 排期日)` 关联。
 */
export function narwhalStandardSourceEventId(
  identity: MarketCalendarCanonicalIdentity & Readonly<{ firstScheduledDate: string }>
): string {
  return JSON.stringify([encodeIdentityToken(
    `${identity.countryCode}|${identity.metricKey}|${identity.periodKey}|${identity.firstScheduledDate}`
  ), 1])
}

export type CalendarSourceIdentity = Readonly<{
  countryCode: string
  metricKey: string
  periodKey: string
  /** 旧三段 id 没有这一段——`undefined` 就是「旧行」，不是缺数据。 */
  firstScheduledDate?: string
}>

/**
 * **标准行 `source_event_id` 的解码**：同时接受旧三段与新四段。
 *
 * 遇到三段**不许抛错、不许把第 3 段当排期日**——现有 32 行旧 id 就是这么解的，解错会让旧行身份漂移。
 * 与 `narwhalCanonicalIdentityKey`（严格三段，只服务 `market_fact_key` / `candidate_key`）分工不许交叉：
 * 四段喂那个函数会静默变 `undefined`，那一行就被当成「没有身份」。
 */
export function decodeCalendarSourceEventId(raw: string): CalendarSourceIdentity | undefined {
  let token: unknown
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed) || parsed.length !== 2) return undefined
    token = parsed[0]
  } catch {
    return undefined
  }
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{4,128}$/.test(token)) return undefined
  let plain: string
  try {
    plain = Buffer.from(token, 'base64url').toString('utf8')
  } catch {
    return undefined
  }
  const parts = plain.split('|')
  if ((parts.length !== 3 && parts.length !== 4) || parts.some((part) => part.length === 0)) return undefined
  const [countryCode, metricKey, periodKey, firstScheduledDate] = parts as [string, string, string, string?]
  return firstScheduledDate === undefined
    ? { countryCode, metricKey, periodKey }
    : { countryCode, metricKey, periodKey, firstScheduledDate }
}

