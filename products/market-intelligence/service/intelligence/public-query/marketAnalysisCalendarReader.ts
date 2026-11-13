import {
  isMarketCalendarPage,
  type MarketCalendarEvent,
  type MarketCalendarPage
} from '../../../contracts/macro/marketCalendarQueryContracts'
import { marketCalendarReleaseGroupByMetricKey } from '../macro-calendar/marketCalendarReleaseGroups'
import { tierOfMetricKey } from '../macro-calendar/marketCalendarMetricTiers'
import {
  marketCalendarObservationPolicy,
  normalizeMarketCalendarEvent,
  type MacroCalendarProviderObservation,
  type MacroCalendarProviderObservationSet
} from '../macro-calendar/marketCalendarObservationNormalization'
import { selectMacroCalendarAdmissions, type MacroCalendarAdmissionRow } from './macroCalendarAdmission'

/**
 * 分析侧读一个月日历：**只读一个入口**，不再单独读官方日历。
 *
 * 标准表把官方与市场写在同一处，页面（视图）里已经包含官方行；再调官方日历查询，同一次发布
 * 就会以两个来源各出现一次——那正是「同一事实两份证据」的来源。
 *
 * 这里只做三件事，且只在这里做：
 * 1. **翻页**：一页 100 条，一个月远不止一页；只读第一页会得「市场侧少了」的结论；
 * 2. **配额**：同一发布组最多 1 条（主测度常量落地后改 2）、总额度 16；
 * 3. **估算**：`includeEstimates: true` 让页带估算行，`rowKind` 分辨，按身份取最新。
 */

export const marketAnalysisCalendarReadPolicy = Object.freeze({
  /** 与旧读法同一档总额度：切换前后上下文里日历事实的数量级不跳变。 */
  maximumObservations: 16,
  /** `is_primary` 常量还没落代码，组内只进 1 条，不按字典序凑第二条。 */
  maximumPerGroup: 1,
  /** 与旧读法同一个翻页上限：十二页覆盖一个月约六百条。 */
  maximumPages: 12,
  locale: 'zh' as const
})

type Query = (input: unknown) => MarketCalendarPage

export function readAnalysisCalendarMonth(
  query: Query,
  scope: Readonly<{ month: string; asOf: string }>
): MacroCalendarProviderObservationSet {
  const caveats = new Set<string>()
  const events: MarketCalendarEvent[] = []
  const seen = new Set<string>()
  try {
    let cursor: string | undefined
    let pages = 0
    do {
      const request = {
        month: scope.month, locale: marketAnalysisCalendarReadPolicy.locale, asOf: scope.asOf,
        includeEstimates: true, ...(cursor ? { cursor } : {})
      }
      const page = query(request)
      if (!isMarketCalendarPage(page, request) || page.state !== 'available') {
        caveats.add(marketCalendarObservationPolicy.caveats.pageUnavailable)
        break
      }
      for (const event of page.events) {
        const key = event.observationKey ?? event.eventKey
        if (seen.has(key)) continue
        seen.add(key)
        events.push(event)
      }
      cursor = page.nextCursor
      pages += 1
      if (cursor && pages >= marketAnalysisCalendarReadPolicy.maximumPages) {
        caveats.add(marketCalendarObservationPolicy.caveats.pagesTruncated)
        break
      }
    } while (cursor)
  } catch {
    caveats.add(marketCalendarObservationPolicy.caveats.pageUnavailable)
  }
  // 读成功但一个月没有发布：带 `available` 回去，调用方才能说「空」而不是「读不到」。
  if (events.length === 0) {
    const readState = caveats.has(marketCalendarObservationPolicy.caveats.pageUnavailable) ? 'unavailable' as const : 'available' as const
    return { observations: [], caveats: [...caveats], readState }
  }

  const rows = events.map(event => toAdmissionRow(event, scope.asOf))
  const selection = selectMacroCalendarAdmissions(rows, {
    maximumRows: marketAnalysisCalendarReadPolicy.maximumObservations,
    maximumPerGroup: marketAnalysisCalendarReadPolicy.maximumPerGroup
  })
  const admitted = new Set(selection.admitted.map(row => row.identity))
  // 每个准入身份只取一行：估算每天更新一次，按身份（国家|码|期间）只留最新那条，
  // 逐行成事实就是「同一估算多份证据」。
  const chosenByIdentity = new Map<string, MarketCalendarEvent>()
  for (const event of events) {
    const identity = admissionIdentity(event)
    if (!admitted.has(identity)) continue
    const previous = chosenByIdentity.get(identity)
    if (!previous || Date.parse(event.sourceObservedAt ?? '') >= Date.parse(previous.sourceObservedAt ?? '')) {
      chosenByIdentity.set(identity, event)
    }
  }
  const observations: MacroCalendarProviderObservation[] = []
  for (const event of chosenByIdentity.values()) {
    const observation = normalizeMarketCalendarEvent(event)
    // 算不出稳定身份的行：报缺口，不静默丢。
    if (!observation) { caveats.add(marketCalendarObservationPolicy.caveats.identityMissing); continue }
    observations.push(observation)
  }
  if (selection.droppedByTotal > 0 || selection.droppedByGroup > 0) caveats.add(marketCalendarObservationPolicy.caveats.observationsTruncated)
  // 一级指标在整月里一条都没有：读成功了（否则早已是 pageUnavailable），所以这不是「读不到」，
  // 而是「这个月没有一级发布」——多半是排期还没到。两者必须分开写，否则读者无法判断该不该担心。
  if (!events.some(event => event.eventNameKey !== undefined && tierOfMetricKey(event.eventNameKey) === 1)) {
    caveats.add('tier1-absent-in-month')
  }
  return { observations, caveats: [...caveats], readState: 'available' }
}

/**
 * 稳定身份：`observationKey` 优先（跨采集不变），缺失时退回事件键（同一次查询内唯一）。
 *
 * 估算的身份**不含发布日**（`国家|码|期间`）：即时预测每天更新一次、每天一行，带上日期就
 * 变成「三个不同的估算」；发布行的身份带日期，初值与终值才是两次发布。
 */
function admissionIdentity(event: MarketCalendarEvent): string {
  const base = event.observationKey ?? `event:${event.eventKey}`
  if (event.rowKind !== 'estimate') return base
  const parts = base.split('|')
  return parts.length === 4 ? parts.slice(0, 3).join('|') : base
}

function toAdmissionRow(event: MarketCalendarEvent, asOf: string): MacroCalendarAdmissionRow {
  const group = event.eventNameKey === undefined
    ? ''
    : marketCalendarReleaseGroupByMetricKey[event.eventNameKey] ?? ''
  const scheduledMs = Date.parse(event.scheduledAt ?? '')
  return Object.freeze({
    identity: admissionIdentity(event),
    releaseGroup: group,
    // 页面事件的 `importance` 现在是占位（市场行源里没有这一列）；配额不按它分高下，
    // 一律最低档，排序只由「有无值 → 贴近度 → 身份」决定。
    importance: 'low' as const,
    hasValue: Boolean(event.providerActual ?? event.consensus ?? event.providerPrevious),
    distanceMs: Number.isFinite(scheduledMs) ? Math.abs(Date.parse(asOf) - scheduledMs) : Number.MAX_SAFE_INTEGER,
    isEstimate: event.rowKind === 'estimate',
    observedAtMs: Date.parse(event.sourceObservedAt ?? '') || 0,
    ...(event.eventNameKey === undefined ? {} : { tier: tierOfMetricKey(event.eventNameKey) })
  })
}
