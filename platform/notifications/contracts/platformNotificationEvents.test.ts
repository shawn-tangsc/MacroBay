import { describe, expect, it } from 'vitest'

import { notificationCopy } from '../../i18n/notificationCopy'
import { findMissingNotificationEventCopy } from './notificationEventCopyGate'
import { createNotificationEventCatalog } from './notificationEventCatalog'
import { NOTIFICATION_EVENT_POLICY } from './notificationEventPolicy'
import {
  notificationEventReasonKey,
  notificationEventTitleKey,
  PLATFORM_NOTIFICATION_EVENTS
} from './platformNotificationEvents'

/**
 * 平台 8 条声明（契约 §2）。这批声明的批准值不在这里——生效表面只读批准表，所以这里判的是：
 * 8 条 id 与批准表对得上、申请档位没越过批准、去重键形状可构造、文案键由 id 机械生成。
 */
describe('platform notification event declarations', () => {
  it('declares the eight platform events the policy table signs', () => {
    const ids = PLATFORM_NOTIFICATION_EVENTS.map((event) => event.id)
    expect(ids).toHaveLength(8)
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
    expect(catalog.list()).toHaveLength(8)
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
    // 文案已到货，门禁改为硬判：平台 8 条的 title/reason 在中英两套里都必须查得到。
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
})
