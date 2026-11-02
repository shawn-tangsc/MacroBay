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
  policy: {
    'platform.test': { approvedDisruptionLevels: ['center', 'desktop', 'channel'], approvedBypassQuietHours: false }
  },
  sources: [
    {
      productId: 'platform',
      events: [
        {
          id: 'platform.test',
          titleKey: 'notification.taskFailed.title',
          bodyKey: 'notification.taskFailed.body',
          reasonKey: 'notification.taskFailed.body',
          requiresUserAction: false,
          requestedDisruptionLevels: ['desktop', 'channel'],
          dedupeKeyTemplate: 'test:{id}',
          dedupeUnit: 'condition',
          conditionWindowMs: 86_400_000,
          notifyOnlyIfSubscribed: false
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
    actions: [],
    occurredAt: '2026-11-01T12:00:00.000Z',
    ...overrides
  }
}

function createRuntime(overrides: {
  onChanged?: (change: { version: number }) => void
  subscriptions?: Record<string, { desktop?: boolean; channel?: boolean; record?: boolean }>
} = {}) {
  const state = createDefaultNotificationStoreState()
  state.subscriptions = overrides.subscriptions ?? {}
  return createNotificationRuntime({
    storage: {
      read: async () => JSON.parse(JSON.stringify(state)),
      write: async (next) => { Object.assign(state, next) }
    },
    catalog,
    getSettings: async () => runtimeSettings(),
    clock,
    ...(overrides.onChanged === undefined ? {} : { onChanged: overrides.onChanged })
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
  it('adds the center channel to any notification that uses a disruptive channel', async () => {
    const runtime = createRuntime({ subscriptions: { 'platform.test': { desktop: true } } })
    const outcome = await runtime.submit(request('desktop-only'))
    expect(outcome.kind).toBe('accepted')
    if (outcome.kind !== 'accepted') return
    const record = await recordById(runtime, outcome.recordId)
    expect(outcome.levels).toContain('center')
    expect(record.channels).toContain('center')
    expect(record.channels).toContain('desktop')
  })

  it('leaves a center-only notification untouched', async () => {
    const runtime = createRuntime()
    const outcome = await runtime.submit(request('center-only'))
    expect(outcome.kind).toBe('accepted')
    if (outcome.kind !== 'accepted') return
    const record = await recordById(runtime, outcome.recordId)
    expect(outcome.levels).toEqual(['center'])
    expect(record.channels).toEqual(['center'])
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

    expect(changes).toEqual([1, 2])
    expect((await runtime.getUnreadState()).version).toBe(2)
  })

  it('reports the unread count together with the version, in one call', async () => {
    const runtime = createRuntime()
    const outcome = await runtime.submit(request('unread'))
    expect(await runtime.getUnreadState()).toEqual({ unread: 1, version: 1 })
    if (outcome.kind === 'accepted') await runtime.markRead(outcome.recordId)
    expect(await runtime.getUnreadState()).toEqual({ unread: 0, version: 2 })
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
    // 一次落盘只广播一次，不是逐条 markRead。
    expect(changes).toHaveLength(4)
    expect(changes.at(-1)).toBe(afterClear.version)
  })

  it('is idempotent: clearing with nothing unread succeeds and does not bump the version', async () => {
    const changes: number[] = []
    const runtime = createRuntime({ onChanged: (change) => changes.push(change.version) })
    const outcome = await runtime.submit(request('idem'))
    if (outcome.kind === 'accepted') await runtime.markRead(outcome.recordId)
    const before = await runtime.getUnreadState()

    await expect(runtime.markAllRead()).resolves.toEqual({ unread: 0, version: before.version })
    expect(changes).toHaveLength(2)
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
    expect(record.titleKey).toBe('notification.taskFailed.title')
  })
})
