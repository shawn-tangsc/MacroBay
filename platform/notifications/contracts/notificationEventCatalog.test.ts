import { describe, expect, it } from 'vitest'

import {
  createNotificationEventCatalog,
  type NotificationEventDeclaration
} from './notificationEventCatalog'
import { PLATFORM_NOTIFICATION_APPROVALS, PLATFORM_NOTIFICATION_EVENTS } from './platformNotificationEvents'

/**
 * 目录与批准（契约 §4、§4.1）：批准是签过的上限，界面按它把未批准的格子画成灰色「—」。
 * 这里只断**平台自己**签了什么；产品那几条的档位由产品侧自己的用例守——平台没资格替产品作证。
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

describe('platform approvals', () => {
  const approved = PLATFORM_NOTIFICATION_APPROVALS
  const ids = Object.keys(approved)

  it('signs exactly the events it declares, checked in both directions', () => {
    const declared = PLATFORM_NOTIFICATION_EVENTS.map((event) => event.id)
    // 双向：签了没声明 = 死配置；声明了没签 = 读者看不见的窟窿。逐条列出，不用计数替代。
    expect({
      signedWithoutDeclaration: ids.filter((id) => !declared.includes(id)),
      declaredWithoutSignature: declared.filter((id) => !ids.includes(id))
    }).toEqual({ signedWithoutDeclaration: [], declaredWithoutSignature: [] })
  })

  it('keeps desktop to the platform events the user approved', () => {
    // 桌面对「信息类」不开放（用户原话：没打开应用还被轰炸）。平台这一侧批了桌面的就是下面这些，
    // 顺序即批准文件里的顺序；用户新增或摘掉一条必须在这里显式改，不靠数字对上蒙过去。
    expect(ids.filter((id) => approved[id]!.approvedDisruptionLevels.includes('desktop'))).toEqual([
      'platform.job.failed-terminal',
      'platform.job.repeated-failed',
      'platform.analysis.quota-exhausted',
      'platform.provider.credential-invalid',
      'platform.provider.credential-recovered',
      'platform.channel.push-suspended',
      'platform.channel.push-resumed',
      // 自检是读者亲手点的诊断，四档全批（2026-11-08 用户拍板），所以它也在桌面这一格里；
      // 它和「真实事件」不是同一类，别因为它在里面就以为桌面又要对所有事件开放。
      'platform.notification.self-test',
      'platform.channel.connection-lost',
      // P9 手动分析失败：失败类，读者刚点过。它走桌面、**不批提示**（见下面那条用例）。
      'platform.analysis.manual-failed',
      'platform.analysis.repeated-failure',
      'platform.analysis.attempt-abandoned'
    ])
    // P7 不投桌面，否则「桌面失败 → P7 → 投桌面 → 再失败」自激。
    expect(approved['platform.desktop.blocked']!.approvedDisruptionLevels).not.toContain('desktop')
    // 恢复类只留中心 + 提示：事情已经过去了，不必再占一块桌面。
    expect(approved['platform.analysis.recovered']!.approvedDisruptionLevels).not.toContain('desktop')
  })

  it('keeps the phone leg to the self-test alone', () => {
    // 读者亲手点的诊断要能到手机；其余平台事件在这一侧都没有手机档。
    expect(ids.filter((id) => approved[id]!.approvedDisruptionLevels.includes('channel'))).toEqual([
      'platform.notification.self-test'
    ])
  })

  it('leaves exactly one platform event without a toast', () => {
    // P9：读者刚点过、人就在面板前，桌面优先，同一次失败不在应用内再吵第二遍。
    expect(ids.filter((id) => !approved[id]!.approvedDisruptionLevels.includes('toast'))).toEqual([
      'platform.analysis.manual-failed'
    ])
  })

  it('approves a quiet-hours bypass only for the self-test, and always keeps center', () => {
    // 2026-11-08 用户拍板：读者亲手点的诊断不算系统打扰，只有自检一行可穿透。
    // 这条用例是平台这一侧「谁能穿透」的唯一定义处——多放一行进去，等于替读者多批了一次打扰。
    expect(ids.filter((id) => approved[id]!.approvedBypassQuietHours)).toEqual(['platform.notification.self-test'])
    for (const id of ids) {
      expect(approved[id]!.approvedDisruptionLevels, `${id} 必须含 center`).toContain('center')
      if (id !== 'platform.notification.self-test') {
        expect(approved[id]!.approvedBypassQuietHours, `${id} 不应批准穿透免打扰`).toBe(false)
      }
    }
  })
})

describe('quiet-hours bypass belongs to diagnostic events alone', () => {
  it('refuses a bypass approval on an event that is not declared diagnostic, by id', () => {
    expect(() => createNotificationEventCatalog({
      sources: [{
        productId: 'platform',
        events: [declaration({ id: 'platform.synthetic-alert', requestedDisruptionLevels: [] })],
        approval: { 'platform.synthetic-alert': { approvedDisruptionLevels: ['center'], approvedBypassQuietHours: true } }
      }]
    })).toThrow(/notification-event-bypass-not-diagnostic:platform\.synthetic-alert/)
  })

  it('does not take a test submission for a diagnostic qualification: only the declaration flag counts', () => {
    // 提交请求上的 `namespace: 'test'` 只换去重域，不换资格；id 叫什么、谁来发都不算资格。
    const baseline = {
      productId: 'platform',
      approval: { 'platform.notification.self-test': { approvedDisruptionLevels: ['center', 'channel'] as const, approvedBypassQuietHours: true } }
    }
    expect(() => createNotificationEventCatalog({
      sources: [{
        ...baseline,
        events: [declaration({ id: 'platform.notification.self-test', requestedDisruptionLevels: ['channel'] })]
      }]
    })).toThrow(/notification-event-bypass-not-diagnostic:platform\.notification\.self-test/)

    const catalog = createNotificationEventCatalog({
      sources: [{
        ...baseline,
        events: [declaration({ id: 'platform.notification.self-test', requestedDisruptionLevels: ['channel'], diagnostic: true })]
      }]
    })
    expect(catalog.get('platform.notification.self-test')?.approvedBypassQuietHours).toBe(true)
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
      // 合成产品 id：这条断的是「声明前缀必须属于自己」，与任何真实产品无关。
      sources: [{ productId: 'sample-product', events: [declaration({ id: 'platform.job.failed-terminal' })] }],
    })).toThrow(/prefix-mismatch/)
  })
})
