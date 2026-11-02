import { describe, expect, it } from 'vitest'

import {
  createNotificationEventCatalog,
  type NotificationEventDeclaration
} from './notificationEventCatalog'
import { NOTIFICATION_EVENT_POLICY, NOTIFICATION_EVENT_POLICY_ROW_COUNT } from './notificationEventPolicy'

/**
 * 目录与批准表（契约 §4、§4.1）。这张表是产品签过的上限，界面按它把未批准的格子画成灰色「—」；
 * 数量对不上，界面就会多画或少画一格 —— 所以行数与批准面在这里钉死。
 */
const declaration = (overrides: Partial<NotificationEventDeclaration>): NotificationEventDeclaration => ({
  id: 'platform.job.failed-terminal',
  titleKey: 'notification.jobFailed.title',
  reasonKey: 'notification.jobFailed.reason',
  requiresUserAction: true,
  requestedDisruptionLevels: ['desktop'],
  dedupeUnit: 'occurrence',
  notifyOnlyIfSubscribed: false,
  ...overrides
})

describe('notification event policy', () => {
  it('is the signed 15-row table (8 platform + 7 market-intelligence)', () => {
    expect(NOTIFICATION_EVENT_POLICY_ROW_COUNT).toBe(15)
    const ids = Object.keys(NOTIFICATION_EVENT_POLICY)
    expect(ids.filter((id) => id.startsWith('platform.'))).toHaveLength(8)
    expect(ids.filter((id) => id.startsWith('market-intelligence.'))).toHaveLength(7)
    // 本版不登记 signal.interpreted（裁定 A）：编号跳过 N4，也不许换号补位。
    expect(ids).not.toContain('market-intelligence.signal.interpreted')
    // 事件已按 §28 整条移除，批准表跟着删：批一条不存在的事件，等于给它留了一道静默复活的后门。
    expect(ids).not.toContain('market-intelligence.briefing.ready')
  })

  it('leaves exactly six desktop rows and thirteen channel rows unapproved', () => {
    // 批准表面：桌面 9 行、通道 2 行（超过这个数的实现就是把「没批」画成了「能开」）。
    const rows = Object.values(NOTIFICATION_EVENT_POLICY)
    expect(rows.filter((row) => row.approvedDisruptionLevels.includes('desktop'))).toHaveLength(9)
    expect(rows.filter((row) => row.approvedDisruptionLevels.includes('channel'))).toHaveLength(2)
    // 15 - 9 = 6 行未批准桌面；15 - 2 = 13 行未批准通道（删掉的那行两种都批过，所以两个数都没变）。
  })

  it('never approves a bypass and always keeps center', () => {
    for (const [id, row] of Object.entries(NOTIFICATION_EVENT_POLICY)) {
      expect(row.approvedBypassQuietHours, `${id} 不应批准穿透免打扰`).toBe(false)
      expect(row.approvedDisruptionLevels, `${id} 必须含 center`).toContain('center')
    }
  })
})

describe('notification event catalog', () => {
  it('merges declarations with the approval table: approval is the upper bound, not the request', () => {
    const catalog = createNotificationEventCatalog({
      sources: [{ productId: 'platform', events: [declaration({ requestedDisruptionLevels: ['desktop'] })] }],
      policy: { 'platform.job.failed-terminal': { approvedDisruptionLevels: ['center', 'desktop'], approvedBypassQuietHours: false } }
    })
    expect(catalog.has('platform.job.failed-terminal')).toBe(true)
    expect(catalog.get('platform.job.failed-terminal')?.approvedDisruptionLevels).toEqual(['center', 'desktop'])
    expect(catalog.get('platform.job.failed-terminal')?.productId).toBe('platform')
    expect(catalog.list()).toHaveLength(1)
  })

  it('falls back to center only when the platform has no approval row, without failing the declaration', () => {
    // 契约 §4 第二句：没有批准记录的一律只进中心；「申请了但还没批」不是错误（通道那条也走这里）。
    const catalog = createNotificationEventCatalog({
      sources: [{ productId: 'platform', events: [declaration({ requestedDisruptionLevels: ['desktop', 'channel'] })] }],
      policy: {}
    })
    expect(catalog.get('platform.job.failed-terminal')?.approvedDisruptionLevels).toEqual(['center'])
  })

  it('refuses a declaration whose requested level the platform did not approve', () => {
    expect(() => createNotificationEventCatalog({
      sources: [{ productId: 'platform', events: [declaration({ requestedDisruptionLevels: ['toast'] })] }],
      policy: { 'platform.job.failed-terminal': { approvedDisruptionLevels: ['center', 'desktop'], approvedBypassQuietHours: false } }
    })).toThrow(/requested-not-approved/)
  })

  it('treats an unapproved channel request as "not approved" instead of failing the declaration', () => {
    const catalog = createNotificationEventCatalog({
      sources: [{ productId: 'platform', events: [declaration({ requestedDisruptionLevels: ['desktop', 'channel'] })] }],
      policy: { 'platform.job.failed-terminal': { approvedDisruptionLevels: ['center', 'desktop'], approvedBypassQuietHours: false } }
    })
    expect(catalog.get('platform.job.failed-terminal')?.approvedDisruptionLevels).not.toContain('channel')
  })

  it('rejects a duplicate id and a declaration outside its owner prefix', () => {
    expect(() => createNotificationEventCatalog({
      sources: [{
        productId: 'platform',
        events: [declaration({ requestedDisruptionLevels: [] }), declaration({ requestedDisruptionLevels: [] })]
      }],
      policy: {}
    })).toThrow(/duplicate-id/)

    expect(() => createNotificationEventCatalog({
      sources: [{ productId: 'market-intelligence', events: [declaration({ id: 'platform.job.failed-terminal' })] }],
      policy: {}
    })).toThrow(/prefix-mismatch/)
  })
})
