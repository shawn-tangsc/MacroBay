import { describe, expect, it } from 'vitest'

import { notificationCopy, notificationCopyText } from '../../i18n/notificationCopy'
import { findMissingNotificationEventCopy } from './notificationEventCopyGate'
import { createNotificationEventCatalog } from './notificationEventCatalog'
import { NOTIFICATION_EVENT_POLICY } from './notificationEventPolicy'
import { planNotificationSubmit } from '../runtime/notificationSubmitPlan'
import {
  notificationEventReasonKey,
  notificationEventTitleKey,
  PLATFORM_NOTIFICATION_EVENTS
} from './platformNotificationEvents'

/**
 * 平台 10 条声明（契约 §2）。这批声明的批准值不在这里——生效表面只读批准表，所以这里判的是：
 * 10 条 id 与批准表对得上、申请档位没越过批准、去重键形状可构造、文案键由 id 机械生成。
 */
describe('platform notification event declarations', () => {
  it('declares the ten platform events the policy table signs', () => {
    const ids = PLATFORM_NOTIFICATION_EVENTS.map((event) => event.id)
    expect(ids).toHaveLength(10)
    for (const id of ids) {
      expect(id.startsWith('platform.'), id).toBe(true)
      expect(NOTIFICATION_EVENT_POLICY[id], `${id} 缺批准表行`).toBeDefined()
    }
  })

  it('merges into a catalog whose approval is the upper bound of every request', () => {
    const catalog = createNotificationEventCatalog({
      sources: [{ productId: 'platform', events: PLATFORM_NOTIFICATION_EVENTS }],
      policy: NOTIFICATION_EVENT_POLICY
    })
    expect(catalog.list()).toHaveLength(10)
    for (const entry of catalog.list()) {
      for (const level of entry.requestedDisruptionLevels) {
        // channel 例外：没批按未批准处理，不报错（契约 §4）。
        if (level === 'channel') continue
        expect(entry.approvedDisruptionLevels, entry.id).toContain(level)
      }
    }
  })

  it('derives the copy keys from the event id instead of hand-writing them', () => {
    const titles = new Set<string>()
    for (const event of PLATFORM_NOTIFICATION_EVENTS) {
      expect(event.titleKey).toBe(`notification.event.${event.id}.title`)
      expect(event.reasonKey).toBe(`notification.event.${event.id}.reason`)
      expect(event.titleKey).toBe(notificationEventTitleKey(event.id))
      expect(event.reasonKey).toBe(notificationEventReasonKey(event.id))
      titles.add(event.titleKey)
    }
    expect(titles.size).toBe(PLATFORM_NOTIFICATION_EVENTS.length)
  })

  it('gives every declaration a constructible dedupe shape', () => {
    for (const event of PLATFORM_NOTIFICATION_EVENTS) {
      const hasTemplate = typeof event.dedupeKeyTemplate === 'string'
      const hasBuilder = typeof event.dedupeKeyBuilder === 'string'
      expect(hasTemplate !== hasBuilder, event.id).toBe(true)
      if (hasTemplate) expect(event.dedupeKeyTemplate, event.id).toMatch(/\{[a-zA-Z][a-zA-Z0-9]*\}/)
      if (event.dedupeUnit === 'condition') {
        expect(Number.isInteger(event.conditionWindowMs), event.id).toBe(true)
        expect(event.conditionWindowMs ?? 0, event.id).toBeGreaterThan(0)
      } else {
        expect(event.conditionWindowMs, event.id).toBeUndefined()
      }
    }
  })

  it('resolves both copy keys in both languages (marketing copy 2026-11-03)', () => {
    const lookup = (language: 'zh-CN' | 'en-US', key: string): string | undefined =>
      (notificationCopy[language] as Readonly<Record<string, string>>)[key]
    // 文案已到货，门禁改为硬判：平台 9 条的 title/body（含变体）/reason 在中英两套里都必须查得到。
    expect(findMissingNotificationEventCopy(PLATFORM_NOTIFICATION_EVENTS, lookup)).toEqual([])
  })

  it('keeps P7 and the recovery events out of desktop and channel', () => {
    const byId = new Map(PLATFORM_NOTIFICATION_EVENTS.map((event) => [event.id, event]))
    expect(byId.get('platform.desktop.blocked')?.requestedDisruptionLevels).toEqual([])
    expect(byId.get('platform.provider.credential-recovered')?.requestedDisruptionLevels).toEqual([])
    expect(byId.get('platform.channel.push-resumed')?.requestedDisruptionLevels).toEqual([])
    // 暂停推送这条绝不发到通道本身。
    expect(byId.get('platform.channel.push-suspended')?.requestedDisruptionLevels).not.toContain('channel')
  })

  /**
   * P9 签字的证据：这条事件**真的能提交出去**，不只是「数组里有一个 id」。
   *
   * 只断言目录里有这个 id，挡不住最坏的那种「做完了」——运行时在别处拒成 `unknown-event-type`，
   * 用例全绿、读者一条也收不到。所以这里走一遍真实的提交规划：同一次运行只出一条，
   * 换一次运行就是新的一条（「每次必回」），正文与动作标签在中英两套里都查得到。
   */
  it('accepts a P9 submission and answers every failed run exactly once', () => {
    const catalog = createNotificationEventCatalog({
      sources: [{ productId: 'platform', events: PLATFORM_NOTIFICATION_EVENTS }],
      policy: NOTIFICATION_EVENT_POLICY
    })
    const settings = {
      desktopEnabled: true,
      toastEnabled: true,
      popupEnabled: false,
      push: { channelId: null },
      retentionDays: 30,
      defaultSnoozeMinutes: 10
    }
    const submit = (runId: string) => planNotificationSubmit({
      catalog,
      settings,
      desktopSupported: true,
      now: '2026-11-06T12:00:00.000Z',
      request: {
        eventTypeId: 'platform.analysis.manual-failed',
        dedupeVars: { builder: 'template', vars: { runId } },
        bodyParams: { reason: '模型服务正在限流，没有接受这次请求' },
        actions: [{
          id: 'open-analysis-run',
          labelKey: 'notification.event.platform.analysis.manual-failed.open',
          kind: 'open'
        }],
        occurredAt: '2026-11-06T11:59:00.000Z'
      }
    })

    const first = submit('run-a')
    if (first.kind !== 'new') throw new Error(`P9 被拒了：${first.kind === 'rejected' ? first.outcome.reason : first.kind}`)
    expect(first.record.dedupeKey).toBe('platform|manual-failed:run-a')
    expect(first.record.bodyKey).toBe('notification.event.platform.analysis.manual-failed.body')
    // 批准中心 + 桌面；桌面开着就不在应用内再提示一次（两个面互斥）。
    expect(first.levels).toEqual(['center', 'desktop'])

    // 同一次运行重放一次：合并，不再多一条（读者不会为同一次失败收到两条）。
    const again = planNotificationSubmit({
      catalog,
      settings,
      desktopSupported: true,
      now: '2026-11-06T12:00:10.000Z',
      duplicate: first.record,
      request: {
        eventTypeId: 'platform.analysis.manual-failed',
        dedupeVars: { builder: 'template', vars: { runId: 'run-a' } },
        bodyParams: { reason: '模型服务正在限流，没有接受这次请求' },
        actions: [{
          id: 'open-analysis-run',
          labelKey: 'notification.event.platform.analysis.manual-failed.open',
          kind: 'open'
        }],
        occurredAt: '2026-11-06T12:00:10.000Z'
      }
    })
    expect(again.kind).toBe('merge')

    // 换一次运行（读者连点第二次失败）：必须是一条新的，不是合并。
    expect(submit('run-b').kind).toBe('new')

    // 动作标签解析不出来时投递层会**整条丢掉按钮**，所以这个键必须两套语言都在。
    for (const language of ['zh-CN', 'en-US'] as const) {
      expect(notificationCopyText(language, 'notification.event.platform.analysis.manual-failed.open').length).toBeGreaterThan(0)
    }
  })
})
