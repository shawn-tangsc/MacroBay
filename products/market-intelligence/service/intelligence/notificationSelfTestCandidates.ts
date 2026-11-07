import type { NotificationSubmitRequest } from '@platform/notifications/contracts/notificationContracts'
import type { CalendarLandedTestCandidate, CalendarUpcomingTestCandidate } from './macro-calendar/calendarNotificationTestCandidates'
import type { SentimentTestCandidateItem } from './news-sentiment/newsSentimentTestCandidate'
import type { TestNoticeCandidate, TestNoticeCandidatePort, TestNoticeKind } from '@platform/notifications/contracts/notificationSelfTest'

/**
 * 三枚测试按钮的**产品侧只读端口**（技术方案 §3）。
 *
 * 平台只认 `TestNoticeCandidatePort` 这一个形状；三条取数分别由两条产品线实现（舆情 / 日历两条），
 * 各自新建只读文件、口径写在自己的注释里。**这一层不猜字段**：谁的那条还没接，就诚实地报
 * `read-failed`（界面「暂时读不到」），绝不返回一条编出来的候选。
 *
 * 口径不在本文件重复——每条查询的窗口、日界、门槛都写在各自的实现里，这里只做「kind → 实现」的分发。
 */
export type SelfTestReaderPorts = Partial<Record<TestNoticeKind, () => Promise<TestNoticeCandidate>>>

export function createNotificationSelfTestCandidates(ports: SelfTestReaderPorts): TestNoticeCandidatePort {
  return async (kind: TestNoticeKind): Promise<TestNoticeCandidate> => {
    const reader = ports[kind]
    if (reader === undefined) return { ok: false, reasonCode: 'read-failed' }
    try {
      return await reader()
    } catch {
      // 取数抛错也是「读不到」，不改写采集、不重试：这个按钮只回答「现在能不能发一条」。
      return { ok: false, reasonCode: 'read-failed' }
    }
  }
}

/**
 * 三条取数的结果 → 平台候选（口径映射按技术方案 §3，**不新增码**）：
 * - 舆情 `none → sentiment-none`；`source-disabled → source-disabled`；
 *   `unreadable / timezone-unreadable → read-failed`（平台的 surface 本来就先判过一次时区）。
 * - 日历 `none-* → calendar-*-none`；`source-disabled → source-disabled`；`unreadable → read-failed`。
 */
export type SelfTestReadOutcome =
  | { kind: 'candidate'; request: NotificationSubmitRequest }
  | { kind: 'none'; reasonCode: 'sentiment-none' | 'calendar-upcoming-none' | 'calendar-landed-none' }
  | { kind: 'source-disabled' }
  | { kind: 'unreadable' }

export function toTestNoticeCandidate(outcome: SelfTestReadOutcome): TestNoticeCandidate {
  if (outcome.kind === 'candidate') return { ok: true, request: outcome.request }
  if (outcome.kind === 'none') return { ok: false, reasonCode: outcome.reasonCode }
  if (outcome.kind === 'source-disabled') return { ok: false, reasonCode: 'source-disabled' }
  return { ok: false, reasonCode: 'read-failed' }
}

/**
 * 三条测试消息的**成品句**（中英各一份，`rendered` 直接交成品，不走键）。
 *
 * **正文首行写死测试标记**（Chief 2026-11-08：哪怕内容是真实候选，读者第一眼必须知道这是测试）。
 * 句子暂借这里：产品文案表今晚在排队，迁走后本文件不再出现读者可见句子（欠账见 BACKLOG）。
 */
const TEST_MARK = { 'zh-CN': '这是测试消息，不是真实提醒。', 'en-US': 'This is a test message, not a real alert.' } as const
const TEST_TITLE = { 'zh-CN': '【测试】', 'en-US': '[Test] ' } as const

function rendered(zhTitle: string, zhBody: string, enTitle: string, enBody: string) {
  return {
    'zh-CN': { title: `${TEST_TITLE['zh-CN']}${zhTitle}`, body: `${TEST_MARK['zh-CN']}\n${zhBody}`, reason: TEST_MARK['zh-CN'] },
    'en-US': { title: `${TEST_TITLE['en-US']}${enTitle}`, body: `${TEST_MARK['en-US']}\n${enBody}`, reason: TEST_MARK['en-US'] }
  }
}

export function buildSentimentTestRequest(item: SentimentTestCandidateItem, now: string): NotificationSubmitRequest {
  return {
    eventTypeId: 'market-intelligence.sentiment.alert',
    // 键口径与真实那条一致，只是测试记录走 `test:` 域（平台规划器加前缀）。
    dedupeVars: { builder: 'template', vars: { storyKey: item.itemId } },
    rendered: rendered(
      `${item.sourceName} 的舆情提醒`,
      `${item.title}（来源：${item.sourceName}，强度档位 ${item.tier}）`,
      `Sentiment alert from ${item.sourceName}`,
      `${item.title} (source: ${item.sourceName}, strength tier ${item.tier})`
    ),
    actions: [],
    occurredAt: now
  }
}

export function buildCalendarUpcomingTestRequest(
  candidate: Extract<CalendarUpcomingTestCandidate, { kind: 'reminder' | 'nearest-future' }>,
  now: string
): NotificationSubmitRequest {
  // 兜底那条必须印**真实发生时间**，否则读者以为「马上就会提醒」（PRD §3.2）。
  const when = candidate.scheduledAt
  const zhWhen = candidate.kind === 'reminder' ? `距开始还有 ${candidate.remainingMinutes} 分钟` : `实际时间：${when}`
  return {
    eventTypeId: 'market-intelligence.calendar.event-upcoming',
    dedupeVars: { builder: 'template', vars: { eventKey: candidate.eventKey, scheduledAt: candidate.scheduledAt } },
    rendered: rendered(`${candidate.title}`, zhWhen, candidate.title, candidate.kind === 'reminder'
      ? `Starts in ${candidate.remainingMinutes} minutes` : `Actual time: ${when}`),
    actions: [],
    occurredAt: now
  }
}

export function buildCalendarLandedTestRequest(
  candidate: Extract<CalendarLandedTestCandidate, { kind: 'landed' }>,
  now: string
): NotificationSubmitRequest {
  return {
    eventTypeId: 'market-intelligence.macro.event-landed',
    dedupeVars: { builder: 'template', vars: { eventId: candidate.eventKey, releaseAt: candidate.scheduledAt } },
    rendered: rendered(`${candidate.title} 已公布`, `实际值：${candidate.actual}`, `${candidate.title} released`, `Actual: ${candidate.actual}`),
    actions: [],
    occurredAt: now
  }
}

/**
 * 装配三个 kind 的端口。**没接的那条诚实地报 `read-failed`**（界面「暂时读不到」），不返回编造的候选。
 *
 * 口径映射只有这一处：读者侧 `none → *-none`；`source-disabled → source-disabled`；
 * `unreadable / timezone-unreadable → read-failed`（平台 surface 已经先判过一次时区）。
 */
export function createIntelligenceSelfTestPort(deps: Readonly<{
  readSentiment?: () => Promise<import('./news-sentiment/newsSentimentTestCandidate').SentimentTestCandidate>
  readUpcoming?: () => Promise<CalendarUpcomingTestCandidate>
  readLanded?: () => Promise<CalendarLandedTestCandidate>
  now: () => string
}>): TestNoticeCandidatePort {
  return async (kind: TestNoticeKind): Promise<TestNoticeCandidate> => {
    try {
      if (kind === 'sentiment') {
        if (deps.readSentiment === undefined) return { ok: false, reasonCode: 'read-failed' }
        const result = await deps.readSentiment()
        if (result.kind === 'candidate') return { ok: true, request: buildSentimentTestRequest(result, deps.now()) }
        if (result.kind === 'none') return { ok: false, reasonCode: 'sentiment-none' }
        if (result.kind === 'source-disabled') return { ok: false, reasonCode: 'source-disabled' }
        return { ok: false, reasonCode: 'read-failed' }
      }
      if (kind === 'calendar-upcoming') {
        if (deps.readUpcoming === undefined) return { ok: false, reasonCode: 'read-failed' }
        const result = await deps.readUpcoming()
        if (result.kind === 'reminder' || result.kind === 'nearest-future') {
          return { ok: true, request: buildCalendarUpcomingTestRequest(result, deps.now()) }
        }
        if (result.kind === 'none-upcoming') return { ok: false, reasonCode: 'calendar-upcoming-none' }
        if (result.kind === 'source-disabled') return { ok: false, reasonCode: 'source-disabled' }
        return { ok: false, reasonCode: 'read-failed' }
      }
      if (deps.readLanded === undefined) return { ok: false, reasonCode: 'read-failed' }
      const result = await deps.readLanded()
      if (result.kind === 'landed') return { ok: true, request: buildCalendarLandedTestRequest(result, deps.now()) }
      if (result.kind === 'none-landed') return { ok: false, reasonCode: 'calendar-landed-none' }
      if (result.kind === 'source-disabled') return { ok: false, reasonCode: 'source-disabled' }
      return { ok: false, reasonCode: 'read-failed' }
    } catch {
      return { ok: false, reasonCode: 'read-failed' }
    }
  }
}
