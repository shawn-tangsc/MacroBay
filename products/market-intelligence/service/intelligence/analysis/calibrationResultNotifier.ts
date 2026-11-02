import type {
  NotificationSubmitOutcome,
  NotificationSubmitRequest
} from '@platform/notifications/contracts/notificationContracts'
import { MARKET_INTELLIGENCE_NOTIFICATION_EVENT_IDS as EVENT_IDS } from '../../../contracts/notificationEventKeys'
import { VERIFY_MARKET_ANALYSIS_PREDICTIONS_JOB } from '../jobs/marketAnalysisJobIds'

/**
 * 判定账本结算完成时的一条通知（`calibration.result`）。
 *
 * 只在 `verifyDue` 真的结了至少一条时提交：没有结算就没有「出结果了」这件事，空提交会让
 * 「一天一条」变成「一天读一次页面一条」。
 *
 * 键的日期用 **UTC**：它是读者看不见的记账（时区口径：看得见的日期跟读者时区，看不见的记账用
 * UTC）。改成读者时区会让同一天的结算在跨时区时算出两个键。
 *
 * 完成类事件按订阅（`notifyOnlyIfSubscribed`）：没勾就直接被平台抑制，不落库、不投递。
 */
export type CalibrationResultSubmit = (request: NotificationSubmitRequest) => Promise<NotificationSubmitOutcome>

export function buildCalibrationResultRequest(date: string, occurredAt: string): NotificationSubmitRequest {
  return {
    eventTypeId: EVENT_IDS.calibrationResult,
    producerId: VERIFY_MARKET_ANALYSIS_PREDICTIONS_JOB,
    dedupeVars: { builder: 'template', vars: { date } },
    actions: [],
    occurredAt
  }
}

/** 结算已经落库；一条通知发不出去不能把它判成失败，所以吞掉提交异常。 */
export async function notifyCalibrationResult(
  submit: CalibrationResultSubmit | undefined,
  date: string,
  occurredAt: string
): Promise<void> {
  if (!submit) return
  try {
    await submit(buildCalibrationResultRequest(date, occurredAt))
  } catch {
    // 记录与账本都已经写好了，通知不是事实来源。
  }
}
