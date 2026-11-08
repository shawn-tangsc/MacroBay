import type { RuntimeStateRecord } from '@platform/jobs'
import type {
  NotificationSubmitOutcome,
  NotificationSubmitRequest
} from '@platform/notifications/contracts/notificationContracts'

import {
  createSourceIssueNotifier,
  silenceHoursBySource,
  type SourceIssueNotifier
} from './sourceIssueNotifier'

/**
 * 「来源事件」（连续失败 / 静默）的接线，从 `intelligenceModule.ts` 搬出来只为体量门禁，
 * 逻辑没有多一层：创建时不读运行时状态，等 pipeline 建好再 `bindRuntimeStates`。
 *
 * 为什么要 bind 而不是直接传 pipeline：这条通知是 pipeline 的依赖（采集一落盘就可能触发），
 * 而诊断里那行「同一刻各源静默多久」又要读 pipeline 的状态——先后成环，所以用一次后绑定。
 */
export function createSourceIssueWiring(deps: Readonly<{
  submit?: (request: NotificationSubmitRequest) => Promise<NotificationSubmitOutcome>
  defaultFreshnessMs: number
  timeZone: () => string
  log?: (level: 'info' | 'warn' | 'error', event: string, fields?: Record<string, unknown>) => void
}>): Readonly<{
  notifier?: SourceIssueNotifier
  bindRuntimeStates: (read: () => readonly RuntimeStateRecord[]) => void
}> {
  let readStates: () => readonly RuntimeStateRecord[] = () => []
  const notifier = deps.submit === undefined
    ? undefined
    : createSourceIssueNotifier({
        submit: deps.submit,
        defaultFreshnessMs: deps.defaultFreshnessMs,
        timeZone: deps.timeZone,
        ...(deps.log === undefined ? {} : { log: deps.log }),
        silenceHours: () => silenceHoursBySource(readStates(), new Date().toISOString())
      })
  return {
    ...(notifier === undefined ? {} : { notifier }),
    bindRuntimeStates: (read) => { readStates = read }
  }
}
