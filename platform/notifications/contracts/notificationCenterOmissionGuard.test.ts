import { describe, expect, it } from 'vitest'

import { marketIntelligenceProductManifest } from '../../../products/market-intelligence/product.manifest'
import {
  allowsCenterOmission,
  createNotificationEventCatalog,
  type NotificationEventDeclaration
} from './notificationEventCatalog'
import { PLATFORM_NOTIFICATION_APPROVALS, PLATFORM_NOTIFICATION_EVENTS } from './platformNotificationEvents'

/**
 * 「谁允许省略 center」的**装配期守卫**（方案 §4，2026-11-18）。
 *
 * 判据是属性，不是事件 id：只有 `reminder` + `requiresUserAction === false` + `dedupeUnit === 'occurrence'`
 * 三者同时成立，批准表才可以不写 `center`。失败、要读者处理、持续状况必须留在中心——它们是读者
 * 事后要回看的事实，权限、额度、连接类都在这些档里。
 *
 * 违反 → **装配期直接拒**：静默按 required 补上，会让一张写错的批准表永远发现不了。
 */
const declaration = (patch: Partial<NotificationEventDeclaration>): NotificationEventDeclaration => ({
  id: 'platform.probe',
  titleKey: 'notification.test.title',
  reasonKey: 'notification.test.reason',
  requiresUserAction: false,
  category: 'reminder',
  requestedDisruptionLevels: [],
  dedupeKeyTemplate: 'probe:{id}',
  dedupeUnit: 'occurrence',
  ...patch
})

function catalogWith(entry: NotificationEventDeclaration, levels: readonly ('center' | 'toast' | 'popup' | 'desktop' | 'channel')[]) {
  return createNotificationEventCatalog({
    sources: [{
      productId: 'platform',
      events: [entry],
      approval: { [entry.id]: { approvedDisruptionLevels: [...levels], approvedBypassQuietHours: false } }
    }]
  })
}

describe('who may omit center', () => {
  it('allows only reminder + no action + one occurrence', () => {
    expect(allowsCenterOmission({ category: 'reminder', requiresUserAction: false, dedupeUnit: 'occurrence' })).toBe(true)
    expect(allowsCenterOmission({ category: 'reminder', requiresUserAction: true, dedupeUnit: 'occurrence' })).toBe(false)
    expect(allowsCenterOmission({ category: 'reminder', requiresUserAction: false, dedupeUnit: 'condition' })).toBe(false)
    expect(allowsCenterOmission({ category: 'failure', requiresUserAction: false, dedupeUnit: 'occurrence' })).toBe(false)
    expect(allowsCenterOmission({ category: 'needs-action', requiresUserAction: false, dedupeUnit: 'occurrence' })).toBe(false)
  })

  it('refuses a failure event that drops center instead of silently restoring it', () => {
    for (const patch of [
      { category: 'failure' as const },
      { category: 'needs-action' as const },
      { requiresUserAction: true },
      { dedupeUnit: 'condition' as const }
    ]) {
      expect(() => catalogWith(declaration({ id: 'platform.probe.bad', ...patch }), ['desktop']))
        .toThrow('notification-event-center-omission-not-allowed:platform.probe.bad')
    }
  })

  it('accepts the reminder shape that the two product events use', () => {
    expect(() => catalogWith(declaration({ id: 'platform.probe.ok' }), ['desktop'])).not.toThrow()
    expect(() => catalogWith(declaration({ id: 'platform.probe.center' }), ['center', 'desktop'])).not.toThrow()
  })

  it('keeps the real catalog honest, and prints the set that is allowed to omit center today', () => {
    const catalog = createNotificationEventCatalog({
      sources: [
        { productId: 'platform', events: PLATFORM_NOTIFICATION_EVENTS, approval: PLATFORM_NOTIFICATION_APPROVALS },
        {
          productId: 'market-intelligence',
          events: marketIntelligenceProductManifest.notificationEvents,
          approval: marketIntelligenceProductManifest.notificationApproval
        }
      ]
    })

    const omitted = catalog.list().filter((entry) => !entry.approvedDisruptionLevels.includes('center'))
    // 今天只该有舆情那两条；新增一条 reminder 会自动获得资格，改成要读者动手就当场红。
    // eslint-disable-next-line no-console
    console.log('[center-omission] allowed set:', omitted.map((entry) => entry.id).sort())
    expect(omitted.length).toBeGreaterThan(0)
    for (const entry of omitted) {
      expect(
        allowsCenterOmission(entry),
        `${entry.id} 不允许省略 center（category=${entry.category}, requiresUserAction=${String(entry.requiresUserAction)}, dedupeUnit=${entry.dedupeUnit}）`
      ).toBe(true)
    }
  })
})
