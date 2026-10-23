import { providerReleaseTitleKey } from '../../../../contracts/macro/macroCalendarReleaseIdentity'
import { providerLifecycleState } from '../../../shared/marketCalendarEventLifecycle'
import type { CrossAssetEventLineSource } from './crossAssetEventLines'

/**
 * The 0xRouter calendar's events, reduced to the lines this chart may draw.
 *
 * The chart drew only the official route until now — nine release families (CPI, non-farm payrolls,
 * PCE, GDP, FOMC …) — so a day whose releases came through the provider alone (initial claims, retail
 * sales, PPI) showed nothing at all, even though the calendar page and the card listed them. Both
 * routes are read now, and this module decides which of the provider's events may stand beside the
 * official ones.
 *
 * Three bounds, each with a reason:
 *
 * - **Data releases only.** A central-bank speech, a summit or a monthly report is high importance to
 *   the calendar and cannot explain a step in these curves; drawing them fills the plot with lines that
 *   say "something happened" without saying what. The calendar page already groups them apart
 *   (经济指标 / 财经事件 / 央行活动), and this is that same distinction.
 * - **The United States only.** The official route this chart already draws is US-only by its own
 *   contract, so the chart keeps one calendar rather than mixing a UK print into a US-hours move.
 * - **High importance only**, which is the reader's own rule for these lines (design §7.2).
 *
 * The provider's title is the label: it is what the reader saw in the calendar, and the product keeps
 * no second word list for these events. `titleKey` carries the provider's own event key, since the
 * reducer only needs a stable string there — the official vocabulary has no name for a retail-sales
 * print.
 */
export const crossAssetMarketEventLinePolicy = Object.freeze({
  eventType: 'economic-indicator' as const,
  countryCode: 'US' as const,
  importance: 'high' as const
})

/** The provider's own name for the release, and where other surfaces can look it up again. */
function readEvent(value: unknown): Readonly<{
  eventKey: string; title: string; countryCode: string | null; eventType: string
  importance: string; scheduledAt: string; providerActual?: unknown
  officialEventKey?: string
}> | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  const officialLink = record.officialLink as Record<string, unknown> | undefined
  return Object.freeze({
    eventKey: typeof record.eventKey === 'string' ? record.eventKey : '',
    title: typeof record.title === 'string' ? record.title : '',
    countryCode: typeof record.countryCode === 'string' ? record.countryCode : null,
    eventType: typeof record.eventType === 'string' ? record.eventType : '',
    importance: typeof record.importance === 'string' ? record.importance : '',
    scheduledAt: typeof record.scheduledAt === 'string' ? record.scheduledAt : '',
    ...(record.providerActual === undefined ? {} : { providerActual: record.providerActual }),
    ...(officialLink && typeof officialLink.officialEventKey === 'string' ? { officialEventKey: officialLink.officialEventKey } : {})
  })
}

/**
 * The market route's events this chart may draw, minus the ones the official route already draws.
 *
 * A provider observation that names its official counterpart is that counterpart: its
 * `officialLink.officialEventKey` is the calendar's own identity for the release, so the official row
 * is compared by it rather than by title — the two routes name the same print differently
 * (「消费者物价指数（CPI）」 versus 「9月未季调消费者物价指数(年率)」), and comparing titles would draw
 * one release twice. When the official route has not collected that release, the provider's copy is
 * kept: the line is the reader's only notice that it happened.
 */
/** 会被画进图里的官方事件键（按窗口过滤）。 */
export function officialEventKeysInWindow(
  events: readonly Readonly<{ eventKey: string; atMs: number }>[],
  fromMs: number,
  toMs: number
): readonly string[] {
  // 用 `atMs` 而不是再解析一次时间：那正是画线时用来判断"这条在不在窗口里"的同一个数。
  return events.filter(event => event.atMs >= fromMs && event.atMs <= toMs).map(event => event.eventKey)
}

export function crossAssetMarketEventSources(values: readonly unknown[], officialEventKeys: readonly string[]): readonly CrossAssetEventLineSource[] {
  const official = new Set(officialEventKeys)
  const sources: CrossAssetEventLineSource[] = []
  for (const value of values) {
    const event = readEvent(value)
    if (!event || event.eventKey.length === 0 || event.title.length === 0) continue
    if (event.eventType !== crossAssetMarketEventLinePolicy.eventType) continue
    if (event.countryCode !== crossAssetMarketEventLinePolicy.countryCode) continue
    if (event.importance !== crossAssetMarketEventLinePolicy.importance) continue
    if (event.officialEventKey !== undefined && official.has(event.officialEventKey)) continue
    const atMs = Date.parse(event.scheduledAt)
    if (!Number.isFinite(atMs)) continue
    // 已注册的发布用**官方键**当身份（设计 145 §8 B 的命名映射），所以同一次发布从两条路线来时
    // 图上是一条线；映射缺失或歧义时带上 provider 自己的事件键——它不成身份，去重会退回按措辞。
    const releaseKey = providerReleaseTitleKey(event.title)
    sources.push({
      eventKey: event.eventKey, titleKey: releaseKey ?? event.eventKey, title: event.title, countryCode: event.countryCode,
      importance: 'high', eventType: 'economic-indicator', lifecycleState: providerLifecycleState(event),
      atMs, source: 'market'
    })
  }
  return Object.freeze(sources)
}
