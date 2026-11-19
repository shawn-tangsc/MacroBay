import { describe, expect, it } from 'vitest'

import {
  allowsCenterOmission,
  createNotificationEventCatalog,
  type NotificationEventDeclaration
} from './notificationEventCatalog'

/**
 * 「谁允许省略 center」的**装配期守卫**（方案 §4，2026-11-18）。
 *
 * 判据是属性，不是事件 id：只有 `reminder` + `requiresUserAction === false` + `dedupeUnit === 'occurrence'`
 * 三者同时成立，批准表才可以不写 `center`。失败、要读者处理、持续状况必须留在中心——它们是读者
 * 事后要回看的事实，权限、额度、连接类都在这些档里。
 *
 * 违反 → **装配期直接拒**：静默按 required 补上，会让一张写错的批准表永远发现不了。
 *
 * 这里只用**合成声明**（平台层不许 import 产品代码）；真实批准表里「哪几条可以不写中心」由产品侧
 * 那份用例（`products/.../contracts/notificationCenterOmission.test.ts`）钉住。
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

  it('holds for every entry of a catalog that does omit center: none of them may be a failure', () => {
    // 合成目录里放一条合格的（桌面-only）与一条含 center 的：判据只对「不写 center」的那些生效。
    const catalog = createNotificationEventCatalog({
      sources: [{
        productId: 'platform',
        events: [
          declaration({ id: 'platform.probe.desktop-only', requestedDisruptionLevels: ['desktop'] }),
          declaration({ id: 'platform.probe.with-center', requestedDisruptionLevels: [] })
        ],
        approval: {
          'platform.probe.desktop-only': { approvedDisruptionLevels: ['desktop'], approvedBypassQuietHours: false },
          'platform.probe.with-center': { approvedDisruptionLevels: ['center'], approvedBypassQuietHours: false }
        }
      }]
    })

    const omitted = catalog.list().filter((entry) => !entry.approvedDisruptionLevels.includes('center'))
    expect(omitted.map((entry) => entry.id)).toEqual(['platform.probe.desktop-only'])
    for (const entry of omitted) {
      expect(
        allowsCenterOmission(entry),
        `${entry.id} 不允许省略 center（category=${entry.category}, requiresUserAction=${String(entry.requiresUserAction)}, dedupeUnit=${entry.dedupeUnit}）`
      ).toBe(true)
    }
  })
})
