import { describe, expect, it } from 'vitest'

import { createDefaultNotificationRuntimeSettings, type NotificationRequest } from '../contracts/notificationContracts'
import { createDefaultNotificationStoreState } from '../store/notificationStore'
import { createNotificationRuntime } from './notificationRuntime'

const clock = { now: () => new Date('2026-11-01T12:00:00.000Z'), timeZone: () => 'UTC' }

function request(overrides: Partial<NotificationRequest> = {}): NotificationRequest {
  return {
    owner: 'platform',
    sourceId: 'job-runtime',
    titleKey: 'notification.taskFailed.title',
    titleParams: { taskName: 'Scheduled run failed' },
    severity: 'warning',
    priority: 'normal',
    requestedChannels: ['center'],
    ...overrides
  }
}

function createRuntime(overrides: { onChanged?: (change: { version: number }) => void } = {}) {
  const state = createDefaultNotificationStoreState()
  return createNotificationRuntime({
    storage: {
      read: async () => JSON.parse(JSON.stringify(state)),
      write: async (next) => { Object.assign(state, next) }
    },
    getSettings: async () => ({ ...createDefaultNotificationRuntimeSettings(), quietHours: undefined }),
    clock,
    ...overrides
  })
}

describe('notification list ordering and cursors', () => {
  it('T4: unreadFirst puts unread above read and keeps time order inside each group', async () => {
    const runtime = createRuntime()
    const first = await runtime.submit(request({ titleKey: 'notification.taskFailed.title', titleParams: { taskName: 'one' }, sourceId: 'a' }))
    await runtime.submit(request({ titleKey: 'notification.taskFailed.title', titleParams: { taskName: 'two' }, sourceId: 'b' }))
    const third = await runtime.submit(request({ titleKey: 'notification.taskFailed.title', titleParams: { taskName: 'three' }, sourceId: 'c' }))
    await runtime.markRead(first.id)

    const page = await runtime.list({ unreadFirst: true })
    expect(page.items[0]?.id).not.toBe(first.id)
    expect(page.items.at(-1)?.id).toBe(first.id)
    expect(page.items.map((item) => item.id)).toContain(third.id)

    const plain = await runtime.list()
    // 不加 unreadFirst 时按时间倒序，刚标读的那条仍按时间排在最后。
    expect(plain.items.map((item) => item.id)).toEqual([third.id, page.items[1]?.id, first.id])
  })

  it('T5: a record arriving mid-pagination neither repeats nor skips the previous page', async () => {
    const runtime = createRuntime()
    const seeded = []
    for (let index = 0; index < 5; index += 1) {
      seeded.push(await runtime.submit(request({ titleKey: 'notification.taskFailed.title', titleParams: { taskName: `n${index}` }, sourceId: `source-${index}` })))
    }

    const page1 = await runtime.list({ limit: 2 })
    expect(page1.items).toHaveLength(2)
    expect(page1.nextCursor).toBeTypeOf('string')

    // 翻页途中来了新通知：下标游标会让第 2 页重复第 1 页末条，键游标不会。
    await runtime.submit(request({ titleKey: 'notification.taskFailed.title', titleParams: { taskName: 'arrived-late' }, sourceId: 'late' }))
    const page2 = await runtime.list({ limit: 2, cursor: page1.nextCursor })

    const page1Ids = page1.items.map((item) => item.id)
    const page2Ids = page2.items.map((item) => item.id)
    expect(page2Ids.some((id) => page1Ids.includes(id))).toBe(false)
    expect(new Set([...page1Ids, ...page2Ids]).size).toBe(4)
    expect(seeded).toHaveLength(5)
  })

  it('keeps both records when two notifications share the same millisecond', async () => {
    const runtime = createRuntime()
    const a = await runtime.submit(request({ titleKey: 'notification.taskFailed.title', titleParams: { taskName: 'same-instant-a' }, sourceId: 'x' }))
    const b = await runtime.submit(request({ titleKey: 'notification.taskFailed.title', titleParams: { taskName: 'same-instant-b' }, sourceId: 'y' }))

    const page1 = await runtime.list({ limit: 1 })
    const page2 = await runtime.list({ limit: 1, cursor: page1.nextCursor })
    expect([page1.items[0]?.id, page2.items[0]?.id].sort()).toEqual([a.id, b.id].sort())
  })
})

describe('notification center guarantee (4a)', () => {
  it('adds the center channel to any notification that uses a disruptive channel', async () => {
    const runtime = createRuntime()
    const record = await runtime.submit(request({ requestedChannels: ['desktop'], sourceId: 'desktop-only' }))
    expect(record.channels).toContain('center')
  })

  it('leaves a center-only notification untouched', async () => {
    const runtime = createRuntime()
    const record = await runtime.submit(request({ requestedChannels: ['center'], sourceId: 'center-only' }))
    expect(record.channels).toEqual(['center'])
  })
})

describe('change version', () => {
  it('increments the version on submit and on every state change', async () => {
    const changes: number[] = []
    const runtime = createRuntime({ onChanged: (change) => changes.push(change.version) })
    const record = await runtime.submit(request())
    await runtime.markRead(record.id)

    expect(changes).toEqual([1, 2])
    expect((await runtime.getUnreadState()).version).toBe(2)
  })

  it('reports the unread count together with the version, in one call', async () => {
    const runtime = createRuntime()
    const record = await runtime.submit(request())
    expect(await runtime.getUnreadState()).toEqual({ unread: 1, version: 1 })
    await runtime.markRead(record.id)
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
      await runtime.submit(request({ sourceId: `bulk-${index}` }))
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
    const record = await runtime.submit(request())
    await runtime.markRead(record.id)
    const before = await runtime.getUnreadState()

    await expect(runtime.markAllRead()).resolves.toEqual({ unread: 0, version: before.version })
    expect(changes).toHaveLength(2)
  })
})
