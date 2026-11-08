import type {
  NotificationSubmitOutcome,
  NotificationSubmitRequest
} from '@platform/notifications/contracts/notificationContracts'
import type { PushChannelResolution } from '@platform/notifications/delivery/pushChannelResolution'

import type {
  IntelligenceTestKind,
  IntelligenceTestReceipt
} from '../../contracts/intelligenceNotificationTest'
import type { IntelligenceModule } from './intelligenceModule'
import {
  calendarLandedTestCandidate,
  calendarUpcomingTestCandidate,
  type CalendarLandedTestEvent,
  type CalendarTestSourceState
} from './macro-calendar/calendarNotificationTestCandidates'
import type { CalendarEventReminderWiring } from './macro-calendar/registerCalendarEventReminder'
import { readSentimentTestCandidate } from './news-sentiment/newsSentimentTestCandidate'
import {
  buildCalendarLandedTestRequest,
  buildCalendarUpcomingTestRequest,
  buildSentimentTestRequest,
  buildIntelligenceTestRequest,
  type TestNotificationPayload
} from './notificationTestRequests'

/**
 * 三枚「发一条…」按钮的主进程实现（产品侧）。
 *
 * 顺序与真实推送**同一条**：先问「这次发给哪条通道」（`resolvePushChannel`，平台唯一的派生入口），
 * 再按 kind 读一份**只读**候选，拼成`NotificationSubmitRequest`，走**同一个**提交入口。
 * 这里不写第二份「恰好一条通道」的判断，也不自己数通道——两处判据迟早一个说能发、一个说不能。
 *
 * 三条边界：
 * 1. **只读**：不触发采集、不写库、不重排作业；
 * 2. **「没有」与「拿不到」分开**：`no-data` 是读到了但没样例，`unavailable` 是发不出去，各有各的句子；
 * 3. **不发就什么都不提交**：读失败时不存在「先发一条空的再说」。
 */
export type IntelligenceTestDeps = Readonly<{
  intelligence: IntelligenceModule
  /** 与真实提醒同一个读取函数（作业原样暴露的那个），测试样例必须与真实链路同源。 */
  calendarReminder: Pick<CalendarEventReminderWiring, 'read' | 'readEvents'>
  /** 日历数据源启用状态：为空 = `disabled`，抛错 = `unreadable`，两者都**不许**用空数组顶替。 */
  readEnabledCalendarFeeds: () => Promise<readonly string[]>
  /** 读者显示时区（壳层 `shellTimeZone().get()`）；空串或抛错都按「读不到时区」处理。 */
  getTimeZone: () => string
  getAppLanguage?: () => Promise<'zh-CN' | 'en-US'>
  /** 平台唯一派生入口：恰好一条 → 用它并交出名字；0 或 ≥2 条 → `push-unavailable` + 真实条数。 */
  resolvePushChannel: () => Promise<PushChannelResolution>
  /** 运行时**同一个**提交入口（和日报「发布到频道」同一个钩子）。 */
  submit: (request: NotificationSubmitRequest) => Promise<NotificationSubmitOutcome>
  now?: () => string
}>

type CandidateRead =
  | Readonly<{ kind: 'request'; payload: TestNotificationPayload }>
  | Readonly<{ kind: 'no-data'; reasonCode: Extract<IntelligenceTestReceipt, { state: 'no-data' }>['reasonCode'] }>
  | Readonly<{
    kind: 'unavailable'
    reasonCode: Extract<IntelligenceTestReceipt, { state: 'unavailable' }>['reasonCode']
  }>

export async function sendIntelligenceTestNotification(
  kind: IntelligenceTestKind,
  deps: IntelligenceTestDeps
): Promise<IntelligenceTestReceipt> {
  // 通道先判：0 条或 ≥2 条都在这条路径上结束，不会先读一遍数据再说发不出去。
  const channel = await deps.resolvePushChannel()
  if (!channel.ok) {
    return { state: 'unavailable', reasonCode: 'push-unavailable', enabledChannelCount: channel.enabledChannelCount }
  }

  const now = (deps.now ?? (() => new Date().toISOString()))()
  const read = await readCandidate(kind, deps, now)
  if (read.kind === 'no-data') return { state: 'no-data', reasonCode: read.reasonCode }
  if (read.kind === 'unavailable') return { state: 'unavailable', reasonCode: read.reasonCode }

  // 实参是**构造函数调用**：事件 id 在那个函数体里是字面量，生产者门禁能静态判出这一处提交的是什么。
  const outcome = await deps.submit(buildIntelligenceTestRequest(kind, read.payload))
  // 提交被拒也是「没发出去」：按闭集里最接近的一档回（`read-failed`），不新造码、不报成功。
  if (outcome.kind === 'rejected') return { state: 'unavailable', reasonCode: 'read-failed' }
  return { state: 'sent', channelId: channel.channelId, channelName: channel.channelName }
}

async function readCandidate(
  kind: IntelligenceTestKind,
  deps: IntelligenceTestDeps,
  now: string
): Promise<CandidateRead> {
  try {
    if (kind === 'sentiment') return await readSentiment(deps, now)
    if (kind === 'calendar-upcoming') return await readUpcoming(deps, now)
    return await readLanded(deps, now)
  } catch {
    // 取数抛错就是「读不到」：不改写采集、不重试，也不编一条样例。
    return { kind: 'unavailable', reasonCode: 'read-failed' }
  }
}

async function readSentiment(deps: IntelligenceTestDeps, now: string): Promise<CandidateRead> {
  const store = deps.intelligence.newsSentiment.store
  if (store === undefined) return { kind: 'unavailable', reasonCode: 'read-failed' }
  const result = await readSentimentTestCandidate({
    store,
    pipeline: deps.intelligence.pipeline,
    readEnabledSourceIds: async () =>
      (await deps.intelligence.sourceProfileStore.listProfiles())
        .filter((profile) => profile.enabled)
        .map((profile) => profile.sourceId),
    // 推送判定读的那份存储，不许在这里另存一份默认值（缺省值与评分服务保持一致：`medium`）。
    readThreshold: () => deps.intelligence.newsSentiment.scoring?.readPushThreshold() ?? 'medium',
    getTimeZone: deps.getTimeZone,
    // 读者要的是**时钟**（它自己取当下），不是已经取好的那一串：传字符串会在它内部当场炸。
    now: () => now
  })
  if (result.kind === 'candidate') return { kind: 'request', payload: buildSentimentTestRequest(result, now) }
  if (result.kind === 'none') return { kind: 'no-data', reasonCode: 'sentiment-none' }
  if (result.kind === 'source-disabled') return { kind: 'unavailable', reasonCode: 'source-disabled' }
  // 时区读不到是**另一件事**：窗口算不出来，让读者去改时区，而不是叫他重试。
  if (result.kind === 'timezone-unreadable') return { kind: 'unavailable', reasonCode: 'timezone-unreadable' }
  return { kind: 'unavailable', reasonCode: 'read-failed' }
}

async function readUpcoming(deps: IntelligenceTestDeps, now: string): Promise<CandidateRead> {
  const source = await calendarSource(deps)
  const result = calendarUpcomingTestCandidate({
    now,
    source,
    settings: deps.calendarReminder.read(),
    events: deps.calendarReminder.readEvents()
  })
  if (result.kind === 'reminder' || result.kind === 'nearest-future') {
    return { kind: 'request', payload: buildCalendarUpcomingTestRequest(result, now) }
  }
  if (result.kind === 'none-upcoming') return { kind: 'no-data', reasonCode: 'calendar-upcoming-none' }
  if (result.kind === 'source-disabled') return { kind: 'unavailable', reasonCode: 'source-disabled' }
  return { kind: 'unavailable', reasonCode: 'read-failed' }
}

async function readLanded(deps: IntelligenceTestDeps, now: string): Promise<CandidateRead> {
  const source = await calendarSource(deps)
  if (source !== 'available') {
    return { kind: 'unavailable', reasonCode: source === 'disabled' ? 'source-disabled' : 'read-failed' }
  }
  const locale = await (deps.getAppLanguage ?? (async () => 'zh-CN' as const))()
  // 本月 + 上月各查一次：跨月那一两天里「最近一条已落地」落上个月，只查本年会把它报成没有。
  for (const month of [monthOf(now), previousMonthOf(now)]) {
    const page = deps.intelligence.publicQueryService.queryMarketCalendarMonth({ month, locale, asOf: now })
    if ((page as { state?: string }).state === 'unavailable') return { kind: 'unavailable', reasonCode: 'read-failed' }
    const events = ((page as { events?: readonly CalendarLandedTestEvent[] }).events ?? [])
    const landed = calendarLandedTestCandidate({ now, source, events })
    if (landed.kind === 'landed') return { kind: 'request', payload: buildCalendarLandedTestRequest(landed, now) }
    if (landed.kind === 'source-disabled') return { kind: 'unavailable', reasonCode: 'source-disabled' }
    if (landed.kind === 'unreadable') return { kind: 'unavailable', reasonCode: 'read-failed' }
  }
  return { kind: 'no-data', reasonCode: 'calendar-landed-none' }
}

async function calendarSource(deps: IntelligenceTestDeps): Promise<CalendarTestSourceState> {
  try {
    const feeds = await deps.readEnabledCalendarFeeds()
    return feeds.length === 0 ? 'disabled' : 'available'
  } catch {
    return 'unreadable'
  }
}

function monthOf(asOf: string): string {
  return asOf.slice(0, 7)
}

function previousMonthOf(asOf: string): string {
  const date = new Date(`${monthOf(asOf)}-01T00:00:00.000Z`)
  date.setUTCMonth(date.getUTCMonth() - 1)
  return date.toISOString().slice(0, 7)
}
