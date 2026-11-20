import { narwhalSourcePolicy } from '../application/narwhalSourcePolicy'
import { zeroXRouterSourcePolicy } from '../application/zeroXRouterSourcePolicy'
import { marketCalendarPublicPolicy } from '../../../contracts/macro/marketCalendarQueryContracts'

/**
 * 一行日历数据的**来源 feed id**。
 *
 * 起因：`MarketCalendarEvent.source` 只有 `'Narwhal' | '0xRouter'` 两个值，而官方行的
 * `source_provider_id` 是 `macro-calendar-bls/-bea/-fed`——装配处只能把它们标成 `0xRouter`，
 * 那是个假话（BLS 的 CPI 会显示「来源 0xRouter」）。删旧源之后这句假话会更荒谬。
 *
 * 做法分两步，避免一次改穿 51 处字面量和文案：
 * 1. **先给真值**：事件上多一个 `sourceFeedId`（可选），由这里算出来——和「声明来源」同一个出处；
 * 2. 之后再把 `source` 枚举整体换过去、让读侧只认 feed id（那是显示口径的决定，要文案映射）。
 */
export const marketCalendarSourceFeedIds = Object.freeze({
  narwhal: Object.freeze({
    'economic-indicator': 'macro-calendar-narwhal-economic-data',
    'financial-event': 'macro-calendar-narwhal-financial-events',
    'central-bank-activity': 'macro-calendar-narwhal-central-bank-activities'
  } as const),
  // 0xrouter 三路按事件类型各有一个 feed（三个作业定义、三个采集端点）。
  zeroXRouter: Object.freeze({
    'economic-indicator': 'macro-calendar-0xrouter-economic-data',
    'financial-event': 'macro-calendar-0xrouter-financial-events',
    'central-bank-activity': 'macro-calendar-0xrouter-central-bank-activities'
  } as const),
  official: Object.freeze({
    bls: 'macro-calendar-bls',
    bea: 'macro-calendar-bea',
    fed: 'macro-calendar-fed'
  } as const)
})

type FeedId = typeof marketCalendarPublicPolicy.sourceFeeds[number]

/** 官方提供方 id → 那个提供方的 feed id。**不按名字猜**：认不出就返回 `undefined`。 */
export function officialFeedIdOf(providerId: string): FeedId | undefined {
  return (Object.values(marketCalendarSourceFeedIds.official) as readonly string[]).includes(providerId)
    ? providerId as FeedId : undefined
}

/**
 * 一行 → feed id：官方行用它的提供方；市场行按事件类别，**但前提是这一行确实来自市场源**。
 * 认不出的 provider 一律 `undefined`——宁可报「没有真值」，也不把它按市场源塞一个 feed id
 * （那等于给未知来源编一个身份）。
 */
export function sourceFeedIdOf(row: Readonly<{ sourceProviderId: string
  eventType: 'economic-indicator' | 'financial-event' | 'central-bank-activity' }>): FeedId | undefined {
  const official = officialFeedIdOf(row.sourceProviderId)
  if (official !== undefined) return official
  if (row.sourceProviderId === narwhalSourcePolicy.providerId) return marketCalendarSourceFeedIds.narwhal[row.eventType]
  // 0xrouter 的行在观测表里记的 provider 是 `0xrouter`（不是那三个 feed id），按类型分三路。
  if (row.sourceProviderId === zeroXRouterSourcePolicy.requestGovernance.providerId) {
    return marketCalendarSourceFeedIds.zeroXRouter[row.eventType]
  }
  return undefined
}
