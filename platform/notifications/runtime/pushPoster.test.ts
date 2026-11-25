import { describe, expect, it, vi } from 'vitest'

import { createDefaultNotificationRuntimeSettings } from '../contracts/notificationContracts'
import type { NotificationSubmitRequest } from '../contracts/notificationContracts'
import { createNotificationEventCatalog } from '../contracts/notificationEventCatalog'
import { PLATFORM_NOTIFICATION_APPROVALS, PLATFORM_NOTIFICATION_EVENTS } from '../contracts/platformNotificationEvents'
import { createDefaultNotificationStoreState } from '../store/notificationStore'
import type { ChannelPushAttempt, ChannelPushHook, ChannelPushTarget } from '../delivery/channelPushPort'
import type { ChannelPosterPushAttempt, ChannelPosterPushHook } from '../delivery/channelPosterPushPort'
import { createNotificationRuntime } from './notificationRuntime'
import type { NotificationStorage } from './notificationRuntime'

/**
 * 简报海报随推送发出（方案 §12.1/§12.4）：**正文 → 正文受理了才发图**，两条账分开记。
 *
 * 这一组用例守的是两个**不能反过来**的裁决：
 * - A：海报失败**不挡**正文（正文实际已发出，标成失败就是假红）；
 * - B：正文失败**不发**海报（读者不该只收到一张没有正文的图）。
 */
const catalog = createNotificationEventCatalog({
  sources: [{
    productId: 'platform',
    events: PLATFORM_NOTIFICATION_EVENTS,
    approval: PLATFORM_NOTIFICATION_APPROVALS
  }, {
    productId: 'platform',
    events: [{
      id: 'platform.poster-push',
      titleKey: 'notification.event.platform.demo-push.title',
      reasonKey: 'notification.event.platform.demo-push.reason',
      bodyKey: 'notification.event.platform.demo-push.body',
      requiresUserAction: false,
      category: 'reminder',
      requestedDisruptionLevels: ['channel'],
      dedupeKeyTemplate: 'poster:{key}',
      dedupeUnit: 'occurrence'
    }],
    approval: { 'platform.poster-push': { approvedDisruptionLevels: ['center', 'channel'], approvedBypassQuietHours: false } }
  }]
})

const NOW = '2026-11-22T00:30:00.000Z'
const HASH = 'a1b2c3d4e5f60718'

function request(input: { withPoster?: boolean } = {}): NotificationSubmitRequest {
  return {
    eventTypeId: 'platform.poster-push',
    actions: [],
    dedupeVars: { builder: 'template', vars: { key: 'one' } },
    occurredAt: NOW,
    edition: { editionId: '2026-11-22:zh-CN:default', locale: 'zh-CN' },
    // 与正文**同一次版次读取**产生（方案 §12.3）；不带＝这一版没有海报。
    ...(input.withPoster === false ? {} : { editionPoster: { contentHash: HASH } })
  }
}

const ready = (id: string) => ({ id, name: id.toUpperCase(), state: 'runtime-ready' })

function harness(options: {
  channels?: readonly { id: string; name: string; state: string }[]
  textResult?: (channelId: string) => ChannelPushAttempt['result']
  posterResult?: (channelId: string) => ChannelPosterPushAttempt['result']
} = {}) {
  const push = vi.fn(async (_record, _content, targets: readonly ChannelPushTarget[]) =>
    targets.map((target) => ({
      channelId: target.channelId,
      channelName: target.channelName,
      result: options.textResult?.(target.channelId) ?? { ok: true, messageId: `m-${target.channelId}` }
    }))) as unknown as ChannelPushHook
  const pushImageCalls: ChannelPushTarget[][] = []
  const pushImage = vi.fn(async (_record, targets: readonly ChannelPushTarget[]) => {
    pushImageCalls.push([...targets])
    return targets.map((target) => ({
      channelId: target.channelId,
      channelName: target.channelName,
      result: options.posterResult?.(target.channelId) ?? { ok: true, messageId: `p-${target.channelId}` }
    }))
  }) as unknown as ChannelPosterPushHook

  let state = createDefaultNotificationStoreState()
  const storage: NotificationStorage = {
    read: async () => JSON.parse(JSON.stringify(state)),
    write: async (next) => { state = JSON.parse(JSON.stringify(next)) as typeof state }
  }
  const runtime = createNotificationRuntime({
    storage,
    catalog,
    diagnostics: () => undefined,
    resolvePushChannels: async () => {
      const list = options.channels ?? [ready('channel-a')]
      return list.length === 0
        ? { ok: false as const, reason: 'push-unavailable' as const, enabledChannelCount: 0, states: {}, requestedCount: 0 }
        : { ok: true as const, channels: list.map((channel) => ({ id: channel.id, name: channel.name })) }
    },
    getSettings: async () => ({ ...createDefaultNotificationRuntimeSettings(), desktopEnabled: true, toastEnabled: true }),
    clock: { now: () => new Date(NOW), timeZone: () => 'Asia/Shanghai' },
    getLanguage: async () => 'zh-CN',
    deliveryHooks: { push, pushImage }
  })
  return { runtime, push, pushImage, pushImageCalls, records: () => state.records }
}

describe('先正文、后海报', () => {
  it('sends the body first and then the poster, and records the two accounts separately', async () => {
    const { runtime, push, pushImage, records } = harness()
    await runtime.submit(request())
    expect(push).toHaveBeenCalledTimes(1)
    expect(pushImage).toHaveBeenCalledTimes(1)
    // 正文那一格只记正文；海报另有自己的一格（四档同一套词）。
    expect(records()[0]?.delivery.push).toMatchObject({ state: 'sent-accepted' })
    expect(records()[0]?.delivery.push?.channels?.[0]).toMatchObject({ channelId: 'channel-a', state: 'sent-accepted' })
    expect(records()[0]?.delivery.pushImage).toMatchObject({
      state: 'sent-accepted',
      channels: [{ channelId: 'channel-a', state: 'sent-accepted' }]
    })
  })

  it('A: a failed poster does not turn the delivered body into a failure', async () => {
    const { runtime, records } = harness({ posterResult: () => ({ ok: false, reason: 'delivery-image-unsupported' }) })
    await runtime.submit(request())
    // 正文确实到了：正文那格仍是受理，不许被图带成 failed。
    expect(records()[0]?.delivery.push).toMatchObject({ state: 'sent-accepted' })
    // 图没发出去要**看得见**，还得带原因码。
    expect(records()[0]?.delivery.pushImage).toMatchObject({
      state: 'failed',
      reason: 'delivery-image-unsupported'
    })
  })

  it('B: when the body never arrived, the poster is not sent at all', async () => {
    const { runtime, pushImage, records } = harness({ textResult: () => ({ ok: false, reason: 'channel-rejected' }) })
    await runtime.submit(request())
    // 正文一条都没受理 → 一次图请求都不发（否则读者只收到一张没有正文的图）。
    expect(pushImage).not.toHaveBeenCalled()
    expect(records()[0]?.delivery.push?.state).toBe('failed')
    expect(records()[0]?.delivery.pushImage).toBeUndefined()
  })

  it('sends the poster only to the channels whose body was accepted', async () => {
    const { runtime, pushImageCalls } = harness({
      channels: [ready('channel-a'), ready('channel-b')],
      textResult: (channelId) => (channelId === 'channel-b'
        ? { ok: false, reason: 'channel-rejected' }
        : { ok: true, messageId: 'm-a' })
    })
    await runtime.submit(request())
    expect(pushImageCalls).toEqual([[{ channelId: 'channel-a', channelName: 'CHANNEL-A' }]])
  })

  it('one record per notification even with N channels (two poster rows, still one record)', async () => {
    const { runtime, records } = harness({ channels: [ready('channel-a'), ready('channel-b')] })
    await runtime.submit(request())
    expect(records()).toHaveLength(1)
    expect(records()[0]?.delivery.pushImage?.channels?.map((channel) => channel.channelId)).toEqual(['channel-a', 'channel-b'])
  })

  it('without an editionPoster the record gets no poster account and no image request', async () => {
    const { runtime, pushImage, records } = harness()
    await runtime.submit(request({ withPoster: false }))
    expect(pushImage).not.toHaveBeenCalled()
    expect(records()[0]?.delivery.pushImage).toBeUndefined()
  })

  it('re-sending the same edition keeps one poster key (same content hash = same attempt)', async () => {
    const { runtime, records } = harness()
    await runtime.submit(request())
    await runtime.submit(request())
    // 仍是同一条记录：`pushImage` 不新增行，也不变成两条记录。
    expect(records()).toHaveLength(1)
    expect(records()[0]?.delivery.pushImage?.channels).toHaveLength(1)
  })
})