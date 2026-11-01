// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'

import { createNotificationCenterSource, NOTIFICATION_BRIDGE_MISSING } from './notificationCenterSource'

/** 桥的形状由 preload 决定；这里只验「渲染层经它读、且读法是约定那一种」。 */
function fakeBridge() {
  return {
    list: vi.fn(async () => ({ items: [], nextCursor: undefined })),
    getUnreadState: vi.fn(async () => ({ unread: 2, version: 5 })),
    markAllRead: vi.fn(async () => ({ unread: 0, version: 6 })),
    deleteRead: vi.fn(async () => ({ deleted: 3 })),
    markRead: vi.fn(async (id: string) => ({ id, state: 'read' })),
    onChanged: vi.fn(() => () => undefined)
  }
}

describe('通知中心唯一的数据入口', () => {
  it('列表查询把排序交给查询层：未读优先 + 上限写在查询里', async () => {
    const bridge = fakeBridge()
    const source = createNotificationCenterSource(bridge as never)

    await source.list()

    // 渲染层不许自己拼两次查询再排：`unreadFirst` 必须进查询参数。
    expect(bridge.list).toHaveBeenCalledWith({ unreadFirst: true, limit: 100 })
  })

  it('未读事实只问 getUnreadState，不从列表自己数', async () => {
    const bridge = fakeBridge()
    const source = createNotificationCenterSource(bridge as never)

    const state = await source.unread()

    expect(state).toEqual({ unread: 2, version: 5 })
    expect(bridge.getUnreadState).toHaveBeenCalledTimes(1)
    expect(bridge.list).not.toHaveBeenCalled()
  })

  it('订阅原样转交桥，退订函数也照传', () => {
    const bridge = fakeBridge()
    const source = createNotificationCenterSource(bridge as never)
    const callback = vi.fn()

    const unsubscribe = source.onChanged(callback)

    expect(bridge.onChanged).toHaveBeenCalledWith(callback)
    expect(typeof unsubscribe).toBe('function')
  })
})

describe('桥缺失时', () => {
  it('读操作如实失败，订阅退化成空——不假装「没有通知」，也不把外壳拖崩', async () => {
    const source = createNotificationCenterSource(null)

    // 失败，而不是返回空列表：抽屉会据错误的这半给「拿不到」的错误态。
    await expect(source.list()).rejects.toThrow(NOTIFICATION_BRIDGE_MISSING)
    await expect(source.unread()).rejects.toThrow(NOTIFICATION_BRIDGE_MISSING)
    // 订阅这一手必须不抛：它是同步的，抛一次就让整个 AppShell 挂载失败。
    const unsubscribe = source.onChanged(() => undefined)
    expect(typeof unsubscribe).toBe('function')
  })
})
