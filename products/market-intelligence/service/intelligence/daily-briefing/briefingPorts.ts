import type {
  NotificationSubmitOutcome,
  NotificationSubmitRequest
} from '@platform/notifications/contracts/notificationContracts'

import type { BriefingRedeliver } from './dailyBriefingPublishToPhone'

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
 * 通知两个入口的转发。缺省时不传这个键（而不是传 undefined），服务端据此区分「未装配」与「装配了但拒绝」。
 */
export function briefingNotificationPorts(hooks: Readonly<{
  submitNotification?: (request: NotificationSubmitRequest) => Promise<NotificationSubmitOutcome>
  redeliverPush?: BriefingRedeliver
}> | undefined): Readonly<{ noticeSubmit?: (request: NotificationSubmitRequest) => Promise<NotificationSubmitOutcome>; redeliverPush?: BriefingRedeliver }> {
  return {
    ...(hooks?.submitNotification ? { noticeSubmit: hooks.submitNotification } : {}),
    ...(hooks?.redeliverPush ? { redeliverPush: hooks.redeliverPush } : {})
  }
}
