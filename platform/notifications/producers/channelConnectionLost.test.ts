import { describe, expect, it, vi } from 'vitest'

import { notificationCopy } from '../../i18n/notificationCopy'
import { createNotificationEventCatalog } from '../contracts/notificationEventCatalog'
import { PLATFORM_NOTIFICATION_APPROVALS, PLATFORM_NOTIFICATION_EVENTS } from '../contracts/platformNotificationEvents'
import { planNotificationSubmit } from '../runtime/notificationSubmitPlan'
import { buildChannelConnectionLostRequest, notifyChannelConnectionLost } from './channelConnectionLost'

/**
 * P8 生产者（需求 v2.17 §11）：键带频道 id + 断开起始时刻、正文带频道名与原因两档、不含手机。
 * 这里判请求的**形状**；「该发时才发」由 `channelConnectionOutage.test.ts` 与轮询宿主用例守。
 */
const input = {
  channelId: 'channel-1',
  channelName: 'test',
  cause: 'proxy' as const,
  disconnectedAt: '2026-11-04T15:01:00.000Z',
  occurredAt: '2026-11-04T15:01:07.000Z'
}

describe('channel connection lost producer', () => {
  it('builds the signed event with a key carrying the channel id and the outage start', () => {
    const request = buildChannelConnectionLostRequest(input)
    expect(request.eventTypeId).toBe('platform.channel.connection-lost')
    expect(request.dedupeVars).toEqual({
      builder: 'template',
      vars: { channelId: 'channel-1', disconnectedAt: '2026-11-04T15:01:00.000Z' }
    })
    // 成品句子在源头拼好：两种语言各一份，频道名（读者自起的字）两份相同。
    expect(request.rendered?.['zh-CN']?.body).toContain('test')
    expect(request.rendered?.['en-US']?.body).toContain('test')
    expect(request.bodyVariant).toBeUndefined()
    expect(request.bodyParams).toBeUndefined()
  })

  it('carries the channel name and one of the two reasons, never a bare "connection failed"', () => {
    for (const cause of ['network', 'proxy'] as const) {
      const request = buildChannelConnectionLostRequest({ ...input, cause })
      // 两种原因的正文各自成句，都点名是哪条频道——不许只写「连接失败」。
      expect(request.rendered?.['zh-CN']?.body).toContain('test')
      expect(request.rendered?.['zh-CN']?.body).not.toBe(
        buildChannelConnectionLostRequest({ ...input, cause: cause === 'proxy' ? 'network' : 'proxy' }).rendered?.['zh-CN']?.body
      )
      const key = `notification.event.platform.channel.connection-lost.body.${cause}`
      for (const language of ['zh-CN', 'en-US'] as const) {
        const sentence = (notificationCopy[language] as Readonly<Record<string, string>>)[key]
        expect(sentence, `${language} ${key}`).toBeTruthy()
        // 正文要能说清是哪条频道：`{channel}` 必须真的被正文用上。
        expect(sentence).toContain('{channel}')
      }
    }
  })

  it('sends the reader to the channel page, because that is where the fix lives', () => {
    const request = buildChannelConnectionLostRequest(input)
    expect(request.deeplink).toEqual({ scope: 'platform', settingsSectionId: 'channels' })
    expect(request.actions).toEqual([
      expect.objectContaining({ id: 'open-channel-settings', kind: 'open', labelKey: 'notification.channelCheck.action' })
    ])
  })

  it('is never approved for the phone: this is a local state, not a push', () => {
    // 批准值读平台自己的声明（b3-1），不再读那张共享表；断言的事实与原来相同。
    const row = PLATFORM_NOTIFICATION_APPROVALS['platform.channel.connection-lost']!
    expect(row.approvedDisruptionLevels).toEqual(['center', 'toast', 'desktop'])
    expect(row.approvedDisruptionLevels).not.toContain('channel')
  })

  it('is accepted by the real catalog and lands on the signed surfaces, never the phone', () => {
    // 「登记了却从来不响」这一族，就在这一格：请求过了目录、键真的展开、档位真的落到表面上。
    const catalog = createNotificationEventCatalog({
      // **机制夹具**：断言「频道连接断开」这类事件怎么走到中心/手机，不涉及任何产品事件。
      // 批准值取平台自己的声明（b2 之后来源优先），断言的事实与原来相同。
      sources: [{ productId: 'platform', events: PLATFORM_NOTIFICATION_EVENTS, approval: PLATFORM_NOTIFICATION_APPROVALS }]
    })
    const settings = {
      desktopEnabled: true, toastEnabled: true, popupEnabled: false,
      push: { channelId: 'channel-1' }, retentionDays: 30, defaultSnoozeMinutes: 60
    }
    const plan = planNotificationSubmit({
      catalog, settings, desktopSupported: true, now: input.occurredAt, timeZone: 'UTC',
      request: buildChannelConnectionLostRequest(input)
    })
    expect(plan.kind).toBe('new')
    if (plan.kind !== 'new') return
    // 归属前缀是平台加的（`<owner>|<template>`），键本体带频道 id 与断开起始时刻。
    expect(plan.record.dedupeKey).toBe('platform|channel-lost:channel-1:2026-11-04T15:01:00.000Z')
    // 成品记录不挂任何文案键，正文就是那句成品。
    expect(plan.record.bodyKey).toBeUndefined()
    expect(plan.record.rendered?.['zh-CN']?.body).toContain('代理')
    // 桌面可用时只写桌面交付（桌面优先互斥），提示被顶掉；关掉桌面才轮到提示。
    expect(plan.levels).toEqual(['center', 'desktop'])
    expect(plan.record.channels).toEqual(['center', 'desktop'])

    const withoutDesktop = planNotificationSubmit({
      catalog, settings: { ...settings, desktopEnabled: false }, desktopSupported: true,
      now: input.occurredAt, timeZone: 'UTC', request: buildChannelConnectionLostRequest(input)
    })
    expect(withoutDesktop.kind).toBe('new')
    if (withoutDesktop.kind !== 'new') return
    expect(withoutDesktop.levels).toEqual(['center', 'toast'])
    // 本机状态不该再推到手机：两次都不许出现 channel。
    expect([...plan.levels, ...withoutDesktop.levels]).not.toContain('channel')
  })

  it('submits and swallows failures: a lost notification must not turn a fact into a fault', async () => {
    const submit = vi.fn(async () => ({ kind: 'accepted' as const, recordId: 'r1', levels: [] }))
    await expect(notifyChannelConnectionLost(submit, input)).resolves.toMatchObject({ kind: 'accepted' })
    expect(submit).toHaveBeenCalledTimes(1)

    await expect(notifyChannelConnectionLost(vi.fn(async () => { throw new Error('runtime down') }), input)).resolves.toBeNull()
    await expect(notifyChannelConnectionLost(undefined, input)).resolves.toBeNull()
  })
})
