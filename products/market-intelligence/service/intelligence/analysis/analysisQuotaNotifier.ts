import type {
  NotificationSubmitOutcome,
  NotificationSubmitRequest
} from '@platform/notifications/contracts/notificationContracts'
import { renderPlatformEventCopy } from '@platform/notifications/producers/platformEventCopy'

import { RUN_MARKET_ANALYSIS_JOB } from '../jobs/marketAnalysisJobIds'

/**
 * P3「今天的分析次数用完了」：**每日**额度被拒绝的那一刻提交一次（编排里拒绝的那一处）。
 *
 * 一天只发一条不在产品里数次数：键 `quota-exhausted:{date}` 由平台的声明展开，同一天再次命中
 * 就是合并、不再推；再数一遍等于把去重规则写两处，迟早不一致。
 *
 * 键里的日期用 **UTC**：额度是读者看不见的记账（时区口径：看得见的日期跟读者时区，记账用 UTC）。
 * 按读者时区切，跨时区会让同一个「今天」变成两个键、两条提醒。
 *
 * 正文必须带两个数（「今天已用 X / 上限 Y」）：只写「用尽了」，读者不知道差多少。
 * 记录上的 `occurrenceCount` 是「这件事发生了几次」，**不是**「今天被拒了几次」——别拿它当
 * 计数展示给读者，那会读成「第 5 次额度用尽」，比不显示更糊涂。
 * 一条通知发不出去不能把一次拒绝判成故障，所以这里吞掉提交异常、返回 null。
 */
const ANALYSIS_QUOTA_EVENT_ID = 'platform.analysis.quota-exhausted'

export type AnalysisQuotaSubmit = (request: NotificationSubmitRequest) => Promise<NotificationSubmitOutcome>

export type AnalysisQuota = Readonly<{ used: number; limit: number; occurredAt: string }>

/** UTC 自然日（`YYYY-MM-DD`）：记账口径，不跟读者的显示时区走。 */
export function utcDayOf(occurredAt: string): string {
  return new Date(occurredAt).toISOString().slice(0, 10)
}

/**
 * 纯函数：同样的用量与时刻永远得到同一份请求，便于逐字段断言。
 *
 * 句子在**源头**拼好（契约 v2.56）：两种语言各一份进 `rendered`，平台只挑不改。
 * 两个数两种语言都一样，所以走同参数；措辞仍在平台的文案表，产品不写字面量。
 * 拼不出来就返回 `undefined`——调用方不提交（半句话不该发出去）。
 */
export function buildAnalysisQuotaRequest(quota: AnalysisQuota): NotificationSubmitRequest | undefined {
  const rendered = renderPlatformEventCopy({
    eventTypeId: ANALYSIS_QUOTA_EVENT_ID,
    params: { used: String(quota.used), limit: String(quota.limit) }
  })
  if (rendered === undefined) return undefined
  return {
    eventTypeId: ANALYSIS_QUOTA_EVENT_ID,
    // 判定与提交都在分析编排的同一个 handler 里，producerId 用稳定的 handler id（契约 §14.1）。
    producerId: RUN_MARKET_ANALYSIS_JOB,
    dedupeVars: { builder: 'template', vars: { date: utcDayOf(quota.occurredAt) } },
    rendered,
    actions: [],
    occurredAt: quota.occurredAt
  }
}

export async function notifyAnalysisQuota(
  submit: AnalysisQuotaSubmit | undefined,
  quota: AnalysisQuota
): Promise<NotificationSubmitOutcome | null> {
  if (!submit) return null
  const request = buildAnalysisQuotaRequest(quota)
  if (request === undefined) return null
  try {
    return await submit(request)
  } catch {
    // 拒绝已经发生、ledger 已经写好；通知不是事实来源。
    return null
  }
}
