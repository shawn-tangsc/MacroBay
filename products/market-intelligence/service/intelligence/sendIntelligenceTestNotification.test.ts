import { describe, expect, it, vi } from 'vitest'

import type {
  NotificationSubmitOutcome,
  NotificationSubmitRequest
} from '@platform/notifications/contracts/notificationContracts'
import type { PushChannelResolution } from '@platform/notifications/delivery/pushChannelResolution'

import { parseIntelligenceTestRequest } from '../../contracts/intelligenceNotificationTest'
import {
  buildIntelligenceTestRequest,
  type TestNotificationPayload
} from './notificationTestRequests'
import { sendIntelligenceTestNotification, type IntelligenceTestDeps } from './sendIntelligenceTestNotification'

/**
 * 三枚「发一条…」的主进程行为（用户 2026-11-10 定口径）。
 *
 * **测试只为验证通路**：不读真实日历、不读真实源、不读真实舆情；四种 kind 都用内置样例。
 * 所以这里的判据只有两条：点下去要么「已发到 X」，要么是传输层原因（通道/提交被拒）；
 * 「没数据」「读不到数据」不再是测试失败的原因。通道仍先判：发不出去时不拼样例。
 */

const NOW = '2026-11-08T05:00:00.000Z'
const ONE_CHANNEL: PushChannelResolution = { ok: true, channelId: 'slack', channelName: 'Slack' }
const ACCEPTED: NotificationSubmitOutcome = { kind: 'accepted', recordId: 'r1', levels: ['center'], suppressedLevels: [] }
const NO_PUSH_CHANNEL: PushChannelResolution = { ok: false, reason: 'push-unavailable', enabledChannelCount: 0, multiple: false, states: {} }
const TWO_PUSH_CHANNELS: PushChannelResolution = { ok: false, reason: 'push-unavailable', enabledChannelCount: 2, multiple: true, states: {} }

function deps(over: Partial<IntelligenceTestDeps> = {}): IntelligenceTestDeps {
  return {
    resolvePushChannel: async () => ONE_CHANNEL,
    submit: async () => ACCEPTED,
    now: () => NOW,
    ...over
  }
}

/** 断言一份提交请求里的成品句子（标题与正文都带测试标记）。 */
function renderedOf(request: NotificationSubmitRequest): Readonly<Record<string, { title: string; body: string }>> {
  return request.rendered as unknown as Readonly<Record<string, { title: string; body: string }>>
}

describe('parseIntelligenceTestRequest', () => {
  it('accepts the three kinds and nothing else', () => {
    expect(parseIntelligenceTestRequest({ kind: 'sentiment' })).toBe('sentiment')
    expect(parseIntelligenceTestRequest({ kind: 'calendar-upcoming' })).toBe('calendar-upcoming')
    expect(parseIntelligenceTestRequest({ kind: 'calendar-landed' })).toBe('calendar-landed')
    // 认不出就抛：**不回落成某一种**，否则按钮旁边写着「会发什么」而实际发的是另一条。
    expect(() => parseIntelligenceTestRequest({ kind: 'link' })).toThrow('unknown-test-notification-kind')
    expect(() => parseIntelligenceTestRequest({})).toThrow('unknown-test-notification-kind')
    expect(() => parseIntelligenceTestRequest(undefined)).toThrow('unknown-test-notification-kind')
  })
})

describe('sendIntelligenceTestNotification — 通道先判', () => {
  it('zero ready channels reports the count, and no sample is submitted', async () => {
    const submit = vi.fn()
    const result = await sendIntelligenceTestNotification('sentiment', deps({
      resolvePushChannel: async () => NO_PUSH_CHANNEL,
      submit
    }))
    expect(result).toEqual({ state: 'unavailable', reasonCode: 'push-unavailable', enabledChannelCount: 0 })
    expect(submit).not.toHaveBeenCalled()
  })

  it('two ready channels also refuses, and the count is the one the platform counted', async () => {
    const result = await sendIntelligenceTestNotification('calendar-upcoming', deps({
      resolvePushChannel: async () => TWO_PUSH_CHANNELS
    }))
    expect(result).toEqual({ state: 'unavailable', reasonCode: 'push-unavailable', enabledChannelCount: 2 })
  })
})

describe('every kind sends a built-in sample, with no data source in sight', () => {
  it.each([
    ['sentiment', 'market-intelligence.sentiment.alert'],
    ['calendar-upcoming', 'market-intelligence.calendar.event-upcoming'],
    ['calendar-landed', 'market-intelligence.macro.event-landed']
  ] as const)('%s goes out with a sample payload', async (kind, eventTypeId) => {
    const submit = vi.fn<(request: NotificationSubmitRequest) => Promise<NotificationSubmitOutcome>>(async () => ACCEPTED)
    // deps 里没有任何数据源（没有 store、没有日历、没有查询）：测试不需要它们。
    const result = await sendIntelligenceTestNotification(kind, deps({ submit }))

    expect(result).toEqual({ state: 'sent', channelId: 'slack', channelName: 'Slack' })
    const request = submit.mock.calls[0]![0]!
    expect(request.eventTypeId).toBe(eventTypeId)
    expect(request.namespace).toBe('test')
    // 标题带测试标记；正文第一行仍是「这是测试消息」。
    const rendered = renderedOf(request)
    expect(rendered['zh-CN']?.title.startsWith('【测试】')).toBe(true)
    expect(rendered['zh-CN']?.body).toContain('这是测试消息，不是真实提醒。')
    expect(rendered['en-US']?.title.startsWith('[Test] ')).toBe(true)
    // 投递面：中心 + 手机，不进桌面。
    expect(request.narrowedDisruptionLevels).toEqual(['center', 'channel'])
    // occurredAt 就是这一次的 now（样例时间只相对它偏移）。
    expect(request.occurredAt).toBe(NOW)
  })

  it('samples are deterministic: same now → same request', async () => {
    const first = vi.fn<(request: NotificationSubmitRequest) => Promise<NotificationSubmitOutcome>>(async () => ACCEPTED)
    const second = vi.fn<(request: NotificationSubmitRequest) => Promise<NotificationSubmitOutcome>>(async () => ACCEPTED)
    await sendIntelligenceTestNotification('calendar-landed', deps({ submit: first }))
    await sendIntelligenceTestNotification('calendar-landed', deps({ submit: second }))
    expect(first.mock.calls[0]![0]).toEqual(second.mock.calls[0]![0])
  })

  it('the sample sentence follows the reader language, the event stays the fixed sample', async () => {
    const submit = vi.fn<(request: NotificationSubmitRequest) => Promise<NotificationSubmitOutcome>>(async () => ACCEPTED)
    await sendIntelligenceTestNotification('calendar-upcoming', deps({
      getAppLanguage: async () => 'en-US',
      submit
    }))
    const rendered = renderedOf(submit.mock.calls[0]![0]!)
    expect(rendered['en-US']?.title).toContain('US nonfarm payrolls (sample)')
  })
})

describe('a rejected submit is a transport result, never a success', () => {
  it('comes back as unavailable and does not claim it was sent', async () => {
    const result = await sendIntelligenceTestNotification('calendar-upcoming', deps({
      submit: async (): Promise<NotificationSubmitOutcome> => ({ kind: 'rejected', reason: 'unknown-event-type', message: 'no such event' })
    }))
    expect(result).toEqual({ state: 'unavailable', reasonCode: 'read-failed' })
  })
})

describe('the three test messages share one delivery surface rule', () => {
  it('goes to the centre and the phone channel only, for every kind', () => {
    // 测试消息不是业务事实：读者在设置页点一下，不该在桌面上弹一条。
    const payload: TestNotificationPayload = {
      namespace: 'test',
      dedupeVars: { builder: 'template', vars: { key: 'value' } },
      rendered: {
        'zh-CN': { title: '【测试】x', body: 'y', reason: 'y' },
        'en-US': { title: '[Test] x', body: 'y', reason: 'y' }
      },
      occurredAt: NOW,
      actions: []
    }
    for (const kind of ['sentiment', 'calendar-upcoming', 'calendar-landed'] as const) {
      expect(buildIntelligenceTestRequest(kind, payload).narrowedDisruptionLevels).toEqual(['center', 'channel'])
    }
  })
})
