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
    category: 'reminder',
  requestedDisruptionLevels: ['desktop'],
  dedupeUnit: 'occurrence',
  ...overrides
})

describe('notification event policy', () => {
  it('is the signed 24-row table (14 platform + 10 market-intelligence)', () => {
    expect(NOTIFICATION_EVENT_POLICY_ROW_COUNT).toBe(24)
    const ids = Object.keys(NOTIFICATION_EVENT_POLICY)
    expect(ids.filter((id) => id.startsWith('platform.'))).toHaveLength(14)
    expect(ids.filter((id) => id.startsWith('market-intelligence.'))).toHaveLength(10)
    // 本版不登记 signal.interpreted（裁定 A）：编号跳过 N4，也不许换号补位。
    expect(ids).not.toContain('market-intelligence.signal.interpreted')
    // N8 calibration.result 2026-11-04 撤回：编号不复用，行也不留（留着就是静默复活的口子）。
    expect(ids).not.toContain('market-intelligence.calibration.result')
    // 完成类仍在表里：读者在情报页可以关掉它的手机推送。
    expect(ids).toContain('market-intelligence.briefing.ready')
  })

  it('keeps desktop to the rows the user approved, now including a finished briefing', () => {
    // 桌面对「信息类」不开放（用户原话：没打开应用还被轰炸）。2026-11-06 用户追加一条：
    // **日报生成成功**也要能弹（此前只有失败那档弹）；同一天摘掉它的 `toast`——用户只说了桌面，
    // 「不弹应用内提示」是 11-04 的原话。同日加入 P9 手动分析失败（失败类，读者刚点过）。
    // 17 = 平台 14（P7 不走桌面；自检是诊断，四档全批）+ 情报 4 + 日报完成 1（含在情报 4 里，别重算）。
    const rows = Object.entries(NOTIFICATION_EVENT_POLICY)
    expect(rows.filter(([, row]) => row.approvedDisruptionLevels.includes('desktop')).map(([id]) => id).sort()).toEqual([
      'market-intelligence.briefing.failed',
      'market-intelligence.briefing.ready',
      'market-intelligence.source.consecutive-failed',
      'market-intelligence.source.stale',
      'market-intelligence.timezone.invalid',
      'platform.analysis.attempt-abandoned',
      'platform.analysis.manual-failed',
      'platform.analysis.quota-exhausted',
      'platform.analysis.repeated-failure',
      'platform.channel.connection-lost',
      'platform.channel.push-resumed',
      'platform.channel.push-suspended',
      'platform.job.failed-terminal',
      'platform.job.repeated-failed',
      // 自检是读者亲手点的诊断，四档全批（2026-11-08 用户拍板），所以它也在桌面这一格里；
      // 它和「真实事件」不是同一类，别因为它在表里就以为桌面又要对所有事件开放。
      'platform.notification.self-test',
      'platform.provider.credential-invalid',
      'platform.provider.credential-recovered'
    ])
    // P7 不投桌面，否则「桌面失败 → P7 → 投桌面 → 再失败」自激。
    expect(NOTIFICATION_EVENT_POLICY['platform.desktop.blocked'].approvedDisruptionLevels).not.toContain('desktop')
    // 手机四条：N2 日报完成、N3 信号、N5 宏观事件、N10 舆情。N10 是 2026-11-06 新增的
    // （契约 §4.1 / 情报需求 v3.58 §十四），它只批 center + channel——桌面与提示两档明确不加。
    expect(rows.filter(([, row]) => row.approvedDisruptionLevels.includes('channel')).map(([id]) => id).sort()).toEqual([
      'market-intelligence.analysis.conclusion',
      'market-intelligence.briefing.ready',
      'market-intelligence.calendar.event-upcoming',
      'market-intelligence.macro.event-landed',
      'market-intelligence.sentiment.alert',
      'market-intelligence.signal.triggered',
      'platform.notification.self-test'
    ])
    // 提示默认开：关掉桌面时它是唯一的本机提醒。唯一例外是 P9——读者刚点过、人就在面板前，
    // 桌面优先，同一次失败不在应用内再吵第二遍（P7 反过来：它只有 center + toast，不走桌面）。
    // 不批提示的三行：
    // - P9：读者刚点过、人就在面板前，桌面优先，同一次失败不在应用内再吵一遍；
    // - 日报完成：**桌面批准、提示不批**——11-04 用户原话「不弹提示」，11-06 只要求桌面通知，
    //   两格不是一回事，留着提示就是替他多要一次打扰（不是漏配，别顺手补回来）；
    // - N10 舆情：信息类，手机与中心就够；
    // - 分析结论：完成类，用户要的是「结论到了」这一声，反过来只在手机与中心（同向时由调用方收窄到中心）。
    // 顺序就是表里的顺序（平台几行在前），别按字母排。
    expect(rows.filter(([, row]) => !row.approvedDisruptionLevels.includes('toast')).map(([id]) => id)).toEqual([
      'platform.analysis.manual-failed',
      'market-intelligence.briefing.ready',
      'market-intelligence.sentiment.alert',
      'market-intelligence.analysis.conclusion'
    ])
  })

  it('approves a quiet-hours bypass only for the self-test, and always keeps center', () => {
    // 2026-11-08 用户拍板：读者亲手点的诊断不算系统打扰，只有自检一行可穿透。
    // 这条用例是「谁能穿透」的唯一定义处——多放一行进去，等于替读者多批了一次打扰。
    const bypassing = Object.entries(NOTIFICATION_EVENT_POLICY)
      .filter(([, row]) => row.approvedBypassQuietHours)
      .map(([id]) => id)
    expect(bypassing).toEqual(['platform.notification.self-test'])
    for (const [id, row] of Object.entries(NOTIFICATION_EVENT_POLICY)) {
      expect(row.approvedDisruptionLevels, `${id} 必须含 center`).toContain('center')
      if (id !== 'platform.notification.self-test') {
        expect(row.approvedBypassQuietHours, `${id} 不应批准穿透免打扰`).toBe(false)
      }
    }
  })
})

describe('notification event catalog', () => {
  it('merges declarations with the approval table: approval is the upper bound, not the request', () => {
    const catalog = createNotificationEventCatalog({
      sources: [{
        productId: 'platform',
        approval: { 'platform.job.failed-terminal': { approvedDisruptionLevels: ['center', 'desktop'], approvedBypassQuietHours: false } },
        events: [declaration({ requestedDisruptionLevels: ['desktop'] })]
      }],
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
    })
    expect(catalog.get('platform.job.failed-terminal')?.approvedDisruptionLevels).toEqual(['center'])
  })

  it('refuses a declaration whose requested level the platform did not approve', () => {
    // 批准在来源上（b2/b3）：来源给了批准、但没含申请的那一档 -> 装配期报错。
    expect(() => createNotificationEventCatalog({
      sources: [{
        productId: 'platform',
        events: [declaration({ requestedDisruptionLevels: ['toast'] })],
        approval: { 'platform.job.failed-terminal': { approvedDisruptionLevels: ['center'], approvedBypassQuietHours: false } }
      }],
    })).toThrow(/requested-not-approved/)
  })

  it('treats an unapproved channel request as "not approved" instead of failing the declaration', () => {
    const catalog = createNotificationEventCatalog({
      sources: [{ productId: 'platform', events: [declaration({ requestedDisruptionLevels: ['desktop', 'channel'] })] }],
    })
    expect(catalog.get('platform.job.failed-terminal')?.approvedDisruptionLevels).not.toContain('channel')
  })

  it('rejects a duplicate id and a declaration outside its owner prefix', () => {
    expect(() => createNotificationEventCatalog({
      sources: [{
        productId: 'platform',
        events: [declaration({ requestedDisruptionLevels: [] }), declaration({ requestedDisruptionLevels: [] })]
      }],
    })).toThrow(/duplicate-id/)

    expect(() => createNotificationEventCatalog({
      sources: [{ productId: 'market-intelligence', events: [declaration({ id: 'platform.job.failed-terminal' })] }],
    })).toThrow(/prefix-mismatch/)
  })
})
