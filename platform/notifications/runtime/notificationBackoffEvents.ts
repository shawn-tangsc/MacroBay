/**
 * 熔断进入 / 解除的 P6 事件（P6a `push-suspended` / P6b `push-resumed`）。
 *
 * 从 runtime 拆出来是为了体积门禁；它只负责构造两条平台事件并交给提交入口，
 * 不碰文件、不碰设置。调用点必须在**投递落盘之后**，否则外层 persist 会覆盖这两条记录。
 */
import type { NotificationSubmitOutcome, NotificationSubmitRequest } from '../contracts/notificationContracts'
import type { NotificationPushTransition } from './notificationRuntimeDelivery'
import { renderPlatformEventCopy } from '../producers/platformEventCopy'

export async function emitBackoffEvent(input: {
  transition: NotificationPushTransition
  now: string
  submit: (request: NotificationSubmitRequest) => Promise<NotificationSubmitOutcome>
}): Promise<void> {
  const channelId = input.transition.channelId
  const deeplink = { scope: 'platform' as const, settingsSectionId: 'notifications' }
  if (input.transition.kind === 'paused') {
    const pausedCopy = renderPlatformEventCopy({ eventTypeId: 'platform.channel.push-suspended' })
    if (pausedCopy === undefined) return
    await input.submit({
      eventTypeId: 'platform.channel.push-suspended',
      rendered: pausedCopy,
      producerId: channelId,
      dedupeVars: { builder: 'template', vars: { channelId } },
      actions: [{
        id: 'open-channel-settings',
        labelKey: 'notification.channelCheck.action',
        kind: 'open',
        deeplink
      }],
      deeplink,
      occurredAt: input.now
    })
    return
  }
  const resumedCopy = renderPlatformEventCopy({ eventTypeId: 'platform.channel.push-resumed' })
  if (resumedCopy === undefined) return
  await input.submit({
    eventTypeId: 'platform.channel.push-resumed',
    rendered: resumedCopy,
    producerId: channelId,
    dedupeVars: { builder: 'template', vars: { channelId, day: input.now.slice(0, 10) } },
    actions: [],
    occurredAt: input.now
  })
}
