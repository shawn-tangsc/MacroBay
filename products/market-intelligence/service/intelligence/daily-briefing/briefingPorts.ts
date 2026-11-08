import type {
  NotificationSubmitOutcome,
  NotificationSubmitRequest
} from '@platform/notifications/contracts/notificationContracts'

import type { BriefingRedeliver } from './dailyBriefingPublishToPhone'
import type { BriefingDiagnosticLog } from './dailyBriefReadinessGate'

/**
 * 日报这条线在装配根上被注入的端口，两个都收在这里：**日历补跑命令**与**通知两个入口**。
 *
 * 放一起是因为它们同属「组合根交给简报的东西」，各自只是一行转发——留在 `intelligenceModule`
 * 里会让那个文件每加一个端口就长一截（同一个月已经抓过两次体积）。
 */

/** 读者/排期触发的一次补跑：有超时上限，返回结果不重要，失败由调用方当「这次没补上」。 */
export type BriefingCalendarRefresh = (input: { timeoutMs: number }) => Promise<unknown>

export type BriefingCalendarCommands = { refreshNow?: BriefingCalendarRefresh }

/**
 * 补跑命令的持有者：**没绑时是 `undefined`**，与「绑了但调用失败」是两个分支，不能混成一个默认函数。
 */
export function createBriefingCalendarCommands(): Readonly<{
  commands: BriefingCalendarCommands
  bind: (refresh: BriefingCalendarRefresh) => void
}> {
  const commands: BriefingCalendarCommands = {}
  return { commands, bind: (refresh) => { commands.refreshNow = refresh } }
}

/**
 * 装配根交给简报的端口：通知两个入口 + 一条结构化诊断出口。缺省时不传这个键（而不是传 undefined），
 * 服务端据此区分「未装配」与「装配了但拒绝」。
 */
export function briefingNotificationPorts(hooks: Readonly<{
  submitNotification?: (request: NotificationSubmitRequest) => Promise<NotificationSubmitOutcome>
  redeliverPush?: BriefingRedeliver
  log?: BriefingDiagnosticLog
}> | undefined): Readonly<{
  noticeSubmit?: (request: NotificationSubmitRequest) => Promise<NotificationSubmitOutcome>
  redeliverPush?: BriefingRedeliver
  log?: BriefingDiagnosticLog
}> {
  const submit = hooks?.submitNotification
  if (!submit) {
    // 没有通知端口时整条链静默——2026-11-07 那两条通知查不出来的正是这一点。装配期记一条。
    hooks?.log?.('warn', 'MI_DAILY_BRIEF_NOTICE_PORT_MISSING', { at: 'wiring' })
    return {
      ...(hooks?.redeliverPush ? { redeliverPush: hooks.redeliverPush } : {}),
      ...(hooks?.log ? { log: hooks.log } : {})
    }
  }
  return {
    // 提交结果与原因必须留痕：平台会静默拒收（未知事件类型、免打扰、上限、审批未通过…），
    // 而 `notifyDailyBriefing` 自己会把异常吞掉。判"发没发"以库里记录为准，"为什么没发"读日志。
    noticeSubmit: async (request) => {
      try {
        const outcome = await submit(request)
        if (outcome.kind !== 'accepted' && outcome.kind !== 'merged') {
          hooks?.log?.('warn', 'MI_DAILY_BRIEF_NOTICE_NOT_DELIVERED', {
            eventTypeId: request.eventTypeId,
            outcome: outcome.kind,
            ...('reason' in outcome && outcome.reason ? { reason: outcome.reason } : {})
          })
        }
        return outcome
      } catch (error) {
        hooks?.log?.('error', 'MI_DAILY_BRIEF_NOTICE_SUBMIT_FAILED', {
          eventTypeId: request.eventTypeId,
          message: error instanceof Error ? error.message : String(error)
        })
        throw error
      }
    },
    ...(hooks?.redeliverPush ? { redeliverPush: hooks.redeliverPush } : {}),
    ...(hooks?.log ? { log: hooks.log } : {})
  }
}
