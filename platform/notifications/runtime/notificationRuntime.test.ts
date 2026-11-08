import { describe, expect, it } from 'vitest'

import {
  createDefaultNotificationRuntimeSettings,
  type NotificationRequest,
  type NotificationRuntimeSettings,
  type NotificationSubmitRequest
} from '../contracts/notificationContracts'
import { createNotificationEventCatalog } from '../contracts/notificationEventCatalog'
import { createDefaultNotificationStoreState } from '../store/notificationStore'
import { createNotificationRuntime, type NotificationRuntime } from './notificationRuntime'

const clock = { now: () => new Date('2026-11-01T12:00:00.000Z'), timeZone: () => 'UTC' }

const catalog = createNotificationEventCatalog({
  // 批准值随声明走（b2）：值原样。
  sources: [
    {
      productId: 'platform',
      approval: {
        'platform.test': { approvedDisruptionLevels: ['center', 'desktop', 'channel'], approvedBypassQuietHours: false },
        // 本机两个开关各要一条「它真的能出来」的事件：`platform.test` 只批桌面与手机，
        // 拨到提示档永远出不来，拿它测 toast 会把「没批」误当成「开关生效」。
        'platform.local': { approvedDisruptionLevels: ['center', 'toast', 'desktop'], approvedBypassQuietHours: false }
      },
      events: [
        {
          id: 'platform.test',
          titleKey: 'notification.taskFailed.title',
          bodyKey: 'notification.taskFailed.body',
          reasonKey: 'notification.taskFailed.body',
          requiresUserAction: false,
    category: 'reminder',
          requestedDisruptionLevels: ['desktop', 'channel'],
          dedupeKeyTemplate: 'test:{id}',
          dedupeUnit: 'condition',
          conditionWindowMs: 86_400_000,
        },
        {
          id: 'platform.local',
          titleKey: 'notification.taskFailed.title',
          bodyKey: 'notification.taskFailed.body',
          reasonKey: 'notification.taskFailed.body',
          requiresUserAction: false,
    category: 'reminder',
          requestedDisruptionLevels: ['toast', 'desktop'],
          dedupeKeyTemplate: 'local:{id}',
          dedupeUnit: 'occurrence',
        }
      ]
    }
  ]
})

function runtimeSettings(overrides: Partial<NotificationRuntimeSettings> = {}): NotificationRuntimeSettings {
  return { ...createDefaultNotificationRuntimeSettings(), ...overrides }
}

function request(id: string, overrides: Partial<NotificationSubmitRequest> = {}): NotificationSubmitRequest {
  return {
    eventTypeId: 'platform.test',
    dedupeVars: { builder: 'template', vars: { id } },
    // 生产者提交时一定带参数：标题模板里有 `{taskName}`，缺了它整条会降级成兜底句（N24①）。
    titleParams: { taskName: id },
    actions: [],
    occurredAt: '2026-11-01T12:00:00.000Z',
    ...overrides
  }
}

function createRuntime(overrides: {
  onChanged?: (change: { version: number }) => void
  /** 读者偏好：现在只剩两个本机开关与三条频道事件表，没有逐事件订阅。 */
  settings?: Partial<NotificationRuntimeSettings>
  /**
   * 投递钩子。**不接钩子的表面会被记成 `skipped`，记录里那一项随即被删掉**——
   * 所以「该投的投了」这类断言必须接上钩子，否则测到的是「没接钩子」，不是「开关生效」。
   */
  deliveryHooks?: { toast?: () => void; desktop?: () => Promise<{ ok: boolean }> }
} = {}) {
  const state = createDefaultNotificationStoreState()
  return createNotificationRuntime({
    resolvePushChannel: resolvePushChannelFromSettings,
    diagnostics: () => undefined,
    storage: {
      read: async () => JSON.parse(JSON.stringify(state)),
      write: async (next) => { Object.assign(state, next) }
    },
    catalog,
    getSettings: async () => runtimeSettings(overrides.settings),
    clock,
    ...(overrides.onChanged === undefined ? {} : { onChanged: overrides.onChanged }),
    ...(overrides.deliveryHooks === undefined ? {} : { deliveryHooks: overrides.deliveryHooks })
  })
}

async function recordById(runtime: NotificationRuntime, id: string) {
  const page = await runtime.list({ limit: 200 })
  return page.items.find((item) => item.id === id)!
}

/** 自检通知仍走旧形状；它只测链路，不经过目录。 */
function selfTestRequest(index: number): NotificationRequest {
  return {
    owner: 'platform',
    sourceId: 'platform.test',
    titleKey: 'notification.taskFailed.title',
    titleParams: { taskName: 'test' },
    severity: 'info',
    priority: 'normal',
    requestedChannels: ['center'],
    dedupeKey: `test-${index}`
  }
}

/** 这些夹具没有可用通道：派生入口按「一条都没有」处理（fail closed，不再读 `push.channelId`）。 */
async function resolvePushChannelFromSettings() {
  return { ok: false as const, reason: 'push-unavailable' as const, enabledChannelCount: 0, multiple: false, states: {} }
}

describe('notification list ordering and cursors', () => {
  it('T4: unreadFirst puts unread above read and keeps time order inside each group', async () => {
    const runtime = createRuntime()
    const first = await runtime.submit(request('one'))
    await runtime.submit(request('two'))
    const third = await runtime.submit(request('three'))
    expect(first.kind).toBe('accepted')
    if (first.kind !== 'accepted' || third.kind !== 'accepted') return
    await runtime.markRead(first.recordId)

    const page = await runtime.list({ unreadFirst: true })
    expect(page.items[0]?.id).not.toBe(first.recordId)
    expect(page.items.at(-1)?.id).toBe(first.recordId)
    expect(page.items.map((item) => item.id)).toContain(third.recordId)

    const plain = await runtime.list()
    // 不加 unreadFirst 时按时间倒序，刚标读的那条仍按时间排在最后。
    expect(plain.items.map((item) => item.id)).toEqual([third.recordId, page.items[1]?.id, first.recordId])
  })

  it('T5: a record arriving mid-pagination neither repeats nor skips the previous page', async () => {
    const runtime = createRuntime()
    const seeded = []
    for (let index = 0; index < 5; index += 1) {
      seeded.push(await runtime.submit(request(`n${index}`)))
    }

    const page1 = await runtime.list({ limit: 2 })
    expect(page1.items).toHaveLength(2)
    expect(page1.nextCursor).toBeTypeOf('string')

    // 翻页途中来了新通知：下标游标会让第 2 页重复第 1 页末条，键游标不会。
    await runtime.submit(request('late'))
    const page2 = await runtime.list({ limit: 2, cursor: page1.nextCursor })

    const page1Ids = page1.items.map((item) => item.id)
    const page2Ids = page2.items.map((item) => item.id)
    expect(page2Ids.some((id) => page1Ids.includes(id))).toBe(false)
    expect(new Set([...page1Ids, ...page2Ids]).size).toBe(4)
    expect(seeded).toHaveLength(5)
  })

  it('keeps both records when two notifications share the same millisecond', async () => {
    const runtime = createRuntime()
    const a = await runtime.submit(request('x'))
    const b = await runtime.submit(request('y'))
    expect(a.kind).toBe('accepted')
    expect(b.kind).toBe('accepted')
    if (a.kind !== 'accepted' || b.kind !== 'accepted') return

    const page1 = await runtime.list({ limit: 1 })
    const page2 = await runtime.list({ limit: 1, cursor: page1.nextCursor })
    expect([page1.items[0]?.id, page2.items[0]?.id].sort()).toEqual([a.recordId, b.recordId].sort())
  })
})

describe('notification center guarantee (4a)', () => {
  // 两个方向各说清「谁必须在、谁必须不在」。
  // 旧写法是 `toast === undefined || desktop === undefined`——两个都关时它也绿，
  // 于是「开关生效」和「方向搞反」两种错都抓不住：那不是断言，是占位。
  it('sends the desktop and not the toast when only the desktop switch is on', async () => {
    const runtime = createRuntime({
      settings: { desktopEnabled: true, toastEnabled: false },
      deliveryHooks: { desktop: async () => ({ ok: true }) }
    })
    const outcome = await runtime.submit(request('desktop-only'))
    expect(outcome.kind).toBe('accepted')
    if (outcome.kind !== 'accepted') return
    const record = await recordById(runtime, outcome.recordId)
    expect(outcome.levels).toContain('center')
    expect(record.channels).toContain('center')
    expect(record.delivery.desktop).toBeDefined()
    expect(record.delivery.toast).toBeUndefined()
  })

  it('sends the toast and not the desktop when only the toast switch is on', async () => {
    const runtime = createRuntime({
      settings: { desktopEnabled: false, toastEnabled: true },
      deliveryHooks: { toast: () => undefined }
    })
    const outcome = await runtime.submit(
      request('toast-only', {
        eventTypeId: 'platform.local',
        dedupeVars: { builder: 'template', vars: { id: 'toast-only' } }
      })
    )
    expect(outcome.kind).toBe('accepted')
    if (outcome.kind !== 'accepted') return
    const record = await recordById(runtime, outcome.recordId)
    expect(outcome.levels).toContain('toast')
    expect(outcome.levels).not.toContain('desktop')
    expect(record.delivery.toast).toBeDefined()
    expect(record.delivery.desktop).toBeUndefined()
  })

  it('leaves the center surface untouched when both local switches are off', async () => {
    const runtime = createRuntime()
    const outcome = await runtime.submit(request('center-only'))
    expect(outcome.kind).toBe('accepted')
    if (outcome.kind !== 'accepted') return
    const record = await recordById(runtime, outcome.recordId)
    expect(outcome.levels).toContain('center')
    // 两个开关都关：没有任何本机打扰，只有中心那份记录。
    expect(record.delivery.desktop).toBeUndefined()
    expect(record.delivery.toast).toBeUndefined()
  })
})

describe('change version', () => {
  it('increments the version on submit and on every state change', async () => {
    const changes: number[] = []
    const runtime = createRuntime({ onChanged: (change) => changes.push(change.version) })
    const outcome = await runtime.submit(request('version'))
    expect(outcome.kind).toBe('accepted')
    if (outcome.kind !== 'accepted') return
    await runtime.markRead(outcome.recordId)

    // 递交 + 标读各至少一次；投递状态回写若发生也算一次变更（版本只增、不跳号）。
    expect(changes.length).toBeGreaterThanOrEqual(2)
    expect([...changes].sort((a, b) => a - b)).toEqual(changes)
    expect(new Set(changes).size).toBe(changes.length)
    expect((await runtime.getUnreadState()).version).toBe(changes.at(-1))
  })

  it('reports the unread count together with the version, in one call', async () => {
    const runtime = createRuntime()
    const outcome = await runtime.submit(request('unread'))
    const before = await runtime.getUnreadState()
    expect(before.unread).toBe(1)
    expect(before.version).toBeGreaterThanOrEqual(1)
    if (outcome.kind === 'accepted') await runtime.markRead(outcome.recordId)
    const after = await runtime.getUnreadState()
    expect(after.unread).toBe(0)
    expect(after.version).toBeGreaterThan(before.version)
  })
})

describe('desktop permission', () => {
  it('answers unknown when nothing can read the real authorization state', async () => {
    const runtime = createRuntime()
    expect(await runtime.readDesktopPermission()).toBe('unknown')
  })
})

describe('mark all read (clear)', () => {
  it('marks every unread record in one commit and returns the new badge state', async () => {
    const changes: number[] = []
    const runtime = createRuntime({ onChanged: (change) => changes.push(change.version) })
    for (let index = 0; index < 3; index += 1) {
      await runtime.submit(request(`bulk-${index}`))
    }
    expect((await runtime.getUnreadState()).unread).toBe(3)

    const afterClear = await runtime.markAllRead()
    expect(afterClear.unread).toBe(0)
    // 版本继续递增：清空本身也是一次变更，订阅方据此重取。
    expect(afterClear.version).toBeGreaterThan(3)
    expect((await runtime.list()).items.every((item) => item.state !== 'unread')).toBe(true)
    // 清空只落盘、只广播一次：最后那条变更就是清空本身（此前每条递交可能带一次投递回写）。
    expect(changes.at(-1)).toBe(afterClear.version)
    expect(new Set(changes).size).toBe(changes.length)
  })

  it('is idempotent: clearing with nothing unread succeeds and does not bump the version', async () => {
    const changes: number[] = []
    const runtime = createRuntime({ onChanged: (change) => changes.push(change.version) })
    const outcome = await runtime.submit(request('idem'))
    if (outcome.kind === 'accepted') await runtime.markRead(outcome.recordId)
    const before = await runtime.getUnreadState()

    // 没有未读可清：不改状态、不再广播一次（版本保持）。
    await expect(runtime.markAllRead()).resolves.toEqual({ unread: 0, version: before.version })
    expect(changes.at(-1)).toBe(before.version)
  })
})

describe('the breaker bypass is not reachable through submit()', () => {
  it('rejects a bypass parameter at compile time', () => {
    // @ts-expect-error 绕过熔断的参数不在公开契约上：绕过口只开在 submitSelfTest 上。
    const typed = (runtime: NotificationRuntime) => runtime.submit({ ...request('bypass'), skipDailyCap: true })
    expect(typeof typed).toBe('function')
  })
})

describe('test notifications do not spend the daily cap', () => {
  it('leaves the real source room after many test clicks', async () => {
    const runtime = createRuntime()
    // 60 次手动自检：带 skipDailyCap，不进熔断计数。
    for (let index = 0; index < 60; index += 1) {
      await runtime.submitSelfTest(selfTestRequest(index))
    }
    // 真实提交仍然是「原文落库」，没有被折叠成「今日另有 N 条」。
    const outcome = await runtime.submit(request('real'))
    expect(outcome.kind).toBe('accepted')
    if (outcome.kind !== 'accepted') return
    const record = await recordById(runtime, outcome.recordId)
    expect(record.collapsedCount).toBeUndefined()
    // 读出来的是句子不是键：键留主进程（落地约束 v1.2 §1）。
    expect(record.title).toBe('任务失败：real')
  })
})

const catalogWithBlocked = createNotificationEventCatalog({
  // 批准值随声明走（b2）：值原样。
  sources: [
    {
      productId: 'platform',
      approval: {
        'platform.test': { approvedDisruptionLevels: ['center', 'desktop', 'channel'], approvedBypassQuietHours: false },
        'platform.desktop.blocked': { approvedDisruptionLevels: ['center', 'toast'], approvedBypassQuietHours: false }
      },
      events: [
        {
          id: 'platform.test',
          titleKey: 'notification.taskFailed.title',
          bodyKey: 'notification.taskFailed.body',
          reasonKey: 'notification.taskFailed.body',
          requiresUserAction: false,
    category: 'reminder',
          requestedDisruptionLevels: ['desktop', 'channel'],
          dedupeKeyTemplate: 'test:{id}',
          dedupeUnit: 'condition',
          conditionWindowMs: 86_400_000
        },
        {
          id: 'platform.desktop.blocked',
          titleKey: 'notification.event.platform.desktop.blocked.title',
          bodyKey: 'notification.event.platform.desktop.blocked.body',
          reasonKey: 'notification.event.platform.desktop.blocked.reason',
          requiresUserAction: false,
    category: 'reminder',
          requestedDisruptionLevels: [],
          dedupeKeyTemplate: 'desktop-blocked:{recordId}',
          dedupeUnit: 'occurrence'
        }
      ]
    }
  ]
})

describe('P7: the desktop blocked event has a producer', () => {
  it('submits platform.desktop.blocked when show() fails, and records it in the center', async () => {
    const state = createDefaultNotificationStoreState()
    const runtime = createNotificationRuntime({
      resolvePushChannel: resolvePushChannelFromSettings,
      diagnostics: () => undefined,
      storage: {
        read: async () => JSON.parse(JSON.stringify(state)),
        write: async (next) => { Object.assign(state, next) }
      },
      catalog: catalogWithBlocked,
      getSettings: async () => runtimeSettings({ desktopEnabled: true }),
      clock,
      deliveryHooks: {
        desktop: async () => ({ ok: false, reason: 'blocked-by-system' })
      }
    })

    await runtime.submit(request('desktop-blocked'))

    const page = await runtime.list({ limit: 50 })
    const blocked = page.items.find((item) => item.eventTypeId === 'platform.desktop.blocked')
    expect(blocked).toBeDefined()
    // 它自己只批了中心与提示：不会再产生一次桌面投递，不会自激。
    expect(blocked?.delivery.desktop).toBeUndefined()
  })

  it('does not submit it when the desktop switch is simply off', async () => {
    const state = createDefaultNotificationStoreState()
    const runtime = createNotificationRuntime({
      resolvePushChannel: resolvePushChannelFromSettings,
      diagnostics: () => undefined,
      storage: {
        read: async () => JSON.parse(JSON.stringify(state)),
        write: async (next) => { Object.assign(state, next) }
      },
      catalog: catalogWithBlocked,
      getSettings: async () => runtimeSettings({ desktopEnabled: false }),
      clock,
      deliveryHooks: { desktop: async () => ({ ok: false, reason: 'blocked-by-system' }) }
    })

    await runtime.submit(request('desktop-off'))

    const page = await runtime.list({ limit: 50 })
    // 开关关着是读者的选择，不是「被系统拦下」——不许误报。
    expect(page.items.some((item) => item.eventTypeId === 'platform.desktop.blocked')).toBe(false)
  })
})
