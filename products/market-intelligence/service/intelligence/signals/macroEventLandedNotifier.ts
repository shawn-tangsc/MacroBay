import type { NotificationSubmitOutcome, NotificationSubmitRequest } from '@platform/notifications/contracts/notificationContracts'

import { assessMarketCalendarSurprise, exceedsSurpriseTrigger } from '../../../contracts/macro/marketCalendarSurprise'
import type { MarketCalendarEvent } from '../../../contracts/macro/marketCalendarQueryContracts'
import { MARKET_INTELLIGENCE_NOTIFICATION_EVENT_IDS as EVENT_IDS } from '../../../contracts/notificationEventKeys'
import { providerReleaseSurprisePolicy } from '../analysis/providerReleaseSurprisePolicy'
import { firstSeenReleaseWindowMs } from '../analysis/significanceChangeMatcher'

/**
 * 「这条日历发布超出预期」出站为一条通知。
 *
 * **触发点在采集侧，不在分析闸门里。** 发布发生了，就该说一次；分析跑不跑是读者的选择，不该决定
 * 「发生了」要不要被说出来。之前挂在分析闸门上，结果是日历照常刷新、读者什么也收不到——这不是
 * 分析的问题，是触发点选错了。
 *
 * **筛选条件没有跟着变**：`macro.event-landed` 在签字表里写的是「只报超出预期，不报常规发布」。
 * 所以这里沿用分析侧那一条判据——`providerReleaseSurprisePolicy` 的三条边界，加上契约里唯一的
 * 阈值（`exceedsSurpriseTrigger`）。这里**不重算、也不放松**：算不出来的不报，报出来的都过了线。
 * 只挪触发点、不顺手改口径，是这次改动的全部内容。
 *
 * 三件事交给平台：去重键由模板 `calendar:{eventId}:{releaseAt}` 展开；同一事件重复采集只算一次；
 * 进哪个表面由批准表与读者的订阅决定。没有动作、也没有落点——外壳今天只认设置分区。
 */

/** 稳定 handler id：换名字会让平台把它当成另一个生产者。 */
export const MACRO_EVENT_LANDED_PRODUCER_ID = 'market-intelligence.calendar-refresh'

export type MacroEventLanding = Readonly<{ eventId: string; releaseAt: string }>

export const macroEventLandedPolicy = Object.freeze({
  /**
   * 只报最近这一天内到点的发布。
   *
   * 这条窗口不判断「重不重要」——那是阈值的事；它只回答「现在说还来不来得及」：一次首装或补采
   * 会把整月的历史读回来，那些不是新闻。与意外信号的「近期发布」共用同一个数。
   */
  freshnessMs: firstSeenReleaseWindowMs,
  /** 一次刷新最多提交几条：窗口内挤了一批发布时，不该一口气推几十条。 */
  maximumPerRefresh: 20,
  /** 本进程里已经说过的（键相同就不再重复提交）；跨进程由平台去重键兜住。 */
  submittedMemoryMs: 2 * 24 * 60 * 60 * 1_000
})

export type MacroEventLandedSubmit = (request: NotificationSubmitRequest) => Promise<NotificationSubmitOutcome>

/** 一条痕迹：被吞掉多少、失败几次。吞掉不等于看不见。 */
export type MacroEventLandedTrace = (line: Readonly<{
  kind: 'suppressed-not-comparable' | 'suppressed-below-threshold' | 'submit-failed'
  count: number
  detail?: string
}>) => void

export type LandingSelection = Readonly<{
  landings: readonly MacroEventLanding[]
  /**
   * 到了点、也拿到了公布值，却没有通知的条数。
   *
   * 分两种：算不出偏差（缺预期、单位对不上），以及没过阈值（例行发布）。两种都不报，但**必须
   * 能被数出来**——否则「筛得对」和「读漏了」在日志里长得一模一样。
   */
  suppressed: Readonly<{ notComparable: number; belowThreshold: number }>
}>

/**
 * 这一页里哪些发布值得现在说。
 *
 * 判据顺序与旧路径一致：先看是不是这条流管的事（美国 + 高重要性 + 经济指标），再看偏差有没有
 * 过线；「到点」与「拿到了公布值」只是前置条件。身份取 `observationKey`——`eventKey` 是每批采集
 * 的 HMAC，每次刷新都会变，拿它做去重键等于每轮都当成一条新事件。
 */
export function selectLandedReleases(
  events: readonly MarketCalendarEvent[],
  asOf: string,
  seen?: ReadonlySet<string>
): LandingSelection {
  const asOfMs = Date.parse(asOf)
  if (!Number.isFinite(asOfMs)) return Object.freeze({ landings: [], suppressed: { notComparable: 0, belowThreshold: 0 } })
  const policy = providerReleaseSurprisePolicy
  const landings: MacroEventLanding[] = []
  let notComparable = 0
  let belowThreshold = 0
  for (const event of events) {
    if (event.providerActual === null) continue
    const releaseAt = typeof event.scheduledAt === 'string' ? event.scheduledAt : undefined
    const releasedMs = Date.parse(releaseAt ?? '')
    if (!Number.isFinite(releasedMs) || releasedMs > asOfMs) continue
    if (asOfMs - releasedMs > macroEventLandedPolicy.freshnessMs) continue
    // The same three boundaries the analysis line uses; read from its policy, not retyped here.
    if (event.countryCode !== policy.qualifyingCountryCode) continue
    if (event.importance !== policy.qualifyingImportance) continue
    if (event.eventType !== policy.qualifyingEventFamily) continue
    const assessment = assessMarketCalendarSurprise(event.providerActual, event.consensus)
    if (!exceedsSurpriseTrigger(assessment)) {
      if (assessment.absoluteDifference === null) notComparable += 1
      else belowThreshold += 1
      continue
    }
    const eventId = typeof event.observationKey === 'string' && event.observationKey.length > 0 ? event.observationKey : event.eventKey
    if (seen?.has(`${eventId}:${releaseAt}`) === true) continue
    landings.push({ eventId, releaseAt: releaseAt! })
    // 一批补采可能把窗口内好几条都读回来；上限让一次刷新不至于变成一串要人逐条划掉的推送。
    if (landings.length >= macroEventLandedPolicy.maximumPerRefresh) break
  }
  return Object.freeze({ landings: Object.freeze(landings), suppressed: Object.freeze({ notComparable, belowThreshold }) })
}

/** 一条落地 → 一次提交。只填参数，不填句子：标题与正文由平台的文案键按事件 id 解析。 */
export function buildMacroEventLandedRequest(landing: MacroEventLanding): NotificationSubmitRequest | undefined {
  if (typeof landing.eventId !== 'string' || landing.eventId === '') return undefined
  if (!Number.isFinite(Date.parse(landing.releaseAt))) return undefined
  return {
    eventTypeId: EVENT_IDS.macroEventLanded,
    producerId: MACRO_EVENT_LANDED_PRODUCER_ID,
    dedupeVars: { builder: 'template', vars: { eventId: landing.eventId, releaseAt: landing.releaseAt } },
    actions: [],
    // 数据描述的那个时刻，不是我们发现的时刻：晚到的数据仍属于它自己那条发布。
    occurredAt: landing.releaseAt
  }
}

/**
 * 提交；一条通知发不出去不能把已经写好的采集判成失败，所以吞掉提交异常——**但留下痕迹**。
 *
 * 空 catch 与「本来就没有事件」同形：今天已经有一条红被它藏了半天。这里把次数交给 `trace`，
 * 默认写一行日志，计数与原因都要能看见。
 */
export async function notifyMacroEventLandings(
  submit: MacroEventLandedSubmit | undefined,
  landings: readonly MacroEventLanding[],
  seen?: Map<string, number>,
  trace?: MacroEventLandedTrace
): Promise<number> {
  if (!submit || landings.length === 0) return 0
  let sent = 0
  let failed = 0
  let lastError: string | undefined
  for (const landing of landings) {
    const key = `${landing.eventId}:${landing.releaseAt}`
    if (seen?.has(key) === true) continue
    const request = buildMacroEventLandedRequest(landing)
    if (request === undefined) continue
    try {
      await submit(request)
      sent += 1
      seen?.set(key, Date.parse(landing.releaseAt) + macroEventLandedPolicy.submittedMemoryMs)
    } catch (error) {
      failed += 1
      lastError = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    }
  }
  if (failed > 0) {
    const line = { kind: 'submit-failed' as const, count: failed, ...(lastError === undefined ? {} : { detail: lastError }) }
    if (trace) trace(line)
    else console.warn(`[macro-calendar] ${failed} 条发布通知没有提交成功${lastError ? `：${lastError}` : ''}`)
  }
  return sent
}
