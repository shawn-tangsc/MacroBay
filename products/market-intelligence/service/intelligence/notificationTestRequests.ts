import type { NotificationSubmitRequest } from '@platform/notifications/contracts/notificationContracts'

import type {
  CalendarLandedTestCandidate,
  CalendarUpcomingTestCandidate
} from './macro-calendar/calendarNotificationTestCandidates'
import type { SentimentTestCandidateItem } from './news-sentiment/newsSentimentTestCandidate'

/**
 * 三条测试消息的**成品句**（中英各一份）。
 *
 * 两句写死在这里，原因不同：
 * - 正文首行的测试标记是**功能**：哪怕内容是真实候选，读者第一眼必须知道这是测试（Chief 2026-11-08）；
 * - 其余正文是样例本身的说明（来源、强度档位、距开始几分钟、实际值）。
 *
 * 都进 `test:` 去重域（`namespace: 'test'`）：测试不吃真实通知的键，也绝不占用它们。
 */
const TEST_MARK = { 'zh-CN': '这是测试消息，不是真实提醒。', 'en-US': 'This is a test message, not a real alert.' } as const
const TEST_TITLE = { 'zh-CN': '【测试】', 'en-US': '[Test] ' } as const

function rendered(zhTitle: string, zhBody: string, enTitle: string, enBody: string) {
  return {
    'zh-CN': { title: `${TEST_TITLE['zh-CN']}${zhTitle}`, body: `${TEST_MARK['zh-CN']}\n${zhBody}`, reason: TEST_MARK['zh-CN'] },
    'en-US': { title: `${TEST_TITLE['en-US']}${enTitle}`, body: `${TEST_MARK['en-US']}\n${enBody}`, reason: TEST_MARK['en-US'] }
  } as const
}

/**
 * 舆情样例 → 提交请求。
 *
 * 事件 id 与去重键口径与**真实那条完全一致**（`sentiment-alert:{storyKey}`），区别只在
 * `namespace: 'test'`：同一条消息在测试域里发，真实域里的键一个都不占。
 */
export function buildSentimentTestRequest(item: SentimentTestCandidateItem, now: string): NotificationSubmitRequest {
  return {
    eventTypeId: 'market-intelligence.sentiment.alert',
    namespace: 'test',
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

/** 「开始前」样例：窗口内那条印剩余分钟，兜底那条必须印**真实发生时间**（否则读者以为马上会提醒）。 */
export function buildCalendarUpcomingTestRequest(
  candidate: Extract<CalendarUpcomingTestCandidate, { kind: 'reminder' | 'nearest-future' }>,
  now: string
): NotificationSubmitRequest {
  const when = candidate.scheduledAt
  const zhWhen = candidate.kind === 'reminder' ? `距开始还有 ${candidate.remainingMinutes} 分钟` : `实际时间：${when}`
  return {
    eventTypeId: 'market-intelligence.calendar.event-upcoming',
    namespace: 'test',
    dedupeVars: { builder: 'template', vars: { eventKey: candidate.eventKey, scheduledAt: candidate.scheduledAt } },
    rendered: rendered(
      candidate.title,
      zhWhen,
      candidate.title,
      candidate.kind === 'reminder' ? `Starts in ${candidate.remainingMinutes} minutes` : `Actual time: ${when}`
    ),
    actions: [],
    occurredAt: now
  }
}

/** 「结果公布」样例：正文给实际值原文，与事件详情里显示的是同一个字段。 */
export function buildCalendarLandedTestRequest(
  candidate: Extract<CalendarLandedTestCandidate, { kind: 'landed' }>,
  now: string
): NotificationSubmitRequest {
  return {
    eventTypeId: 'market-intelligence.macro.event-landed',
    namespace: 'test',
    dedupeVars: { builder: 'template', vars: { eventId: candidate.eventKey, releaseAt: candidate.scheduledAt } },
    rendered: rendered(
      `${candidate.title} 已公布`,
      `实际值：${candidate.actual}`,
      `${candidate.title} released`,
      `Actual: ${candidate.actual}`
    ),
    actions: [],
    occurredAt: now
  }
}
