import type { NotificationSubmitOutcome, NotificationSubmitRequest } from '@platform/notifications/contracts/notificationContracts'

import type { MarketCalendarEvent } from '../../../contracts/macro/marketCalendarQueryContracts'
import { MARKET_INTELLIGENCE_NOTIFICATION_EVENT_IDS as EVENT_IDS } from '../../../contracts/notificationEventKeys'
import { firstSeenReleaseWindowMs } from '../analysis/significanceChangeMatcher'

/**
 * 「这条日历事件已经落地」出站为一条通知。
 *
 * **触发点在采集侧，不在分析闸门里。** 一件事发生了（数据到了），就该说一次；分析跑不跑是读者的
 * 选择，不该决定「发生了」这件事要不要被说出来。之前挂在分析闸门上，结果是日历照常刷新、读者
 * 什么也收不到——这不是分析的问题，是触发点选错了。
 *
 * 三件事刻意交给平台，不在这里各写一份：
 * - **去重键由模板展开**（`calendar:{eventId}:{releaseAt}`，见 manifest），调用点只交两个变量；
 * - **同一事件重复采集只算一次**，键不变就不会再推一次；
 * - **进哪个表面**（中心 / 通道 / 桌面）由批准表与读者的订阅决定，这里不申请。
 *
 * 没有动作、也没有落点：外壳今天只认设置分区，挂一个点不动的按钮比不挂更糟。
 */

/** 稳定 handler id：换名字会让平台把它当成另一个生产者。 */
export const MACRO_EVENT_LANDED_PRODUCER_ID = 'market-intelligence.calendar-refresh'

export type MacroEventLanding = Readonly<{ eventId: string; releaseAt: string }>

export const macroEventLandedPolicy = Object.freeze({
  /**
   * 只报最近这一天内到点的事件。
   *
   * 这条窗口不承担「这条发布重不重要」——那是阈值的事。它只回答「现在说还来不来得及」：一次
   * 首装或补采会把整月的历史事件读回来，那些不是新闻。与意外信号的「近期发布」共用同一个数，
   * 免得同一个概念出现两个窗口。
   */
  freshnessMs: firstSeenReleaseWindowMs,
  /** 一次刷新最多提交几条：补采一整个月时不该一口气推几十条。 */
  maximumPerRefresh: 20,
  /** 本进程里已经说过的（键相同就不再重复提交）；跨进程由平台去重键兜住。 */
  submittedMemoryMs: 2 * 24 * 60 * 60 * 1_000
})

export type MacroEventLandedSubmit = (request: NotificationSubmitRequest) => Promise<NotificationSubmitOutcome>

/**
 * 这一页里哪些事件已经落地、而且值得现在说。
 *
 * 「落地」= 到点之后拿到了数据（`providerActual` 非空）。没到点的、到了点却还没有公布值的，都
 * 不属于「发生了」；说出去只会让读者点开一个空的详情。
 *
 * 身份用 `observationKey`：`eventKey` 是每批采集的 HMAC，每次刷新都会变，拿它做去重键等于每轮
 * 都当成一条新事件——正好是「一次发布只出一条」要防的事。
 */
export function selectLandedReleases(
  events: readonly MarketCalendarEvent[],
  asOf: string,
  seen?: ReadonlySet<string>
): readonly MacroEventLanding[] {
  const asOfMs = Date.parse(asOf)
  if (!Number.isFinite(asOfMs)) return Object.freeze([])
  const landings: MacroEventLanding[] = []
  for (const event of events) {
    if (event.providerActual === null) continue
    const releaseAt = typeof event.scheduledAt === 'string' ? event.scheduledAt : undefined
    const releasedMs = Date.parse(releaseAt ?? '')
    if (!Number.isFinite(releasedMs) || releasedMs > asOfMs) continue
    if (asOfMs - releasedMs > macroEventLandedPolicy.freshnessMs) continue
    const eventId = typeof event.observationKey === 'string' && event.observationKey.length > 0 ? event.observationKey : event.eventKey
    if (seen?.has(`${eventId}:${releaseAt}`) === true) continue
    landings.push({ eventId, releaseAt: releaseAt! })
    // A month's补采 can carry dozens of rows inside the window; the cap keeps one refresh from
    // turning into a burst the reader has to dismiss.
    if (landings.length >= macroEventLandedPolicy.maximumPerRefresh) break
  }
  return Object.freeze(landings)
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
 * 提交；一条通知发不出去不能把已经写好的采集判成失败，所以吞掉提交异常。
 *
 * 没有提交入口（例如未接通知的运行环境）时静默跳过——采集本身照常完成。
 */
export async function notifyMacroEventLandings(
  submit: MacroEventLandedSubmit | undefined,
  landings: readonly MacroEventLanding[],
  seen?: Map<string, number>
): Promise<number> {
  if (!submit || landings.length === 0) return 0
  let sent = 0
  for (const landing of landings) {
    const key = `${landing.eventId}:${landing.releaseAt}`
    if (seen?.has(key) === true) continue
    const request = buildMacroEventLandedRequest(landing)
    if (request === undefined) continue
    try {
      await submit(request)
      sent += 1
      seen?.set(key, Date.parse(landing.releaseAt) + macroEventLandedPolicy.submittedMemoryMs)
    } catch {
      // 通知不是事实来源：数据已经落库了，一次推不出去不该让这次采集看起来失败。
    }
  }
  return sent
}
