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
    // N8 calibration.result 2026-11-04 撤回：编号不复用，行也不留（留着就是静默复活的口子）。
    expect(ids).not.toContain('market-intelligence.calibration.result')
    // 完成类仍在表里：读者在情报页可以关掉它的手机推送。
    expect(ids).toContain('market-intelligence.briefing.ready')
  })

  it('keeps desktop to the eleven failure / correction / system-status rows', () => {
    // 桌面对「信息类」与「完成类」不开放（用户原话：没打开应用还被轰炸）。
    // 11 = 平台 7（P7 自己不走桌面）+ 情报 4（当地时间无效、来源连续失败、来源长时间无数据、日报没生成）。
    const rows = Object.entries(NOTIFICATION_EVENT_POLICY)
    expect(rows.filter(([, row]) => row.approvedDisruptionLevels.includes('desktop')).map(([id]) => id).sort()).toEqual([
      'market-intelligence.briefing.failed',
      'market-intelligence.source.consecutive-failed',
      'market-intelligence.source.stale',
      'market-intelligence.timezone.invalid',
      'platform.analysis.quota-exhausted',
      'platform.channel.push-resumed',
      'platform.channel.push-suspended',
      'platform.job.failed-terminal',
      'platform.job.repeated-failed',
      'platform.provider.credential-invalid',
      'platform.provider.credential-recovered'
    ])
    // P7 不投桌面，否则「桌面失败 → P7 → 投桌面 → 再失败」自激。
    expect(NOTIFICATION_EVENT_POLICY['platform.desktop.blocked'].approvedDisruptionLevels).not.toContain('desktop')
    // 手机只批三条。
    expect(rows.filter(([, row]) => row.approvedDisruptionLevels.includes('channel')).map(([id]) => id).sort()).toEqual([
      'market-intelligence.briefing.ready',
      'market-intelligence.macro.event-landed',
      'market-intelligence.signal.triggered'
    ])
    // 提示 15 行全开：关掉桌面时它是唯一的本机提醒。
    expect(rows.filter(([, row]) => row.approvedDisruptionLevels.includes('toast'))).toHaveLength(15)
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
