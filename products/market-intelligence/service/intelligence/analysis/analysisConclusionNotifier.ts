import type { NotificationSubmitOutcome, NotificationSubmitRequest } from '@platform/notifications/contracts/notificationContracts'

import { MARKET_INTELLIGENCE_NOTIFICATION_EVENT_IDS } from '../../../contracts/notificationEventKeys'
import {
  analysisConclusionPushesPhone,
  buildAnalysisConclusionRequest,
  type AnalysisPushLanguage
} from './analysisConclusionPush'

/**
 * AI 分析结论推送（N12）的**出站层**：判定层给的结论翻成一次提交。
 *
 * 只在这一个地方拼请求：提交点只有一个（`analysisOrchestrator` 写入记录之后），句子、去重分量、
 * 「只进中心」的收窄值都在这里一次算清。它不读库、不判平台开关、失败不影响这次运行。
 *
 * 「手机那一档」用平台提交契约里的 `narrowedDisruptionLevels` 控制（只能收窄、`center` 不可排除）：
 * 同向时传 `['center']`，于是这条提交只落中心、不排手机；反向时不传，就按批准表全档（含 `channel`）。
 */

export type AnalysisConclusionNotice = Readonly<{
  runId: string
  triggerKey: string
  /** 这一版的统计截止（快照的 asOf）：去重键的第二个分量。 */
  cutoff: string
  summary: string
  conclusionDirection: 'bullish' | 'bearish' | 'range' | 'undecided' | 'mixed'
  /** 结论引用的事实 id；用了信号没带的就是"新信息"。 */
  citedFactIds: readonly string[]
  /** 触发这次运行的信号方向；读不出来就是 `undefined`。 */
  triggerDirection?: 'bullish' | 'bearish'
  /** 信号带的事实 id；读不出来就是空数组（此时只会算"没有新信息"）。 */
  triggerFactIds?: readonly string[]
  /** 证据引用条数：正文里的"证据 N 条"。 */
  citedCount: number
  occurredAt: string
}>

export type AnalysisConclusionNotifierDeps = Readonly<{
  submit: (request: NotificationSubmitRequest) => Promise<NotificationSubmitOutcome>
  now: () => string
  /** 读者时区：日界按它算。 */
  timeZone: () => string
}>

/** 读者时区的「今天」：`YYYY-MM-DD`，只用来给计数分桶，不参与任何显示。 */
export function analysisPushDayOf(now: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now))
  } catch {
    return now.slice(0, 10)
  }
}

export function createAnalysisConclusionNotifier(deps: AnalysisConclusionNotifierDeps): (notice: AnalysisConclusionNotice) => Promise<void> {
  const counts = new Map<string, { day: string; module: number; byTriggerKey: Map<string, number> }>()
  const bucketOf = (now: string, timeZone: string) => {
    const day = analysisPushDayOf(now, timeZone)
    const existing = counts.get(day)
    if (existing !== undefined) return existing
    const fresh = { day, module: 0, byTriggerKey: new Map<string, number>() }
    counts.set(day, fresh)
    return fresh
  }
  return async (notice) => {
    try {
      const now = deps.now()
      const timeZone = deps.timeZone()
      const bucket = bucketOf(now, timeZone)
      const sentToday = { byTriggerKey: bucket.byTriggerKey.get(notice.triggerKey) ?? 0, module: bucket.module }
      const delivery = analysisConclusionPushesPhone({
        ...(notice.triggerDirection === undefined ? {} : { signalDirection: notice.triggerDirection }),
        conclusionDirection: notice.conclusionDirection,
        ...(notice.triggerFactIds === undefined ? {} : { signalFactIds: notice.triggerFactIds }),
        citedFactIds: notice.citedFactIds,
        sentToday
      })
      const centerOnly = delivery.centerOnly
      // 请求由**共用构造器**拼：手动发送那条也走它，两条路径只差去重分量与收窄。
      const request: NotificationSubmitRequest = {
        // 事件 id 写在提交点：生产者门禁只认能静态看见的形态（常量成员、字面量、封闭表查表）。
        eventTypeId: MARKET_INTELLIGENCE_NOTIFICATION_EVENT_IDS.analysisConclusion,
        ...buildAnalysisConclusionRequest({
          summary: notice.summary,
          citedCount: notice.citedCount,
          triggerKey: notice.triggerKey,
          cutoff: notice.cutoff,
          occurredAt: notice.occurredAt,
          // 同向：收窄到中心，手机不响。`center` 平台必达，所以这里传的就是「只剩中心」。
          centerOnly
        })
      }
      await deps.submit(request)
      bucket.module += 1
      bucket.byTriggerKey.set(notice.triggerKey, (bucket.byTriggerKey.get(notice.triggerKey) ?? 0) + 1)
    } catch {
      // 通知是记录的附加物：发不出去不许把一次成功的分析变成失败。
    }
  }
}
