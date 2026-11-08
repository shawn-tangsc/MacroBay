import { describe, expect, it } from 'vitest'

import { notificationCopy, notificationCopyText } from '../../i18n/notificationCopy'
import { findMissingNotificationEventCopy } from './notificationEventCopyGate'
import { createNotificationEventCatalog } from './notificationEventCatalog'
import { planNotificationSubmit } from '../runtime/notificationSubmitPlan'
import {
  notificationEventReasonKey,
  notificationEventTitleKey,
  PLATFORM_NOTIFICATION_APPROVALS,
  PLATFORM_NOTIFICATION_EVENTS
} from './platformNotificationEvents'

/**
 * 平台声明（契约 §2）。这批声明的批准值随声明自己走（`PLATFORM_NOTIFICATION_APPROVALS`），所以这里判的是：
 * 每条声明 id 都有对应的批准、申请档位没越过批准、去重键形状可构造、文案键由 id 机械生成。
 */
describe('platform notification event declarations', () => {
  it('every platform declaration has an approval of its own', () => {
    const ids = PLATFORM_NOTIFICATION_EVENTS.map((event) => event.id)
    expect(ids).toHaveLength(14)
    for (const id of ids) {
      expect(id.startsWith('platform.'), id).toBe(true)
      // 遍历声明去查批准，不数字数：数字对不上时它不再证明任何事（架构师口径）。
      expect(PLATFORM_NOTIFICATION_APPROVALS[id], `${id} 缺批准`).toBeDefined()
    }
  })

  it('every platform declaration reaches the catalog, and approval is the upper bound of every request', () => {
    const catalog = createNotificationEventCatalog({
      sources: [{ productId: 'platform', events: PLATFORM_NOTIFICATION_EVENTS, approval: PLATFORM_NOTIFICATION_APPROVALS }]
    })
    // **双向覆盖**，不是计数：只做正向会漏掉「目录里凭空多出几条」——那正是前面用双向覆盖堵过的洞。
    const declared = new Set(PLATFORM_NOTIFICATION_EVENTS.map((event) => event.id))
    const inCatalog = new Set(catalog.list().map((entry) => entry.id))
    const missingFromCatalog = [...declared].filter((id) => !inCatalog.has(id))
    const unexpectedInCatalog = [...inCatalog].filter((id) => !declared.has(id))
    // 逐条列出差异，不用 `toEqual` 一把盖掉：能被说清的差异比一个绿勾有用。
    expect({ missingFromCatalog, unexpectedInCatalog }).toEqual({ missingFromCatalog: [], unexpectedInCatalog: [] })
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
      sources: [{ productId: 'platform', events: PLATFORM_NOTIFICATION_EVENTS, approval: PLATFORM_NOTIFICATION_APPROVALS }]
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
      timeZone: 'UTC',
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
      timeZone: 'UTC',
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

  /**
   * 每日上限与「每次必回」的豁免（r23 档 0′/1）。
   *
   * 豁免必须靠**声明里没写 `dailyLimit`**拿到，不能靠某个特判分支：特判会在下一次改造里被顺手删掉。
   * 这里用两条构造声明验证能力本身——真实的三档事件随生产者一起登记，避免「登记了没人发」。
   */
  it('enforces a declared daily cap and leaves an undeclared one unlimited', () => {
    const catalog = createNotificationEventCatalog({
      sources: [{
        productId: 'platform',
        events: [
          { id: 'platform.capped-probe', titleKey: 'notification.taskFailed.title', reasonKey: 'notification.taskFailed.body', category: 'failure', requiresUserAction: false, requestedDisruptionLevels: [], dedupeUnit: 'occurrence', dedupeKeyTemplate: 'probe:{slot}', dailyLimit: 2, minimumGapMs: 6 * 60 * 60 * 1_000 },
          { id: 'platform.uncapped-probe', titleKey: 'notification.taskFailed.title', reasonKey: 'notification.taskFailed.body', category: 'failure', requiresUserAction: false, requestedDisruptionLevels: [], dedupeUnit: 'occurrence', dedupeKeyTemplate: 'uncapped:{slot}' }
        ]
      }]
    })
    const settings = {
      desktopEnabled: true,
      toastEnabled: true,
      popupEnabled: false,
      push: { channelId: null },
      retentionDays: 30,
      defaultSnoozeMinutes: 10
    }
    const plan = (eventTypeId: string, vars: Record<string, string>, sameEventToday?: { count: number; lastOccurredAt: string | null }) =>
      planNotificationSubmit({
        catalog,
        settings,
        desktopSupported: true,
      timeZone: 'UTC',
        now: '2026-11-06T12:00:00.000Z',
        request: { eventTypeId, dedupeVars: { builder: 'template', vars }, actions: [], occurredAt: '2026-11-06T11:59:00.000Z' },
        ...(sameEventToday === undefined ? {} : { sameEventToday })
      })

    const third = plan('platform.capped-probe', { slot: 'a' }, { count: 2, lastOccurredAt: null })
    if (third.kind !== 'rejected') throw new Error('第 3 条应当被当日上限拒')
    expect(third.outcome.reason).toBe('daily-limit-reached')

    // 冷却：「刚说过」与「说满了」是两个原因，读者该听到的解释不一样。
    const gap = plan('platform.capped-probe', { slot: 'a' }, { count: 1, lastOccurredAt: '2026-11-06T11:00:00.000Z' })
    if (gap.kind !== 'rejected') throw new Error('冷却内的提交应当被拒')
    expect(gap.outcome.reason).toBe('minimum-gap-active')

    // 没写上限的事件不判：今天已经发过 5 条，第 6 次仍然要发出去。
    expect(plan('platform.uncapped-probe', { slot: 'b' }, { count: 5, lastOccurredAt: '2026-11-06T11:59:59.000Z' }).kind).toBe('new')
  })

  /**
   * 0′ 的豁免用**真事件**再钉一次（r23 需求验收：当天各档都打满，读者手动点的那次仍要收到）。
   *
   * 构造样例只证明「能力是可选字段」，这条证明「那条真的没写上限」——两者缺一，
   * 明天有人给它「顺手统一」补一个数，前一条照样绿。
   */
  it('never caps the manual-failure notice, even after five went out today', () => {
    const catalog = createNotificationEventCatalog({
      sources: [{ productId: 'platform', events: PLATFORM_NOTIFICATION_EVENTS, approval: PLATFORM_NOTIFICATION_APPROVALS }]
    })
    const declaration = PLATFORM_NOTIFICATION_EVENTS.find((event) => event.id === 'platform.analysis.manual-failed')
    expect(declaration?.dailyLimit).toBeUndefined()
    expect(declaration?.minimumGapMs).toBeUndefined()

    const outcome = planNotificationSubmit({
      catalog,
      settings: {
        desktopEnabled: true,
        toastEnabled: true,
        popupEnabled: false,
        push: { channelId: null },
        retentionDays: 30,
        defaultSnoozeMinutes: 10
      },
      desktopSupported: true,
      timeZone: 'UTC',
      now: '2026-11-06T12:00:00.000Z',
      sameEventToday: { count: 5, lastOccurredAt: '2026-11-06T11:58:00.000Z' },
      request: {
        eventTypeId: 'platform.analysis.manual-failed',
        dedupeVars: { builder: 'template', vars: { runId: 'run-sixth' } },
        bodyParams: { reason: '模型服务正在限流，没有接受这次请求' },
        actions: [{ id: 'open-analysis-run', labelKey: 'notification.event.platform.analysis.manual-failed.open', kind: 'open' }],
        occurredAt: '2026-11-06T11:59:00.000Z'
      }
    })
    expect(outcome.kind).toBe('new')
  })
})
