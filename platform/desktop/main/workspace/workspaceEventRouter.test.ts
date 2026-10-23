import { describe, expect, it, vi } from 'vitest'

import type { WorkspaceEvent, WorkspaceSnapshot } from '@platform/workspace/contracts'
import { createWorkspaceEventRouter, type WorkspaceEventTarget } from './workspaceEventRouter'

/**
 * Owner: platform/desktop/main/workspace。回归 P1-06a 事件路由：
 * 只接受已授权订阅、内容事件必须定向、layoutRevision 只来自注入 getter、
 * attachHost 顺序（退订旧 → 发 current snapshot → 续增量）、maxTargets 有界、清空回基线、无 timer/listener 泄漏。
 */

function snapshotWith(panels: Array<{ panelInstanceKey: string; workspaceInstanceKey: string; windowInstanceId: string; hostEpoch: number }>): WorkspaceSnapshot {
  return {
    layoutRevision: 41,
    activeWorkspaceInstanceKey: 'workspace-1',
    panels: panels.map((panel) => ({
      ...panel, panelId: 'sample.inspector', open: true, mode: 'docked-right' as const, presentation: 'normal' as const,
      bindingState: 'bound' as const, lastValidDock: 'docked-right' as const
    })),
    pageLayouts: [{ workspaceInstanceKey: 'workspace-1', panelOrder: ['panel-1'], activePanels: { 'docked-right': 'panel-1' } }],
    tabs: [] as readonly [],
    persistenceState: 'saved' as const
  }
}

function createHarness(options: { revision?: number; panels?: Parameters<typeof snapshotWith>[0]; maxTargets?: number } = {}) {
  const send = vi.fn<(windowInstanceId: string, event: WorkspaceEvent) => void>()
  let revision = options.revision ?? 41
  let snapshot = snapshotWith(options.panels ?? [
    { panelInstanceKey: 'panel-1', workspaceInstanceKey: 'workspace-1', windowInstanceId: 'window-main', hostEpoch: 1 },
    { panelInstanceKey: 'panel-2', workspaceInstanceKey: 'workspace-1', windowInstanceId: 'window-detached', hostEpoch: 2 }
  ])
  const router = createWorkspaceEventRouter({
    getLayoutRevision: () => revision,
    getSnapshot: () => ({ ...snapshot, layoutRevision: revision }),
    send,
    maxTargets: options.maxTargets ?? 4
  })
  return {
    router, send,
    setRevision: (next: number) => { revision = next },
    /** 模拟迁移后的快照：同一个 panel 改由新 epoch 承载。 */
    setPanels: (panels: Parameters<typeof snapshotWith>[0]) => { snapshot = snapshotWith(panels) }
  }
}

describe('workspace event router', () => {
  it('broadcasts only non-content events when scope is global and injects the real layoutRevision', () => {
    const { router, send, setRevision } = createHarness()
    router.subscribe({ windowInstanceId: 'window-main', hostEpoch: 1 })
    router.subscribe({ windowInstanceId: 'window-detached', hostEpoch: 2 })

    setRevision(9)
    const persistence = router.publish({ type: 'persistence-state' })
    expect(persistence.delivered).toBe(2)
    expect(persistence.event.layoutRevision).toBe(9)
    expect(persistence.event.scope).toEqual({})

    // 内容事件没有定向 scope ⇒ 不是「授权订阅」，不得投递（也不是自己造方向）
    const unscoped = router.publish({ type: 'container-changed' })
    expect(unscoped.delivered).toBe(0)
    expect(unscoped.event.layoutRevision).toBe(9)
    expect(send).toHaveBeenCalledTimes(2)
    expect(send.mock.calls.every(([, event]) => event.type === 'persistence-state')).toBe(true)
  })

  it('delivers content events only to hosts that own the scoped instance and are authorized subscribers', () => {
    const { router, send } = createHarness()
    router.subscribe({ windowInstanceId: 'window-main', hostEpoch: 1 })
    router.subscribe({ windowInstanceId: 'window-detached', hostEpoch: 2 })

    expect(router.publish({ type: 'container-changed', scope: { panelInstanceKey: 'panel-1' } }).delivered).toBe(1)
    expect(send).toHaveBeenLastCalledWith('window-main', expect.objectContaining({
      type: 'container-changed', layoutRevision: 41, scope: { panelInstanceKey: 'panel-1' }
    }))
    expect(router.publish({ type: 'close', scope: { panelInstanceKey: 'panel-2' } }).delivered).toBe(1)
    expect(send).toHaveBeenLastCalledWith('window-detached', expect.objectContaining({ type: 'close' }))
  })

  it('never lets an explicit subscription bypass ownership or a stale hostEpoch (F2)', () => {
    const { router, send } = createHarness()
    // 完全不承载 workspace-1 任何面板的窗口，即使显式订阅 w1 也不得收到内容事件
    router.subscribe({ windowInstanceId: 'window-b', hostEpoch: 2, scope: { workspaceInstanceKey: 'workspace-1' } })
    expect(router.publish({ type: 'container-changed', scope: { workspaceInstanceKey: 'workspace-1' } }).delivered).toBe(0)
    expect(send).not.toHaveBeenCalled()

    // 当前承载者的陈旧 epoch 同样不得命中（快照里 window-main 是 epoch 1）
    router.subscribe({ windowInstanceId: 'window-main', hostEpoch: 9, scope: { workspaceInstanceKey: 'workspace-1' } })
    expect(router.publish({ type: 'container-changed', scope: { workspaceInstanceKey: 'workspace-1' } }).delivered).toBe(0)
    expect(send).not.toHaveBeenCalled()

    // 当前承载者 + 已订阅 ⇒ 命中
    router.subscribe({ windowInstanceId: 'window-main', hostEpoch: 1, scope: { workspaceInstanceKey: 'workspace-1' } })
    expect(router.publish({ type: 'container-changed', scope: { workspaceInstanceKey: 'workspace-1' } }).delivered).toBe(1)
    expect(send).toHaveBeenLastCalledWith('window-main', expect.objectContaining({ type: 'container-changed' }))

    // 显式订阅只能收窄：承载者改订阅别的 panel 后，本 panel 事件不再投递
    router.subscribe({ windowInstanceId: 'window-main', hostEpoch: 1, scope: { panelInstanceKey: 'panel-2' } })
    expect(router.publish({ type: 'close', scope: { panelInstanceKey: 'panel-1' } }).delivered).toBe(0)
    expect(router.publish({ type: 'close', scope: { panelInstanceKey: 'panel-2' } }).delivered).toBe(0)
  })

  it('moves delivery with the hostEpoch after attachHost and drops the previous epoch', () => {
    const { router, send, setPanels } = createHarness({
      panels: [{ panelInstanceKey: 'panel-1', workspaceInstanceKey: 'workspace-1', windowInstanceId: 'window-detached', hostEpoch: 2 }]
    })
    const attached = router.attachHost({ windowInstanceId: 'window-detached', hostEpoch: 2, scope: { workspaceInstanceKey: 'workspace-1' } })
    expect(attached.subscribed).toBe(true)
    send.mockClear()
    expect(router.publish({ type: 'host-reparent', scope: { workspaceInstanceKey: 'workspace-1' } }).delivered).toBe(1)

    // 迁移后快照由 epoch 3 承载：旧 epoch 立刻失效，新 epoch 重新挂载后才命中
    setPanels([{ panelInstanceKey: 'panel-1', workspaceInstanceKey: 'workspace-1', windowInstanceId: 'window-detached', hostEpoch: 3 }])
    send.mockClear()
    expect(router.publish({ type: 'host-reparent', scope: { workspaceInstanceKey: 'workspace-1' } }).delivered).toBe(0)
    expect(router.attachHost({ windowInstanceId: 'window-detached', hostEpoch: 3, scope: { workspaceInstanceKey: 'workspace-1' } }).subscribed).toBe(true)
    send.mockClear()
    expect(router.publish({ type: 'host-reparent', scope: { workspaceInstanceKey: 'workspace-1' } }).delivered).toBe(1)
  })

  it('drops events whose scope matches no authorized target and never leaks a stale epoch', () => {
    const { router, send } = createHarness()
    router.subscribe({ windowInstanceId: 'window-main', hostEpoch: 1 })
    // 过期 epoch 的订阅者不得再收到内容事件（窗口已被替换）
    router.subscribe({ windowInstanceId: 'window-main', hostEpoch: 99 })

    expect(router.publish({ type: 'restore', scope: { panelInstanceKey: 'panel-1' } }).delivered).toBe(0)
    expect(send).not.toHaveBeenCalled()
    expect(router.publish({ type: 'restore', scope: { workspaceInstanceKey: 'workspace-missing' } }).delivered).toBe(0)
    expect(send).not.toHaveBeenCalled()
  })

  it('subscribes at most maxTargets hosts and rejects unlimited growth', () => {
    const { router } = createHarness({ maxTargets: 2 })
    expect(router.subscribe({ windowInstanceId: 'window-a', hostEpoch: 1 })).toBe(true)
    expect(router.subscribe({ windowInstanceId: 'window-b', hostEpoch: 1 })).toBe(true)
    expect(router.subscribe({ windowInstanceId: 'window-c', hostEpoch: 1 })).toBe(false)
    expect(router.targetCount()).toBe(2)
    // 已订阅窗口的重新订阅不占新额度
    expect(router.subscribe({ windowInstanceId: 'window-a', hostEpoch: 1 })).toBe(true)
    expect(router.targetCount()).toBe(2)
    expect(router.unsubscribe('window-a')).toBe(true)
    expect(router.unsubscribe('window-a')).toBe(false)
    expect(router.targetCount()).toBe(1)
    router.reset()
    expect(router.targetCount()).toBe(0)
  })

  it('attachHost unsubscribes the old listener, sends the current snapshot, then resumes increments', () => {
    const { router, send, setRevision } = createHarness({ maxTargets: 2 })
    router.subscribe({ windowInstanceId: 'window-detached', hostEpoch: 2, scope: { workspaceInstanceKey: 'workspace-1' } })
    const oldTargets = router.targetCount()

    setRevision(12)
    const attached = router.attachHost({ windowInstanceId: 'window-detached', hostEpoch: 2, scope: { workspaceInstanceKey: 'workspace-1' } })
    expect(attached.subscribed).toBe(true)
    expect(attached.snapshotEvent).toEqual({
      type: 'snapshot', layoutRevision: 12, scope: { workspaceInstanceKey: 'workspace-1' }, hostEpoch: 2
    })
    // 第一步就是把 current snapshot 直发新宿主，且不经过增量过滤
    expect(send).toHaveBeenNthCalledWith(1, 'window-detached', attached.snapshotEvent)
    expect(router.targetCount()).toBe(oldTargets)

    // 续增量：attachHost 建立的订阅+归属同时成立才投递
    send.mockClear()
    expect(router.publish({ type: 'host-reparent', scope: { workspaceInstanceKey: 'workspace-1' } }).delivered).toBe(1)
    expect(send).toHaveBeenCalledWith('window-detached', expect.objectContaining({ type: 'host-reparent' }))
  })

  it('keeps attachHost fail-closed at the target limit while still delivering the snapshot', () => {
    const { router, send } = createHarness({ maxTargets: 1 })
    router.subscribe({ windowInstanceId: 'window-main', hostEpoch: 1 })
    const attached = router.attachHost({ windowInstanceId: 'window-new', hostEpoch: 1 })
    expect(attached.subscribed).toBe(false)
    expect(send).toHaveBeenCalledTimes(1)
    expect(router.targetCount()).toBe(1)
  })

  it('returns to baseline after every target unsubscribes and leaves no listener behind', () => {
    const { router, send } = createHarness()
    const targets: WorkspaceEventTarget[] = [
      { windowInstanceId: 'window-main', hostEpoch: 1 },
      { windowInstanceId: 'window-detached', hostEpoch: 2 }
    ]
    for (const target of targets) router.subscribe(target)
    for (const target of targets) router.unsubscribe(target.windowInstanceId)
    send.mockClear()
    expect(router.targetCount()).toBe(0)
    expect(router.publish({ type: 'persistence-state' }).delivered).toBe(0)
    expect(router.publish({ type: 'container-changed', scope: { panelInstanceKey: 'panel-1' } }).delivered).toBe(0)
    expect(send).not.toHaveBeenCalled()
  })

  /**
   * P2-10①：宿主销毁 / 登记回收 / 身份失效时必须**移除对应 target**，否则 `maxTargets` 额度被死宿主永久占用，
   * 同一会话里第 N+1 个真实窗口只会拿到 `subscribed:false` 后静默降级为 IPC 拉取。
   * RED（当前）：`releaseHost`/`capacity` 不存在 ⇒ 释放后 target 仍在、第 N+1 个身份被拒且无任何可见信号。
   */
  it('宿主销毁释放后 target 数回落、maxTargets 额度恢复，且上限拒绝可见（不静默丢失）', () => {
    const { router } = createHarness({ maxTargets: 2 })
    expect(router.subscribe({ windowInstanceId: 'window-a', hostEpoch: 1 })).toBe(true)
    expect(router.subscribe({ windowInstanceId: 'window-b', hostEpoch: 1 })).toBe(true)

    // 上限语义保留：新身份被明确拒绝，且拒绝必须**可见**（计数 + 最后一个被拒身份）
    expect(router.subscribe({ windowInstanceId: 'window-c', hostEpoch: 1 })).toBe(false)
    expect(router.capacity()).toEqual({
      maxTargets: 2, targetCount: 2, available: 0, targets: ['window-a', 'window-b'], rejectedCount: 1,
      lastRejected: { windowInstanceId: 'window-c', reason: 'target-limit' }
    })

    // 宿主销毁 / 登记回收 ⇒ 释放该身份的 target
    expect(router.releaseHost({ windowInstanceId: 'window-a', hostEpoch: 1 }))
      .toEqual({ released: true, windowInstanceId: 'window-a', hostEpoch: 1 })
    expect(router.targetCount()).toBe(1)
    expect(router.capacity()).toMatchObject({ targetCount: 1, available: 1 })

    // 额度恢复 ⇒ 释放后可重新订阅
    expect(router.subscribe({ windowInstanceId: 'window-c', hostEpoch: 1 })).toBe(true)
    expect(router.targetCount()).toBe(2)
  })

  it('身份失效：陈旧 epoch 的释放不得误删同窗口的新订阅；未知/非法身份幂等且不抛', () => {
    const { router } = createHarness({ maxTargets: 2 })
    router.subscribe({ windowInstanceId: 'window-a', hostEpoch: 2 })
    // 旧 epoch（已被新宿主替换）的释放不得误删 epoch 2 的在线订阅
    expect(router.releaseHost({ windowInstanceId: 'window-a', hostEpoch: 1 })).toEqual({ released: false, reason: 'epoch-mismatch' })
    expect(router.targetCount()).toBe(1)
    // 未登记身份 / 非法身份：幂等 no-op，绝不抛
    expect(router.releaseHost({ windowInstanceId: 'window-ghost', hostEpoch: 1 })).toEqual({ released: false, reason: 'unknown' })
    expect(router.releaseHost({ windowInstanceId: '', hostEpoch: 1 })).toEqual({ released: false, reason: 'invalid-identity' })
    expect(router.targetCount()).toBe(1)
    // 登记回收时 epoch 未知也要能释放（不带 hostEpoch = 释放该窗口当前登记的身份）
    expect(router.releaseHost({ windowInstanceId: 'window-a', hostEpoch: 2 }))
      .toEqual({ released: true, windowInstanceId: 'window-a', hostEpoch: 2 })
    expect(router.targetCount()).toBe(0)
    expect(router.subscribe({ windowInstanceId: 'window-a', hostEpoch: 3 })).toBe(true)
    expect(router.releaseHost({ windowInstanceId: 'window-a' })).toEqual({ released: true, windowInstanceId: 'window-a', hostEpoch: 3 })
    expect(router.targetCount()).toBe(0)
  })

  it('隔离：释放一个宿主绝不影响其它宿主的 target', () => {
    const { router, send } = createHarness({ maxTargets: 3 })
    router.subscribe({ windowInstanceId: 'window-main', hostEpoch: 1 })
    router.subscribe({ windowInstanceId: 'window-detached', hostEpoch: 2 })
    expect(router.releaseHost({ windowInstanceId: 'window-detached', hostEpoch: 2 }).released).toBe(true)
    expect(router.targetCount()).toBe(1)
    expect(router.publish({ type: 'persistence-state' }).delivered).toBe(1)
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith('window-main', expect.objectContaining({ type: 'persistence-state' }))
  })

  it('释放后同身份重挂仍直发一条快照，attachHost 的既有语义逐字保留', () => {
    const { router, send, setRevision } = createHarness({ maxTargets: 1 })
    router.subscribe({ windowInstanceId: 'window-detached', hostEpoch: 2 })
    expect(router.releaseHost({ windowInstanceId: 'window-detached', hostEpoch: 2 }).released).toBe(true)
    send.mockClear()
    setRevision(12)
    const attached = router.attachHost({ windowInstanceId: 'window-detached', hostEpoch: 2, scope: { workspaceInstanceKey: 'workspace-1' } })
    expect(attached.subscribed).toBe(true)
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith('window-detached', attached.snapshotEvent)
    expect(router.targetCount()).toBe(1)
    // 续增量仍按归属放行（释放+重挂不改变授权判定）
    send.mockClear()
    expect(router.publish({ type: 'host-reparent', scope: { workspaceInstanceKey: 'workspace-1' } }).delivered).toBe(1)
  })

  it('rejects malformed subscriptions instead of registering an unbounded scope', () => {
    const { router } = createHarness()
    expect(router.subscribe({ windowInstanceId: '', hostEpoch: 1 })).toBe(false)
    expect(router.subscribe({ windowInstanceId: 'window-a', hostEpoch: 0 })).toBe(false)
    expect(router.subscribe({ windowInstanceId: 'window-a', hostEpoch: 1.5 })).toBe(false)
    expect(router.subscribe({ windowInstanceId: 'window-a', hostEpoch: 1, scope: { panelInstanceKey: '' } })).toBe(false)
    expect(router.targetCount()).toBe(0)
  })
})
