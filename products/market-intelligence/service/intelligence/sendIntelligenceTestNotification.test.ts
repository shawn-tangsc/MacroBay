import { describe, expect, it, vi } from 'vitest'

import type {
  NotificationSubmitOutcome,
  NotificationSubmitRequest
} from '@platform/notifications/contracts/notificationContracts'
import type { PushChannelResolution } from '@platform/notifications/delivery/pushChannelResolution'

import {
  DEFAULT_CALENDAR_REMINDER_SETTINGS,
  type CalendarReminderSettings
} from '../../contracts/calendarEventReminder'
import { parseIntelligenceTestRequest } from '../../contracts/intelligenceNotificationTest'
import type { IntelligenceModule } from './intelligenceModule'
import { sendIntelligenceTestNotification, type IntelligenceTestDeps } from './sendIntelligenceTestNotification'

/**
 * 三枚「发一条…」的主进程行为：**先看通道，再读数据，最后走同一个提交入口**。
 *
 * 这些用例断言的是「读者看到哪句话」，所以每条都钉住回执三档里的具体一格：
 * 0 条/≥2 条通道不许先读一遍数据；「没有样例」与「读不到」不许互相顶替；提交被拒不许报成功。
 */

const NOW = '2026-11-08T05:00:00.000Z'
const ONE_CHANNEL: PushChannelResolution = { ok: true, channelId: 'slack', channelName: 'Slack' }

/** 打开提醒的读者设置：其余字段取契约默认值，不为测试另造一份形状。 */
const REMINDER_ON: CalendarReminderSettings = { ...DEFAULT_CALENDAR_REMINDER_SETTINGS, enabled: true }

const ACCEPTED: NotificationSubmitOutcome = {
  kind: 'accepted',
  recordId: 'r1',
  levels: ['center'],
  // 契约要求：这次因免打扰/未批准而被压下的档位要显式交出来（空数组＝没有压下任何一档）。
  suppressedLevels: []
}
const NO_PUSH_CHANNEL: PushChannelResolution = {
  ok: false,
  reason: 'push-unavailable',
  enabledChannelCount: 0,
  multiple: false,
  states: {}
}
const TWO_PUSH_CHANNELS: PushChannelResolution = {
  ok: false,
  reason: 'push-unavailable',
  enabledChannelCount: 2,
  multiple: true,
  states: {}
}

function minimumModule(over: Partial<Record<string, unknown>> = {}): IntelligenceModule {
  const base = {
    newsSentiment: { store: { listLatestSentiment: () => [] }, scoring: undefined },
    pipeline: { listItems: () => [] },
    sourceProfileStore: { listProfiles: async () => [] },
    publicQueryService: { queryMarketCalendarMonth: () => ({ state: 'available', events: [] }) }
  }
  return {
    ...base,
    ...over,
    newsSentiment: { ...base.newsSentiment, ...((over.newsSentiment ?? {}) as object) },
    publicQueryService: { ...base.publicQueryService, ...((over.publicQueryService ?? {}) as object) }
  } as unknown as IntelligenceModule
}

function deps(over: Partial<IntelligenceTestDeps> = {}): IntelligenceTestDeps {
  return {
    intelligence: minimumModule(),
    calendarReminder: {
      read: () => REMINDER_ON,
      readEvents: () => []
    },
    readEnabledCalendarFeeds: async () => ['macro-calendar'],
    getTimeZone: () => 'Asia/Shanghai',
    resolvePushChannel: async () => ONE_CHANNEL,
    submit: async () => ACCEPTED,
    now: () => NOW,
    ...over
  }
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
  it('zero ready channels reports the count and reads no product data at all', async () => {
    const listProfiles = vi.fn(async () => [])
    const submit = vi.fn()
    const result = await sendIntelligenceTestNotification('sentiment', deps({
      intelligence: minimumModule({ sourceProfileStore: { listProfiles } }),
      resolvePushChannel: async () => NO_PUSH_CHANNEL,
      submit
    }))
    expect(result).toEqual({ state: 'unavailable', reasonCode: 'push-unavailable', enabledChannelCount: 0 })
    // 顺序就是承诺：发不出去时不去读一遍舆情再告诉读者发不出去。
    expect(listProfiles).not.toHaveBeenCalled()
    expect(submit).not.toHaveBeenCalled()
  })

  it('two ready channels also refuses, and the count is the one the platform counted', async () => {
    const result = await sendIntelligenceTestNotification('calendar-upcoming', deps({
      resolvePushChannel: async () => TWO_PUSH_CHANNELS
    }))
    expect(result).toEqual({ state: 'unavailable', reasonCode: 'push-unavailable', enabledChannelCount: 2 })
  })
})

describe('sendIntelligenceTestNotification — 三条取数各回各的话', () => {
  it('sentiment with an enabled source but no scored item is no-data (not a failure)', async () => {
    const result = await sendIntelligenceTestNotification('sentiment', deps({
      intelligence: minimumModule({ sourceProfileStore: { listProfiles: async () => [{ sourceId: 'coindesk-rss', enabled: true }] } })
    }))
    expect(result).toEqual({ state: 'no-data', reasonCode: 'sentiment-none' })
  })

  it('sentiment with every source disabled is unavailable — "not enabled" is not "nothing to send"', async () => {
    const result = await sendIntelligenceTestNotification('sentiment', deps())
    expect(result).toEqual({ state: 'unavailable', reasonCode: 'source-disabled' })
  })

  it('sentiment without a readable time zone says so, instead of pretending the window is empty', async () => {
    const result = await sendIntelligenceTestNotification('sentiment', deps({ getTimeZone: () => '' }))
    expect(result).toEqual({ state: 'unavailable', reasonCode: 'timezone-unreadable' })
  })

  it('calendar upcoming with no future event is no-data', async () => {
    expect(await sendIntelligenceTestNotification('calendar-upcoming', deps())).toEqual({
      state: 'no-data',
      reasonCode: 'calendar-upcoming-none'
    })
  })

  it('a disabled calendar source is unavailable, never "no events"', async () => {
    const result = await sendIntelligenceTestNotification('calendar-upcoming', deps({
      readEnabledCalendarFeeds: async () => []
    }))
    expect(result).toEqual({ state: 'unavailable', reasonCode: 'source-disabled' })
  })

  it('calendar landed with no actual value is no-data', async () => {
    expect(await sendIntelligenceTestNotification('calendar-landed', deps())).toEqual({
      state: 'no-data',
      reasonCode: 'calendar-landed-none'
    })
  })
})

describe('sendIntelligenceTestNotification — 真的发出去了', () => {
  it('builds the upcoming request from the same reader the real reminder uses, in the test dedupe domain', async () => {
    const submit = vi.fn<(request: NotificationSubmitRequest) => Promise<NotificationSubmitOutcome>>(
      async () => ACCEPTED
    )
    const result = await sendIntelligenceTestNotification('calendar-upcoming', deps({
      calendarReminder: {
        read: () => REMINDER_ON,
        readEvents: () => [{ eventKey: 'cpi', title: '美国 CPI', scheduledAt: '2026-11-08T05:30:00.000Z', importance: 'high' as const }]
      },
      submit
    }))

    expect(result).toEqual({ state: 'sent', channelId: 'slack', channelName: 'Slack' })
    const request = submit.mock.calls[0]![0]!
    expect(request.eventTypeId).toBe('market-intelligence.calendar.event-upcoming')
    // 测试不吃真实键：同一个键、不同域。
    expect(request.namespace).toBe('test')
    expect(request.dedupeVars).toEqual({ builder: 'template', vars: { eventKey: 'cpi', scheduledAt: '2026-11-08T05:30:00.000Z' } })
    // 标题与正文都带测试标记（读者第一眼必须知道这是测试）。
    const rendered = request.rendered!
    expect(rendered['zh-CN']?.title).toBe('【测试】美国 CPI')
    expect(rendered['zh-CN']?.body).toContain('这是测试消息，不是真实提醒。')
    expect(rendered['en-US']?.title.startsWith('[Test] ')).toBe(true)
  })

  it('a rejected submit is not a success — it comes back as read-failed', async () => {
    const result = await sendIntelligenceTestNotification('calendar-upcoming', deps({
      calendarReminder: {
        read: () => REMINDER_ON,
        readEvents: () => [{ eventKey: 'cpi', title: '美国 CPI', scheduledAt: '2026-11-08T05:30:00.000Z', importance: 'high' as const }]
      },
      submit: async (): Promise<NotificationSubmitOutcome> => ({ kind: 'rejected', reason: 'unknown-event-type', message: 'no such event' })
    }))
    expect(result).toEqual({ state: 'unavailable', reasonCode: 'read-failed' })
  })

  it('a reader that throws is read-failed, and nothing is submitted', async () => {
    const submit = vi.fn()
    const result = await sendIntelligenceTestNotification('calendar-upcoming', deps({
      calendarReminder: {
        read: () => { throw new Error('store unreadable') },
        readEvents: () => []
      },
      submit
    }))
    expect(result).toEqual({ state: 'unavailable', reasonCode: 'read-failed' })
    expect(submit).not.toHaveBeenCalled()
  })
})
