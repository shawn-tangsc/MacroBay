import { describe, expect, it } from 'vitest'

import { createDefaultNotificationRuntimeSettings } from '../contracts/notificationContracts'
import { createNotificationEventCatalog, type NotificationEventDeclaration } from '../contracts/notificationEventCatalog'
import { createDefaultNotificationStoreState } from '../store/notificationStore'
import { createNotificationRuntime, type NotificationStorage } from './notificationRuntime'

/**
 * 事件级「不进中心」（方案 §5，P2 判据 1–3）与**收窄路径上的同一道守卫**。
 *
 * 这里用**合成声明**，不 import 任何产品代码（平台层不许知道产品）：形状照搬现在那两条真实事件——
 * 一条「提醒类、不要读者动手、一次发生」的事件批准成只发桌面（因此可以不写中心），
 * 一条「完成类」的事件批准成 center + 手机（必须留在中心）。真实批准表由产品侧那份用例钉住。
 *
 * 判据：省略 center 的事件仍然落**一条**记录（审计与去重靠它），但不进中心列表、不计未读；
 * 含 center 的事件与今天逐字一致；老记录没有 `appliedLevels`——它们是 center 必达时代写的，照旧进中心。
 */
const NOW = '2026-11-18T09:00:00.000Z'

const desktopOnly: NotificationEventDeclaration = {
  id: 'platform.probe.desktop-only',
  titleKey: 'notification.test.title',
  bodyKey: 'notification.test.body',
  reasonKey: 'notification.test.reason',
  requiresUserAction: false,
  category: 'reminder',
  requestedDisruptionLevels: ['desktop'],
  dedupeKeyTemplate: 'desktop-only:{itemId}',
  dedupeUnit: 'occurrence'
}

const centreAndChannel: NotificationEventDeclaration = {
  id: 'platform.probe.centre',
  titleKey: 'notification.test.title',
  bodyKey: 'notification.test.body',
  reasonKey: 'notification.test.reason',
  requiresUserAction: false,
  category: 'completed',
  requestedDisruptionLevels: ['channel'],
  dedupeKeyTemplate: 'centre:{triggerKey}:{cutoff}',
  dedupeUnit: 'occurrence'
}

const centreOnlyFailure: NotificationEventDeclaration = {
  id: 'platform.probe.failure',
  titleKey: 'notification.test.title',
  bodyKey: 'notification.test.body',
  reasonKey: 'notification.test.reason',
  requiresUserAction: true,
  category: 'failure',
  requestedDisruptionLevels: [],
  dedupeKeyTemplate: 'failure:{identity}',
  dedupeUnit: 'occurrence'
}

const catalog = createNotificationEventCatalog({
  sources: [{
    productId: 'platform',
    events: [desktopOnly, centreAndChannel, centreOnlyFailure],
    approval: {
      'platform.probe.desktop-only': { approvedDisruptionLevels: ['desktop'], approvedBypassQuietHours: false },
      'platform.probe.centre': { approvedDisruptionLevels: ['center', 'channel'], approvedBypassQuietHours: false },
      'platform.probe.failure': { approvedDisruptionLevels: ['center'], approvedBypassQuietHours: false }
    }
  }]
})

function harness(seed?: ReturnType<typeof createDefaultNotificationStoreState>) {
  let state = seed ?? createDefaultNotificationStoreState()
  const storage: NotificationStorage = {
    read: async () => JSON.parse(JSON.stringify(state)),
    write: async (next) => { state = JSON.parse(JSON.stringify(next)) as typeof state }
  }
  const runtime = createNotificationRuntime({
    storage,
    catalog,
    diagnostics: () => undefined,
    getSettings: async () => ({ ...createDefaultNotificationRuntimeSettings(), desktopEnabled: true }),
    desktopSupported: () => true,
    clock: { now: () => new Date(NOW), timeZone: () => 'Asia/Shanghai' },
    getLanguage: async () => 'zh-CN',
    productIds: [],
    deliveryHooks: { desktop: async () => ({ ok: true }) }
  })
  return { runtime, state: () => state }
}

describe('an event approved without center', () => {
  it('still writes its record and notifies the desktop, but never appears in the centre', async () => {
    const { runtime, state } = harness()
    const outcome = await runtime.submit({
      eventTypeId: 'platform.probe.desktop-only',
      actions: [],
      dedupeVars: { builder: 'template', vars: { itemId: 'item-1' } },
      occurredAt: NOW
    })

    expect(outcome.kind).toBe('accepted')
    const records = state().records
    // 记录只有一条，而且**照旧落库**（审计与去重都靠它）；只是不进中心。
    expect(records).toHaveLength(1)
    expect(records[0]?.appliedLevels).toEqual(['desktop'])
    expect(records[0]?.channels).toEqual(['desktop'])
    // 桌面那一档真的排了（钩子同步受理，所以这里是终态；关键是有这一档、没有 center）。
    expect(records[0]?.delivery.desktop).toBeDefined()
    expect(records[0]?.channels).not.toContain('center')
    // 中心 0 行、未读 0。
    await expect(runtime.list({ limit: 10 })).resolves.toMatchObject({ items: [] })
    await expect(runtime.getUnreadState()).resolves.toMatchObject({ unread: 0 })
  })
})

describe('a required-center event is unchanged', () => {
  it('still shows in the centre and counts as unread', async () => {
    const { runtime } = harness()
    const outcome = await runtime.submit({
      eventTypeId: 'platform.probe.centre',
      actions: [],
      dedupeVars: { builder: 'template', vars: { triggerKey: 'signal-1', cutoff: '2026-11-18T08:00:00.000Z' } },
      occurredAt: NOW
    })
    expect(outcome.kind).toBe('accepted')
    const page = await runtime.list({ limit: 10 })
    expect(page.items).toHaveLength(1)
    await expect(runtime.getUnreadState()).resolves.toMatchObject({ unread: 1 })
  })
})

/**
 * 收窄路径上的同一道守卫（Chief 2026-11-18 补）。
 *
 * 装配期守卫只挡「批准表本身不写 center」。按次收窄是**另一条能产生投递的路**：一条失败/要读者
 * 动手/持续状况的事件，只要提交时传一个不含 center 的收窄，就能让它在中心消失——而这正是守卫
 * 要防的事。判据必须复用目录那一份 `allowsCenterOmission`，两处各写一套迟早漂移。
 */
describe('a centre-omission rule also holds on the narrowing path', () => {
  it('refuses to narrow a required-centre event down to a set without the centre', async () => {
    const { runtime, state } = harness()
    // `platform.probe.centre` 批 `['center','channel']`、completed、要留在中心：收窄到 channel
    // 只丢掉 center 一档，**正好是收窄能绕过装配期守卫的那条路**。
    const outcome = await runtime.submit({
      eventTypeId: 'platform.probe.centre',
      actions: [],
      dedupeVars: { builder: 'template', vars: { triggerKey: 'signal-1', cutoff: '2026-11-18T08:00:00.000Z' } },
      narrowedDisruptionLevels: ['channel'],
      occurredAt: NOW
    })

    expect(outcome).toMatchObject({ kind: 'rejected', reason: 'surface-not-approved' })
    // 拒收理由点名事件 id：不然「这条为什么没到」只能靠猜。
    expect(outcome.kind === 'rejected' && outcome.message).toContain('platform.probe.centre')
    // 一条投递都不产生：记录 0 条，中心也没有。
    expect(state().records).toHaveLength(0)
    await expect(runtime.list({ limit: 10 })).resolves.toMatchObject({ items: [] })
  })

  it('refuses the same bypass on a failure event that must stay in the centre', async () => {
    const { runtime, state } = harness()
    // `platform.probe.failure` 只批 `['center']`：`['desktop']` 先被「收窄不能变出」那一条挡住；
    // 这里断的是**结果**——拒收、零投递。若以后批准表给它加上 desktop，接住它的就是上面那道新守卫。
    const outcome = await runtime.submit({
      eventTypeId: 'platform.probe.failure',
      actions: [{ id: 'retry', kind: 'open', labelKey: 'notification.test.title' }],
      dedupeVars: { builder: 'template', vars: { identity: 'manual:2026-11-18T08:00:00.000Z' } },
      narrowedDisruptionLevels: ['desktop'],
      occurredAt: NOW
    })

    expect(outcome).toMatchObject({ kind: 'rejected', reason: 'surface-not-approved' })
    expect(state().records).toHaveLength(0)
  })

  it('lets an event that never writes the centre be narrowed to desktop', async () => {
    const { runtime, state } = harness()
    const outcome = await runtime.submit({
      eventTypeId: 'platform.probe.desktop-only',
      actions: [],
      dedupeVars: { builder: 'template', vars: { itemId: 'item-1' } },
      narrowedDisruptionLevels: ['desktop'],
      occurredAt: NOW
    })

    expect(outcome.kind).toBe('accepted')
    expect(state().records).toHaveLength(1)
    expect(state().records[0]?.appliedLevels).toEqual(['desktop'])
  })
})

describe('old records keep their place', () => {
  it('treats a record without appliedLevels as a centre record', async () => {
    const seed = createDefaultNotificationStoreState()
    seed.records.push({
      id: 'notification-legacy-1',
      owner: 'platform',
      sourceId: 'platform.test',
      eventTypeId: 'platform.test',
      delivery: {},
      titleKey: 'notification.test.title' as never,
      severity: 'info',
      priority: 'normal',
      channels: ['center'],
      state: 'unread',
      actions: [],
      occurrenceCount: 1,
      createdAt: NOW,
      updatedAt: NOW
    } as never)
    const { runtime } = harness(seed)
    // 没有 appliedLevels：按含 center 处理，不许从中心凭空消失。
    await expect(runtime.list({ limit: 10 })).resolves.toMatchObject({ items: [expect.objectContaining({ id: 'notification-legacy-1' })] })
    await expect(runtime.getUnreadState()).resolves.toMatchObject({ unread: 1 })
  })
})