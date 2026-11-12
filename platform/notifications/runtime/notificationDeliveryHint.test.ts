import { describe, expect, it } from 'vitest'

import { createNotificationEventCatalog } from '../contracts/notificationEventCatalog'
import { createDefaultNotificationRuntimeSettings } from '../contracts/notificationContracts'
import type { NotificationSubmitRequest } from '../contracts/notificationContracts'
import { createDefaultNotificationStoreState } from '../store/notificationStore'
import type { ChannelPushHook } from '../delivery/channelPushPort'
import { createNotificationRuntime } from './notificationRuntime'

/**
 * 通知中心那一句「为什么没推到手机」（多通道方案 §5-4）。
 *
 * 只有一个处境在这一笔说得清：**一条可用通道都没有**（`failed` + `push-unavailable`）——
 * 这时用 `notification.deliveryReason.pushUnavailable` 那句。别的失败/未确认各有逐通道结果，
 * 逐行展示等界面设计定稿；这里**不许**拿同一句去套它们（那是把「没接通」说成「这条失败」）。
 */
const catalog = createNotificationEventCatalog({
  sources: [{
    productId: 'platform',
    events: [{
      id: 'platform.hint-probe',
      titleKey: 'notification.event.platform.demo-push.title',
      reasonKey: 'notification.event.platform.demo-push.reason',
      bodyKey: 'notification.event.platform.demo-push.body',
      requiresUserAction: false,
      category: 'reminder',
      requestedDisruptionLevels: ['channel'],
      dedupeKeyTemplate: 'hint:{key}',
      dedupeUnit: 'occurrence'
    }],
    approval: { 'platform.hint-probe': { approvedDisruptionLevels: ['center', 'channel'], approvedBypassQuietHours: false } }
  }]
})

const NOW = '2026-11-12T12:00:00.000Z'

function request(key = 'one'): NotificationSubmitRequest {
  return { eventTypeId: 'platform.hint-probe', actions: [], dedupeVars: { builder: 'template', vars: { key } }, occurredAt: NOW }
}

function harness(options: {
  channels?: readonly { id: string; name: string }[]
  push?: ChannelPushHook
  language?: 'zh-CN' | 'en-US'
} = {}) {
  let state = createDefaultNotificationStoreState()
  const runtime = createNotificationRuntime({
    storage: { read: async () => JSON.parse(JSON.stringify(state)), write: async (next) => { state = JSON.parse(JSON.stringify(next)) as typeof state } },
    catalog,
    diagnostics: () => undefined,
    resolvePushChannels: async () => {
      const list = options.channels ?? []
      return list.length === 0
        ? { ok: false as const, reason: 'push-unavailable' as const, enabledChannelCount: 0, states: {}, requestedCount: 0 }
        : { ok: true as const, channels: list.map((channel) => ({ id: channel.id, name: channel.name })) }
    },
    getSettings: async () => ({ ...createDefaultNotificationRuntimeSettings(), desktopEnabled: false }),
    clock: { now: () => new Date(NOW), timeZone: () => 'Asia/Shanghai' },
    getLanguage: async () => options.language ?? 'zh-CN',
    ...(options.push === undefined ? {} : { deliveryHooks: { push: options.push } })
  })
  return { runtime }
}

async function onlyItem(runtime: ReturnType<typeof harness>['runtime']) {
  const page = await runtime.list({ limit: 10 })
  expect(page.items).toHaveLength(1)
  return page.items[0]!
}

describe('the centre item explains a phone delivery that never went out', () => {
  it('carries "no delivery channel connected" when there is no usable channel', async () => {
    const { runtime } = harness()
    await runtime.submit(request())
    expect((await onlyItem(runtime)).deliveryHint).toBe('这条没接通投递通道')
  })

  it('speaks the reader\'s language', async () => {
    const { runtime } = harness({ language: 'en-US' })
    await runtime.submit(request())
    expect((await onlyItem(runtime)).deliveryHint).toBe('This notification has no delivery channel connected.')
  })

  it('stays silent for other failures: that sentence would be a wrong reason', async () => {
    const { runtime } = harness({
      channels: [{ id: 'channel-a', name: 'Telegram' }],
      push: async (_record, _content, targets) => targets.map((target) => ({
        channelId: target.channelId,
        channelName: target.channelName,
        result: { ok: false, reason: 'channel-rejected' as const }
      }))
    })
    await runtime.submit(request())
    const item = await onlyItem(runtime)
    expect(item.delivery.push).toMatchObject({ state: 'failed' })
    // 通道是接通的，只是这条被拒：复用「没接通通道」那句会把读者指到错误的方向。
    expect(item.deliveryHint).toBeUndefined()
  })

  it('stays silent when the phone delivery succeeded', async () => {
    const { runtime } = harness({
      channels: [{ id: 'channel-a', name: 'Telegram' }],
      push: async (_record, _content, targets) => targets.map((target) => ({
        channelId: target.channelId,
        channelName: target.channelName,
        result: { ok: true, messageId: 'm-1' }
      }))
    })
    await runtime.submit(request())
    expect((await onlyItem(runtime)).deliveryHint).toBeUndefined()
  })
})
