import { describe, expect, it } from 'vitest'

import { createNotificationEventCatalog, type NotificationEventPolicy } from '../contracts/notificationEventCatalog'
import type { NotificationSubmitRequest } from '../contracts/notificationContracts'
import { planNotificationSubmit } from './notificationSubmitPlan'
import { externalActionUrl } from '../delivery/channelPushPort'

const catalog = createNotificationEventCatalog({
  // 批准值随声明走（b2）：值原样。
  sources: [
    {
      productId: 'platform',
      approval: {
        'platform.failed': { approvedDisruptionLevels: ['center', 'toast', 'desktop'], approvedBypassQuietHours: false },
        'platform.ready': { approvedDisruptionLevels: ['center', 'desktop', 'channel'], approvedBypassQuietHours: false },
        'platform.variant': { approvedDisruptionLevels: ['center'], approvedBypassQuietHours: false },
        'platform.title-variant': { approvedDisruptionLevels: ['center'], approvedBypassQuietHours: false },
        'platform.raw': { approvedDisruptionLevels: ['center'], approvedBypassQuietHours: false }
      },
      events: [
        {
          id: 'platform.failed',
          titleKey: 'notification.taskFailed.title',
          reasonKey: 'notification.taskFailed.body',
          requiresUserAction: true,
    category: 'reminder',
          requestedDisruptionLevels: ['toast', 'desktop'],
          dedupeKeyTemplate: 'failed:{definitionId}:{date}',
          dedupeUnit: 'condition',
          conditionWindowMs: 86_400_000,
        },
        {
          id: 'platform.ready',
          titleKey: 'notification.test.title',
          reasonKey: 'notification.test.body',
          requiresUserAction: false,
    category: 'reminder',
          requestedDisruptionLevels: ['desktop', 'channel'],
          dedupeKeyTemplate: 'ready:{date}',
          dedupeUnit: 'occurrence',
        },
        {
          id: 'platform.raw',
          titleKey: 'notification.test.title',
          reasonKey: 'notification.test.body',
          requiresUserAction: false,
    category: 'reminder',
          requestedDisruptionLevels: [],
          dedupeKeyTemplate: '{key}',
          dedupeUnit: 'occurrence',
        },
        {
          id: 'platform.variant',
          titleKey: 'notification.test.title',
          bodyKeyByVariant: { failed: 'notification.test.body', 'data-only': 'notification.aggregate.title' },
          reasonKey: 'notification.test.body',
          requiresUserAction: false,
    category: 'reminder',
          requestedDisruptionLevels: [],
          dedupeKeyTemplate: 'variant:{id}',
          dedupeUnit: 'occurrence',
        },
        {
          id: 'platform.title-variant',
          titleKey: 'notification.test.title',
          titleKeyByVariant: { direction: 'notification.test.title', published: 'notification.test.body' },
          reasonKey: 'notification.test.body',
          reasonKeyByVariant: { threshold: 'notification.test.body', importance: 'notification.test.title' },
          requiresUserAction: false,
          category: 'reminder',
          requestedDisruptionLevels: [],
          dedupeKeyTemplate: 'title-variant:{id}',
          dedupeUnit: 'occurrence',
        }
      ]
    },
    {
      productId: 'other-product',
      events: [
        {
          id: 'other-product.thing',
          titleKey: 'notification.test.title',
          reasonKey: 'notification.test.body',
          requiresUserAction: false,
    category: 'reminder',
          requestedDisruptionLevels: [],
          dedupeKeyTemplate: 'thing:{id}',
          dedupeUnit: 'occurrence',
        }
      ]
    }
  ]
})

function request(overrides: Partial<NotificationSubmitRequest> = {}): NotificationSubmitRequest {
  return {
    eventTypeId: 'platform.failed',
    dedupeVars: { builder: 'template', vars: { definitionId: 'job-1', date: '2026-11-03' } },
    actions: [{ id: 'open', labelKey: 'notification.taskFailed.open', kind: 'open' }],
    occurredAt: '2026-11-03T00:00:00.000Z',
    ...overrides
  }
}

const base = {
  catalog,
  settings: {
    desktopEnabled: true,
    toastEnabled: false,
    popupEnabled: false,
    push: { channelId: null },
    retentionDays: 30,
    defaultSnoozeMinutes: 60
  },
  desktopSupported: true,
  now: '2026-11-03T00:00:00.000Z',
  // 用例显式声明读者在哪个时区：免打扰窗口按它算，不再有「没传就按 UTC」的缺省。
  timeZone: 'UTC'
}

describe('notification submit planner', () => {
  it('resolves the title and reason variant the event declared, like the body variant', () => {
    const plan = planNotificationSubmit({
      ...base,
      request: request({
        eventTypeId: 'platform.title-variant',
        dedupeVars: { builder: 'template', vars: { id: 'v1' } },
        titleVariant: 'published',
        reasonVariant: 'importance'
      })
    })

    expect(plan.kind).toBe('new')
    if (plan.kind !== 'new') return
    // 变体解析出的仍是**键**，不是句子：以后改文案历史跟着变好（这正是它不等于 `rendered` 的地方）。
    expect(plan.record.titleKey).toBe('notification.test.body')
    expect(plan.record.reasonKey).toBe('notification.test.title')
  })

  it('rejects a missing or unknown title/reason variant instead of falling back to the default key', () => {
    const missing = planNotificationSubmit({
      ...base,
      request: request({ eventTypeId: 'platform.title-variant', dedupeVars: { builder: 'template', vars: { id: 'v2' } } })
    })
    expect(missing.kind).toBe('rejected')

    const unknown = planNotificationSubmit({
      ...base,
      request: request({
        eventTypeId: 'platform.title-variant',
        dedupeVars: { builder: 'template', vars: { id: 'v3' } },
        titleVariant: 'nope'
      })
    })
    expect(unknown.kind).toBe('rejected')
  })

  it('rejects an unregistered event type', () => {
    const plan = planNotificationSubmit({ ...base, request: request({ eventTypeId: 'platform.nope' }) })
    expect(plan.kind).toBe('rejected')
    if (plan.kind === 'rejected') expect(plan.outcome.reason).toBe('unknown-event-type')
  })

  it('rejects an event that requires an action when actions are empty', () => {
    const plan = planNotificationSubmit({ ...base, request: request({ actions: [] }) })
    expect(plan.kind).toBe('rejected')
    if (plan.kind === 'rejected') expect(plan.outcome.reason).toBe('missing-action')
  })

  it('always records a completion event now that the subscription layer is gone', () => {
    // 2026-11-04：逐事件订阅整层撤销，「没勾就抑制」这条路不再存在；中心恒记一条。
    const plan = planNotificationSubmit({
      ...base,
      request: request({ eventTypeId: 'platform.ready', dedupeVars: { builder: 'template', vars: { date: '2026-11-03' } }, actions: [] })
    })
    expect(plan.kind).toBe('new')
    if (plan.kind !== 'new') return
    // 完成类也照常落库；本机表面同样按「桌面优先」排——没有订阅就不再抑制。
    expect(plan.record.delivery.desktop).toEqual({ state: 'queued', at: base.now })
  })

  it('queues exactly one local surface: desktop when it can show, otherwise the in-app toast', () => {
    const plan = planNotificationSubmit({ ...base, request: request() })
    expect(plan.kind).toBe('new')
    if (plan.kind !== 'new') return
    // 桌面开关开着且平台支持 → 只排桌面，**不再同时排提示**（只打扰一次）。
    expect(plan.outcome.levels).toEqual(['center', 'desktop'])
    expect(plan.record.delivery).toEqual({ desktop: { state: 'queued', at: base.now } })
    expect(plan.record.dedupeKey).toBe('platform|failed:job-1:2026-11-03')
  })

  it('falls back to the in-app toast when the desktop switch is off', () => {
    const plan = planNotificationSubmit({
      ...base,
      settings: { ...base.settings, desktopEnabled: false, toastEnabled: true },
      request: request()
    })
    expect(plan.kind).toBe('new')
    if (plan.kind !== 'new') return
    expect(plan.outcome.levels).toEqual(['center', 'toast'])
    expect(plan.record.delivery).toEqual({ toast: { state: 'queued', at: base.now } })
  })

  it('rejects a hand-built key that claims another product prefix', () => {
    const plan = planNotificationSubmit({
      ...base,
      request: request({
        eventTypeId: 'platform.raw',
        dedupeVars: { builder: 'template', vars: { key: 'other-product|thing:1' } },
        actions: []
      })
    })
    expect(plan.kind).toBe('rejected')
    if (plan.kind === 'rejected') expect(plan.outcome.reason).toBe('cross-product-key')
  })

  it('requires a known body variant when the declaration has variant keys', () => {
    const missing = planNotificationSubmit({
      ...base,
      request: request({ eventTypeId: 'platform.variant', dedupeVars: { builder: 'template', vars: { id: '1' } }, actions: [] })
    })
    expect(missing).toMatchObject({ kind: 'rejected', outcome: { reason: 'unknown-body-variant' } })

    const known = planNotificationSubmit({
      ...base,
      request: request({
        eventTypeId: 'platform.variant',
        bodyVariant: 'failed',
        dedupeVars: { builder: 'template', vars: { id: '1' } },
        actions: []
      })
    })
    expect(known.kind).toBe('new')
    if (known.kind === 'new') expect(known.record.bodyKey).toBe('notification.test.body')
  })
})

describe('「看原文」动作：外链只有一种写法（契约 §7.5 ⑫）', () => {
  const external = (overrides: Record<string, unknown> = {}) => ({
    id: 'read-original',
    labelKey: 'notification.action.open-original' as const,
    kind: 'open-external' as const,
    url: 'https://example.com/news/42',
    ...overrides
  })

  it('accepts one http(s) link and keeps it on the record, untouched', () => {
    const plan = planNotificationSubmit({ ...base, request: request({ actions: [external()] }) })
    expect(plan.kind).toBe('new')
    if (plan.kind !== 'new') return
    // 中心按钮与手机末尾那一行读的是**同一份**：记录里存原地址，不在正文里再放一份。
    expect(plan.record.actions).toEqual([external()])
  })

  it('normalizes the address once, so the centre button and the phone read the same value', () => {
    const plan = planNotificationSubmit({
      ...base,
      request: request({ actions: [external({ url: '  https://example.com/news/42  ' })] })
    })
    expect(plan.kind).toBe('new')
    if (plan.kind !== 'new') return
    // 两端各 trim 一次不算保证：一个带空白的地址会「中心能开、手机打不开」。记录里只存一个值。
    expect(plan.record.actions).toEqual([external()])
    expect(externalActionUrl(plan.record.actions)).toEqual({ url: 'https://example.com/news/42', extra: 0 })
  })

  it('rejects open-external without a url: a button with nowhere to go', () => {
    const plan = planNotificationSubmit({
      ...base,
      request: request({ actions: [external({ url: undefined })] })
    })
    expect(plan).toMatchObject({ kind: 'rejected', outcome: { reason: 'external-action-without-url' } })
  })

  it('rejects anything that is not an absolute http(s) address', () => {
    // `http:example.com` 不在这张表里：WHATWG 把 http/https 当「特殊协议」，会把它规范化成
    // `http://example.com/`——那确实是一个能打开的绝对地址，拒它反而会把合法写法挡掉。
    for (const url of ['javascript:alert(1)', 'file:///etc/passwd', '/news/42', 'ftp://example.com/a']) {
      const plan = planNotificationSubmit({ ...base, request: request({ actions: [external({ url })] }) })
      expect(plan, url).toMatchObject({ kind: 'rejected', outcome: { reason: 'external-action-bad-url' } })
    }
  })

  it('rejects a url on any other kind: two notions of "outside" must not be mixed', () => {
    const plan = planNotificationSubmit({
      ...base,
      request: request({ actions: [external({ kind: 'open', url: 'https://example.com/a' })] })
    })
    expect(plan).toMatchObject({ kind: 'rejected', outcome: { reason: 'url-without-external-action' } })
  })

  it('rejects open-external carrying an in-app deeplink: that cannot be opened on a phone', () => {
    const plan = planNotificationSubmit({
      ...base,
      request: request({ actions: [external({ deeplink: { scope: 'platform' as const } })] })
    })
    expect(plan).toMatchObject({ kind: 'rejected', outcome: { reason: 'external-action-with-deeplink' } })
  })

  it('does not echo the whole url into the rejection message', () => {
    const plan = planNotificationSubmit({
      ...base,
      request: request({ actions: [external({ url: 'ftp://secret.example.com/token=abc' })] })
    })
    expect(plan.kind).toBe('rejected')
    if (plan.kind === 'rejected') {
      // 只回协议名：正文里的一次性参数不该被日志再存一份。
      expect(plan.outcome.message).toContain('ftp:')
      expect(plan.outcome.message).not.toContain('token=abc')
    }
  })
})

describe('事件级频道开关（channelEvents）', () => {
  // `platform.ready` 批准 center + desktop + channel；`platform.variant` 只批 center。
  const readyRequest = request({
    eventTypeId: 'platform.ready',
    dedupeVars: { builder: 'template', vars: { date: '2026-11-03' } },
    actions: []
  })

  it('treats a missing key as on: 装上就推，不想收再去关', () => {
    const plan = planNotificationSubmit({ ...base, request: readyRequest })

    expect(plan.kind).toBe('new')
    if (plan.kind !== 'new') return
    expect(plan.outcome.levels).toContain('channel')
    expect(plan.record.delivery.push).toEqual({ state: 'queued', at: base.now })
  })

  it('drops the phone when the reader turned this event off', () => {
    const plan = planNotificationSubmit({
      ...base,
      settings: { ...base.settings, channelEvents: { 'platform.ready': false } },
      request: readyRequest
    })

    expect(plan.kind).toBe('new')
    if (plan.kind !== 'new') return
    // 关掉只是不推手机：中心照旧留一条，且不排一次注定不发的 push。
    expect(plan.outcome.levels).toContain('center')
    expect(plan.outcome.levels).not.toContain('channel')
    expect(plan.record.delivery.push).toBeUndefined()
  })

  it('keeps the phone when the key is explicitly true', () => {
    const plan = planNotificationSubmit({
      ...base,
      settings: { ...base.settings, channelEvents: { 'platform.ready': true } },
      request: readyRequest
    })

    expect(plan.kind).toBe('new')
    if (plan.kind !== 'new') return
    expect(plan.outcome.levels).toContain('channel')
  })

  // 否决位不是许可位：对没批 channel 的事件写 true，不能把它推上手机。
  it('cannot grant a surface the approval table never gave', () => {
    const plan = planNotificationSubmit({
      ...base,
      settings: { ...base.settings, channelEvents: { 'platform.failed': true } },
      request: request()
    })

    expect(plan.kind).toBe('new')
    if (plan.kind !== 'new') return
    expect(plan.outcome.levels).not.toContain('channel')
    expect(plan.record.delivery.push).toBeUndefined()
  })
})

describe('免打扰时段只进中心（验收 S6 / 测试单第 18 条）', () => {
  // 窗口 22:00–08:00（读者时区 UTC）；`platform.ready` 批准 center + channel。
  const quiet = {
    ...base.settings,
    quietHours: { enabled: true, startLocalTime: '22:00', endLocalTime: '08:00' }
  }
  const channelRequest = request({
    eventTypeId: 'platform.ready',
    dedupeVars: { builder: 'template', vars: { date: '2026-11-03' } },
    actions: []
  })

  it('drops the phone inside the window and keeps the centre record', () => {
    const plan = planNotificationSubmit({
      ...base,
      settings: quiet,
      now: '2026-11-03T23:30:00.000Z',
      request: channelRequest
    })
    expect(plan.kind).toBe('new')
    if (plan.kind !== 'new') return
    // 手机这一档在窗口内根本不排：夜里推一条到读者身上，和弹一下没有区别。
    expect(plan.outcome.levels).not.toContain('channel')
    expect(plan.outcome.levels).toContain('center')
    expect(plan.record.delivery.push).toBeUndefined()
  })

  it('keeps the phone outside the window', () => {
    const plan = planNotificationSubmit({
      ...base,
      settings: quiet,
      now: '2026-11-03T12:30:00.000Z',
      request: channelRequest
    })
    expect(plan.kind).toBe('new')
    if (plan.kind !== 'new') return
    expect(plan.outcome.levels).toContain('channel')
  })

  it('does not silence anything when the zone cannot be read', () => {
    // S6 原话：时区判断不出来时不静音。`unknown` 不许折成 `inside`，也不许折成「不在」——
    // 它是「不知道」，而「不知道」的默认动作是照常投递。
    const plan = planNotificationSubmit({
      ...base,
      settings: quiet,
      now: '2026-11-03T23:30:00.000Z',
      timeZone: 'Mars/Olympus_Mons',
      request: channelRequest
    })
    expect(plan.kind).toBe('new')
    if (plan.kind !== 'new') return
    expect(plan.outcome.levels).toContain('channel')
  })

  it('behaves the same when quiet hours are switched off', () => {
    const plan = planNotificationSubmit({
      ...base,
      now: '2026-11-03T23:30:00.000Z',
      request: channelRequest
    })
    expect(plan.kind).toBe('new')
    if (plan.kind !== 'new') return
    expect(plan.outcome.levels).toContain('channel')
  })
})

describe('动作标签：归属与存在性（契约 v2.58）', () => {
  const productAction = (overrides: Record<string, unknown> = {}) => ({
    id: 'open-target',
    labelRef: {
      scope: 'product' as const,
      productId: 'sample-product',
      key: 'notification.action.sample-product.open-target'
    },
    kind: 'open' as const,
    ...overrides
  })

  it('rejects a label that belongs to another product — two names would end up on one button', () => {
    // 事件属于 `platform`，动作却引用某个产品的键：解析得出来就是把别人的句子
    // 贴到这条通知的按钮上，解析不出来就是个没名字的按钮。两种都不许落库。
    const plan = planNotificationSubmit({ ...base, request: request({ actions: [productAction()] }) })
    expect(plan).toMatchObject({ kind: 'rejected', outcome: { reason: 'action-label-wrong-scope' } })
  })

  it('accepts the same reference when the event belongs to that product', () => {
    const plan = planNotificationSubmit({
      ...base,
      request: request({
        eventTypeId: 'other-product.thing',
        dedupeVars: { builder: 'template', vars: { id: '2' } },
        actions: [productAction({ labelRef: { scope: 'product', productId: 'other-product', key: 'notification.action.other-product.open-target' } })]
      })
    })
    expect(plan.kind).toBe('new')
  })

  it('rejects an action carrying no label at all — an unnamed button is not a button', () => {
    const plan = planNotificationSubmit({
      ...base,
      request: request({ actions: [{ id: 'open', kind: 'open' }] })
    })
    expect(plan).toMatchObject({ kind: 'rejected', outcome: { reason: 'action-label-missing' } })
  })

  it('still accepts the platform key, because records written before v2.58 carry it', () => {
    const plan = planNotificationSubmit({
      ...base,
      request: request({ actions: [{ id: 'open', labelKey: 'notification.action.open-settings', kind: 'open' }] })
    })
    expect(plan.kind).toBe('new')
  })
})
