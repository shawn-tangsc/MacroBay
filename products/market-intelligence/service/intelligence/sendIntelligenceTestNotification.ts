import type {
  NotificationSubmitOutcome,
  NotificationSubmitRequest
} from '@platform/notifications/contracts/notificationContracts'
import type { PushChannelResolution } from '@platform/notifications/delivery/pushChannelResolution'

import type {
  IntelligenceTestKind,
  IntelligenceTestReceipt
} from '../../contracts/intelligenceNotificationTest'
import {
  buildCalendarLandedTestRequest,
  buildCalendarUpcomingTestRequest,
  buildIntelligenceTestRequest,
  buildSentimentTestRequest,
  type TestNotificationPayload
} from './notificationTestRequests'

/**
 * 三枚「发一条…」按钮的主进程实现（产品侧）。
 *
 * **测试只为验证通路**（用户 2026-11-10 定）：不读真实日历、不读真实源、不读真实舆情；
 * 四种 kind 都用内置样例（固定事件名、固定偏移时间、按读者语言给句子）。所以「没数据」不再是
 * 测试失败的原因——点下去只有两种结果：**发出去了**（点名通道）或**传输层原因**（没有可用通道、
 * 提交被拒）。这也顺手去掉了旧路径里「把应用语言塞进只收两字母的查询」那类自伤。
 *
 * 顺序与真实推送同一条：先问「这次发给哪条通道」（平台唯一派生入口），再用同一个提交入口发出去。
 */
export type IntelligenceTestDeps = Readonly<{
  /** 只影响样例句子的语言（`zh-CN` / `en-US`）；缺省中文。 */
  getAppLanguage?: () => Promise<'zh-CN' | 'en-US'>
  /** 平台唯一派生入口：恰好一条 → 用它并交出名字；0 或 ≥2 条 → `push-unavailable` + 真实条数。 */
  resolvePushChannel: () => Promise<PushChannelResolution>
  /** 运行时**同一个**提交入口（和日报「发布到频道」同一个钩子）。 */
  submit: (request: NotificationSubmitRequest) => Promise<NotificationSubmitOutcome>
  now?: () => string
}>

/** 内置样例：固定的事件名与相对时间，用来证明「这条链路能通」，不代表任何一条真实数据。 */
const SAMPLE_MINUTE = 60_000

function sampleEventTitle(language: 'zh-CN' | 'en-US'): string {
  return language === 'en-US' ? 'US nonfarm payrolls (sample)' : '美国非农就业人数（样例）'
}

function shifted(now: string, offsetMs: number): string {
  const parsed = Date.parse(now)
  return new Date((Number.isFinite(parsed) ? parsed : Date.now()) + offsetMs).toISOString()
}

export function buildSampleTestPayload(
  kind: IntelligenceTestKind,
  now: string,
  language: 'zh-CN' | 'en-US'
): TestNotificationPayload {
  const title = sampleEventTitle(language)
  if (kind === 'sentiment') {
    return buildSentimentTestRequest({
      itemId: 'test-sample-sentiment',
      title: language === 'en-US' ? 'Sample headline: liquidity tightens (sample)' : '样例标题：流动性边际收紧（样例）',
      sourceId: 'test-sample',
      sourceName: language === 'en-US' ? 'Sample source' : '样例来源',
      publishedAt: now,
      polarity: 'bearish',
      strength: 4,
      tier: 'high',
      confidence: 0.9,
      engine: 'rules'
    }, now)
  }
  if (kind === 'calendar-upcoming') {
    return buildCalendarUpcomingTestRequest({
      kind: 'reminder',
      eventKey: 'test-sample-upcoming',
      title,
      scheduledAt: shifted(now, 30 * SAMPLE_MINUTE),
      importance: 'high',
      remainingMinutes: 30
    }, now)
  }
  return buildCalendarLandedTestRequest({
    kind: 'landed',
    eventKey: 'test-sample-landed',
    title,
    scheduledAt: shifted(now, -60 * SAMPLE_MINUTE),
    importance: 'high',
    actual: '3.2%'
  }, now)
}

export async function sendIntelligenceTestNotification(
  kind: IntelligenceTestKind,
  deps: IntelligenceTestDeps
): Promise<IntelligenceTestReceipt> {
  // 通道先判：0 条或 ≥2 条都在这条路径上结束，不会先拼一条样例再说发不出去。
  const channel = await deps.resolvePushChannel()
  if (!channel.ok) {
    return { state: 'unavailable', reasonCode: 'push-unavailable', enabledChannelCount: channel.enabledChannelCount }
  }

  const now = (deps.now ?? (() => new Date().toISOString()))()
  const language = await (deps.getAppLanguage ?? (async () => 'zh-CN' as const))()
  const outcome = await deps.submit(buildIntelligenceTestRequest(kind, buildSampleTestPayload(kind, now, language)))
  if (outcome.kind === 'rejected') return { state: 'unavailable', reasonCode: 'read-failed' }
  if (outcome.kind === 'collapsed') return { state: 'unavailable', reasonCode: 'not-attempted' }
  if (outcome.kind === 'delegated') return { state: 'unavailable', reasonCode: 'not-attempted' }
  // 合并：这一条并进了已有的那条，**这次没发生投递**——回「已发到手机」就是假事实。
  if (outcome.kind === 'merged') return { state: 'unavailable', reasonCode: 'not-attempted' }

  // 提交被接受 ≠ 手机响了。回执只认**通道那一跳的真实证据**（`delivery.push`，与记录同源）：
  const push = outcome.delivery?.push?.state
  if (push === 'sent-accepted') return { state: 'sent', channelId: channel.channelId, channelName: channel.channelName }
  if (push === 'sent-unconfirmed') return { state: 'unavailable', reasonCode: 'unknown-after-send' }
  if (push === 'failed') return { state: 'unavailable', reasonCode: 'channel-rejected' }
  // 没有 push 条目：通道这一档根本没被尝试（免打扰/开关/未批准都在上游就挡掉了）。
  return { state: 'unavailable', reasonCode: 'not-attempted' }
}
