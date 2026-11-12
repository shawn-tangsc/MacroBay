import { describe, expect, it, vi } from 'vitest'

import { createDefaultNotificationRuntimeSettings } from '../contracts/notificationContracts'
import type { NotificationSubmitRequest } from '../contracts/notificationContracts'
import { createNotificationEventCatalog } from '../contracts/notificationEventCatalog'
import { PLATFORM_NOTIFICATION_APPROVALS, PLATFORM_NOTIFICATION_EVENTS } from '../contracts/platformNotificationEvents'
import { createDefaultNotificationStoreState } from '../store/notificationStore'
import type { ChannelPushAttempt, ChannelPushHook, ChannelPushTarget } from '../delivery/channelPushPort'
import { createNotificationRuntime } from './notificationRuntime'
import type { NotificationStorage } from './notificationRuntime'

/**
 * 多通道扇出（多通道方案 §6 用例 1–8b）。
 *
 * **唯一硬判据**：一条通知只产生**一条记录**，N 条通道只是这条记录下的 N 次尝试。
 * 做成「一条通道一条记录」＝读者配得越多额度扣得越快（额度是拿 `sameEventToday.count` 比
 * `dailyLimit` 的），产品明确不允许。
 */
const catalog = createNotificationEventCatalog({
  sources: [{
    // 自检那条事件走真实声明与批准：`sendTestNotice` 提交的正是 `platform.notification.self-test`。
    productId: 'platform',
    events: PLATFORM_NOTIFICATION_EVENTS,
    approval: PLATFORM_NOTIFICATION_APPROVALS
  }, {
    productId: 'platform',
    events: [{
      id: 'platform.multi-push',
      titleKey: 'notification.event.platform.demo-push.title',
      reasonKey: 'notification.event.platform.demo-push.reason',
      bodyKey: 'notification.event.platform.demo-push.body',
      requiresUserAction: false,
      category: 'reminder',
      requestedDisruptionLevels: ['channel'],
      dedupeKeyTemplate: 'multi:{key}',
      dedupeUnit: 'occurrence'
    }],
    approval: { 'platform.multi-push': { approvedDisruptionLevels: ['center', 'channel'], approvedBypassQuietHours: false } }
  }]
})

const NOW = '2026-11-12T12:00:00.000Z'

function request(key = 'one'): NotificationSubmitRequest {
  return {
    eventTypeId: 'platform.multi-push',
    actions: [],
    dedupeVars: { builder: 'template', vars: { key } },
    occurredAt: NOW,
    edition: { editionId: 'multi-2026-11-12', locale: 'zh-CN' }
  }
}

const ready = (id: string) => ({ id, name: id.toUpperCase(), state: 'runtime-ready' })

/** 假钩子：按通道给出结果，并记录每次被点名的通道（顺序也要看）。 */
function harness(options: {
  channels?: readonly { id: string; name: string; state: string }[]
  result?: (channelId: string) => ChannelPushAttempt['result']
  backoff?: Record<string, { channelId: string; failures: number; pausedUntil: string | null }>
} = {}) {
  const calls: string[][] = []
  const push: ChannelPushHook = vi.fn(async (_record, _content, targets: readonly ChannelPushTarget[]) => {
    calls.push(targets.map((target) => target.channelId))
    return targets.map((target) => ({
      channelId: target.channelId,
      channelName: target.channelName,
      result: options.result?.(target.channelId) ?? { ok: true, messageId: `m-${target.channelId}` }
    }))
  }) as unknown as ChannelPushHook
  let state = createDefaultNotificationStoreState()
  if (options.backoff !== undefined) state = { ...state, pushBackoff: options.backoff }
  const storage: NotificationStorage = {
    read: async () => JSON.parse(JSON.stringify(state)),
    write: async (next) => { state = JSON.parse(JSON.stringify(next)) as typeof state }
  }
  const runtime = createNotificationRuntime({
    storage,
    catalog,
    diagnostics: () => undefined,
    resolvePushChannels: async () => {
      const list = options.channels ?? [ready('channel-a'), ready('channel-b')]
      return list.length === 0
        ? { ok: false as const, reason: 'push-unavailable' as const, enabledChannelCount: 0, states: {}, requestedCount: 0 }
        : { ok: true as const, channels: list.map((channel) => ({ id: channel.id, name: channel.name })) }
    },
    // 三档全开：自检要真的走到通道，不被「桌面开关关着」判成 suppressed。
    getSettings: async () => ({ ...createDefaultNotificationRuntimeSettings(), desktopEnabled: true, toastEnabled: true }),
    clock: { now: () => new Date(NOW), timeZone: () => 'Asia/Shanghai' },
    getLanguage: async () => 'zh-CN',
    deliveryHooks: { push }
  })
  return { runtime, push, calls, records: () => state.records }
}

describe('one notification, N channels, still one record', () => {
  it('sends one attempt per ready channel and writes one record with two channel rows', async () => {
    const { runtime, push, calls, records } = harness()

    const outcome = await runtime.submit(request())
    expect(outcome.kind).toBe('accepted')

    // 端口被调用一次、点名两条通道（串行、按投影顺序）。
    expect(push).toHaveBeenCalledTimes(1)
    expect(calls).toEqual([['channel-a', 'channel-b']])
    // **一条记录**，不是两条：额度按记录算。
    expect(records()).toHaveLength(1)
    expect(records()[0]?.delivery.push).toMatchObject({
      state: 'sent-accepted',
      channels: [
        { channelId: 'channel-a', state: 'sent-accepted' },
        { channelId: 'channel-b', state: 'sent-accepted' }
      ]
    })
  })

  it('three channels with one failure: aggregate failed, no aggregate reason, three rows', async () => {
    const { runtime, calls, records } = harness({
      channels: [ready('channel-a'), ready('channel-b'), ready('channel-c')],
      result: (channelId) => (channelId === 'channel-b'
        ? { ok: false, reason: 'channel-rejected' }
        : { ok: true, messageId: `m-${channelId}` })
    })

    await runtime.submit(request())
    expect(calls[0]).toHaveLength(3)
    const push = records()[0]?.delivery.push
    expect(push?.state).toBe('failed')
    // 1 成 2 败时**不写聚合原因**：写一个会让读者以为整条都没发出去。
    expect(push?.reason).toBeUndefined()
    expect(push?.channels?.map((channel) => channel.state)).toEqual(['sent-accepted', 'failed', 'sent-accepted'])
    expect(push?.channels?.[1]?.reason).toBe('channel-rejected')
  })

  it('two accepted and one unconfirmed aggregates to sent-unconfirmed, never sent-accepted', async () => {
    const { runtime, records } = harness({
      channels: [ready('channel-a'), ready('channel-b'), ready('channel-c')],
      result: (channelId) => (channelId === 'channel-c'
        ? { ok: false, reason: 'unknown-after-send' }
        : { ok: true, messageId: `m-${channelId}` })
    })

    await runtime.submit(request())
    expect(records()[0]?.delivery.push?.state).toBe('sent-unconfirmed')
  })

  it('keeps backoff per channel: the paused one is queued and never called, the others still send', async () => {
    const { runtime, calls, records } = harness({
      channels: [ready('channel-a'), ready('channel-b'), ready('channel-c')],
      backoff: { 'channel-b': { channelId: 'channel-b', failures: 3, pausedUntil: '2026-11-12T13:00:00.000Z' } }
    })

    await runtime.submit(request())
    // B 在窗口内：端口一次都没点名它（剩下的照发）。
    expect(calls).toEqual([['channel-a', 'channel-c']])
    const push = records()[0]?.delivery.push
    expect(push?.channels?.map((channel) => [channel.channelId, channel.state])).toEqual([
      ['channel-a', 'sent-accepted'],
      ['channel-b', 'queued'],
      ['channel-c', 'sent-accepted']
    ])
    // 设计 §3 的聚合表：无 failed/unknown、但有因退避的 queued → 聚合 `queued`（语气档是「还在等」，
    // 逐通道的 2 成 1 等由 `channels[]` 说清；总括数字不许从这一档反推）。
    expect(push?.state).toBe('queued')
  })

  it('zero ready channels: record says failed/push-unavailable and the port is never called', async () => {
    const { runtime, push, records } = harness({ channels: [] })

    await runtime.submit(request())
    expect(push).not.toHaveBeenCalled()
    expect(records()[0]?.delivery.push).toMatchObject({ state: 'failed', reason: 'push-unavailable' })
  })

  it('counts quota by record, not by attempt: two channels still spend one record of the daily limit', async () => {
    const { runtime, records } = harness()
    await runtime.submit(request('quota'))
    // 一次提交 = 一条记录（两条尝试不会各扣一次额度）。
    expect(records()).toHaveLength(1)
    expect(records()[0]?.delivery.push?.channels).toHaveLength(2)
  })
})

describe('redeliver only the channels that are not delivered yet', () => {
  it('does not resend an accepted channel, and resends a failed one once', async () => {
    let failB = true
    const sent: string[][] = []
    const hook: ChannelPushHook = async (_record, _content, targets) => {
      sent.push(targets.map((target) => target.channelId))
      return targets.map((target) => ({
        channelId: target.channelId,
        channelName: target.channelName,
        result: target.channelId === 'channel-b' && failB ? { ok: false, reason: 'channel-rejected' } : { ok: true, messageId: `m-${target.channelId}` }
      }))
    }
    let state = createDefaultNotificationStoreState()
    const runtime = createNotificationRuntime({
      storage: { read: async () => JSON.parse(JSON.stringify(state)), write: async (next) => { state = JSON.parse(JSON.stringify(next)) as typeof state } },
      catalog,
      diagnostics: () => undefined,
      resolvePushChannels: async () => ({ ok: true, channels: [ready('channel-a'), ready('channel-b')].map((c) => ({ id: c.id, name: c.name })) }),
      getSettings: async () => ({ ...createDefaultNotificationRuntimeSettings(), desktopEnabled: false }),
      clock: { now: () => new Date(NOW), timeZone: () => 'Asia/Shanghai' },
      getLanguage: async () => 'zh-CN',
      deliveryHooks: { push: hook }
    })

    await runtime.submit(request('redeliver'))
    const record = state.records[0]!
    expect(record.delivery.push?.channels?.map((channel) => channel.state)).toEqual(['sent-accepted', 'failed'])

    failB = false
    const receipt = await runtime.redeliverPush({ recordId: record.id, editionId: record.edition!.editionId, locale: 'zh-CN' })
    expect(receipt.kind).toBe('accepted')
    // 第二次只点名**没到终态**的那条：已接受的不重发。
    expect(sent).toEqual([['channel-a', 'channel-b'], ['channel-b']])
    expect(state.records[0]?.delivery.push?.channels?.map((channel) => channel.state)).toEqual(['sent-accepted', 'sent-accepted'])
  })
})

describe('self-test reports per channel', () => {
  it('sends one test message to each ready channel and reports them one by one', async () => {
    const { runtime, calls } = harness()
    const receipt = await runtime.sendTestNotice()
    expect(receipt.state).toBe('sent')
    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual(['channel-a', 'channel-b'])
    expect(receipt.state === 'sent' ? receipt.channels?.map((channel) => channel.channelId) : []).toEqual(['channel-a', 'channel-b'])
  })

  it('says push-unavailable when there is no ready channel', async () => {
    const { runtime, push } = harness({ channels: [] })
    await expect(runtime.sendTestNotice()).resolves.toMatchObject({ state: 'unavailable', reasonCode: 'push-unavailable' })
    expect(push).not.toHaveBeenCalled()
  })
})
