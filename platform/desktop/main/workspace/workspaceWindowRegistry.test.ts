import { describe, expect, it } from 'vitest'

import { WorkspaceOwnershipPolicy, WorkspaceTransferPolicy } from '@platform/workspace/policies'
import { createWorkspaceWindowRegistry, type WorkspaceWindowReservation } from './workspaceWindowRegistry'

/**
 * Owner: platform/desktop/main/workspace。回归 P1-04 窗口 registry：
 * windowInstanceId + hostEpoch 身份、webContents ↔ 实例映射、未登记/已销毁拒绝、
 * 销毁清理、迟到窗口判定、detached 宿主预算（消费 WorkspaceTransferPolicy.maxDetachedHosts）。
 */

/** detached 目标宿主 epoch 由 Main 在事务里推导（源 epoch + 1），registry 只登记不发明。 */
const DETACHED_EPOCH = WorkspaceOwnershipPolicy.initialHostEpoch + 1

function createRegistry() {
  let sequence = 0
  return createWorkspaceWindowRegistry({ createOpaqueId: (prefix) => `${prefix}-${++sequence}` })
}

function reserve(registry: ReturnType<typeof createRegistry>, panelInstanceKey: string): WorkspaceWindowReservation {
  const reserved = registry.reserveDetachedWindow({ hostEpoch: DETACHED_EPOCH, panelInstanceKey, workspaceInstanceKey: 'workspace-1' })
  if (reserved.status !== 'reserved') throw new Error(`reservation rejected: ${reserved.errorCode}`)
  return reserved.record
}

describe('workspace window registry', () => {
  it('allocates opaque window identity and maps webContents to the owned window', () => {
    const registry = createRegistry()
    const main = registry.registerMainWindow({ webContentsId: 1 })
    expect(main.kind).toBe('main')
    expect(main.windowInstanceId).toBe('window-1')
    expect(main.hostEpoch).toBe(WorkspaceOwnershipPolicy.initialHostEpoch)

    const detached = reserve(registry, 'panel-a')
    expect(detached.kind).toBe('detached-panel')
    expect(registry.attachWebContents({ windowInstanceId: detached.windowInstanceId, webContentsId: 7 }))
      .toMatchObject({ status: 'attached', record: { webContentsId: 7, panelInstanceKey: 'panel-a' } })
    expect(registry.resolveWebContents(7)?.panelInstanceKey).toBe('panel-a')
    expect(registry.resolveWebContents(1)?.kind).toBe('main')
    expect(registry.registerMainWindow({ webContentsId: 1 }).windowInstanceId).toBe(main.windowInstanceId)
    expect(registry.listWindows()).toHaveLength(2)
  })

  it('rejects unregistered and already destroyed webContents instead of guessing an owner', () => {
    const registry = createRegistry()
    expect(registry.resolveWebContents(99)).toBeUndefined()
    const detached = reserve(registry, 'panel-a')
    registry.attachWebContents({ windowInstanceId: detached.windowInstanceId, webContentsId: 7 })

    expect(registry.markDestroyed({ webContentsId: 7 })?.windowInstanceId).toBe(detached.windowInstanceId)
    expect(registry.resolveWebContents(7)).toBeUndefined()
    expect(registry.describeWindow(detached.windowInstanceId)).toBeUndefined()
    expect(registry.markDestroyed({ webContentsId: 7 })).toBeUndefined()
    expect(registry.attachWebContents({ windowInstanceId: 'window-missing', webContentsId: 8 }))
      .toEqual({ status: 'rejected', errorCode: 'unknown-window' })
  })

  it('reserves at most WorkspaceTransferPolicy.maxDetachedHosts hosts and never evicts existing ones', () => {
    const registry = createRegistry()
    for (let index = 0; index < WorkspaceTransferPolicy.maxDetachedHosts; index += 1) {
      expect(registry.reserveDetachedWindow({ hostEpoch: DETACHED_EPOCH, panelInstanceKey: `panel-${index}`, workspaceInstanceKey: 'workspace-1' }).status).toBe('reserved')
    }
    expect(registry.detachedHostCount()).toBe(WorkspaceTransferPolicy.maxDetachedHosts)

    expect(registry.reserveDetachedWindow({ hostEpoch: DETACHED_EPOCH, panelInstanceKey: 'panel-overflow', workspaceInstanceKey: 'workspace-1' }))
      .toEqual({ status: 'rejected', errorCode: 'limit-reached' })
    expect(registry.detachedHostCount()).toBe(WorkspaceTransferPolicy.maxDetachedHosts)
    expect(registry.listDetachedHosts().map((record) => record.panelInstanceKey)).not.toContain('panel-overflow')
  })

  it('frees the budget slot when a reservation is dropped or a detached window is destroyed', () => {
    const registry = createRegistry()
    const first = reserve(registry, 'panel-a')
    const second = reserve(registry, 'panel-b')
    expect(registry.detachedHostCount()).toBe(2)

    expect(registry.releaseReservation(first.windowInstanceId)).toBe(true)
    expect(registry.releaseReservation(first.windowInstanceId)).toBe(false)
    expect(registry.detachedHostCount()).toBe(1)

    registry.markDestroyed({ windowInstanceId: second.windowInstanceId })
    expect(registry.detachedHostCount()).toBe(0)
    expect(registry.listDetachedHosts()).toEqual([])
  })

  it('classifies identity status without implying that a live window must be destroyed', () => {
    const registry = createRegistry()
    const detached = reserve(registry, 'panel-a')

    expect(registry.identityStatus({ windowInstanceId: 'window-unknown', hostEpoch: DETACHED_EPOCH })).toBe('unregistered')
    expect(registry.identityStatus({ windowInstanceId: detached.windowInstanceId, hostEpoch: detached.hostEpoch + 1 })).toBe('stale')
    // 'stale' 只说明「来者不是当前 owner」，绝不允许据此销毁在线窗口，也不得删掉真实登记
    expect(registry.describeWindow(detached.windowInstanceId)).toBeDefined()
    expect(registry.identityStatus({ windowInstanceId: detached.windowInstanceId, hostEpoch: detached.hostEpoch })).toBe('current')
  })

  it('rejects binding a webContents that already belongs to another window', () => {
    const registry = createRegistry()
    const first = reserve(registry, 'panel-a')
    const second = reserve(registry, 'panel-b')
    expect(registry.attachWebContents({ windowInstanceId: first.windowInstanceId, webContentsId: 7 })).toMatchObject({ status: 'attached' })
    expect(registry.attachWebContents({ windowInstanceId: second.windowInstanceId, webContentsId: 7 }))
      .toEqual({ status: 'rejected', errorCode: 'web-contents-bound' })
    expect(registry.resolveWebContents(7)?.windowInstanceId).toBe(first.windowInstanceId)
    expect(registry.describeWindow(second.windowInstanceId)?.webContentsId).toBeNull()
    // 同一窗口重复 attach 同一 webContents 是幂等的
    expect(registry.attachWebContents({ windowInstanceId: first.windowInstanceId, webContentsId: 7 })).toMatchObject({ status: 'attached' })
  })

  /**
   * PLAT-01①：登记回收必须**当刻**通知（订阅者据此立刻释放运行期资源，绝不等下一次调用方读）。
   * RED（当前）：`onWindowRecycled` 不存在 ⇒ 回收点没有任何通知，释放只能靠调用方懒触发。
   */
  it('回收点同步通知：只有真实回收才派发被回收的记录，订阅者异常与退订都不改变回收结论', () => {
    const registry = createRegistry()
    const recycled: string[] = []
    const unsubscribe = registry.onWindowRecycled((record) => {
      recycled.push(`${record.windowInstanceId}:${record.hostEpoch}`)
    })
    const detached = reserve(registry, 'panel-a')
    registry.attachWebContents({ windowInstanceId: detached.windowInstanceId, webContentsId: 7 })

    // 未登记的销毁（幂等 no-op）绝不派发：通知只对**真实回收**发生
    expect(registry.markDestroyed({ windowInstanceId: 'window-unknown' })).toBeUndefined()
    expect(registry.markDestroyed({ webContentsId: 999 })).toBeUndefined()
    expect(recycled).toEqual([])

    expect(registry.markDestroyed({ webContentsId: 7 })?.windowInstanceId).toBe(detached.windowInstanceId)
    expect(recycled).toEqual([`${detached.windowInstanceId}:${detached.hostEpoch}`])

    // 退订后不再通知（无残留订阅者）
    unsubscribe()
    const second = reserve(registry, 'panel-b')
    registry.markDestroyed({ windowInstanceId: second.windowInstanceId })
    expect(recycled).toHaveLength(1)

    // 订阅者抛错绝不影响回收结论与其它订阅者（回收是权威，通知是尽力而为）
    const other: string[] = []
    registry.onWindowRecycled(() => { throw new Error('consumer-failure') })
    registry.onWindowRecycled((record) => { other.push(record.windowInstanceId) })
    const third = reserve(registry, 'panel-c')
    expect(registry.markDestroyed({ windowInstanceId: third.windowInstanceId })?.windowInstanceId).toBe(third.windowInstanceId)
    expect(other).toEqual([third.windowInstanceId])
    expect(registry.describeWindow(third.windowInstanceId)).toBeUndefined()
  })

  /**
   * PLAT-01 硬约束：**绝不在窗口可能仍存活时提前通知**（否则订阅方会提前退订，下一次读重挂并重发直发快照
   * ⇒ P2-09/B3 的 snapshot 重挂风暴）。身份判定（`stale`）与「已绑定 webContents 的登记」都不得触发回收通知。
   */
  it('身份判定与仍存活的登记绝不触发回收通知；预留释放这类真实回收仍即时通知', () => {
    const registry = createRegistry()
    const recycled: string[] = []
    registry.onWindowRecycled((record) => recycled.push(record.windowInstanceId))
    const first = reserve(registry, 'panel-a')
    const second = reserve(registry, 'panel-b')

    // 'stale' 只是判定，不承载销毁指令 ⇒ 绝不回收、绝不通知
    expect(registry.identityStatus({ windowInstanceId: second.windowInstanceId, hostEpoch: second.hostEpoch + 1 })).toBe('stale')
    expect(recycled).toEqual([])
    expect(registry.describeWindow(second.windowInstanceId)).toBeDefined()

    // 预留释放 = 身份被真实回收（从未物化）⇒ 通知一次
    expect(registry.releaseReservation(first.windowInstanceId)).toBe(true)
    expect(recycled).toEqual([first.windowInstanceId])

    // 已绑定 webContents 的登记在窗口仍存活时绝不因 releaseReservation 被回收，也绝不通知
    registry.attachWebContents({ windowInstanceId: second.windowInstanceId, webContentsId: 7 })
    expect(registry.releaseReservation(second.windowInstanceId)).toBe(false)
    expect(registry.describeWindow(second.windowInstanceId)).toBeDefined()
    expect(registry.resolveWebContents(7)?.windowInstanceId).toBe(second.windowInstanceId)
    expect(recycled).toEqual([first.windowInstanceId])
  })

  it('validates ownership by window identity plus hostEpoch', () => {
    const registry = createRegistry()
    const detached = reserve(registry, 'panel-a')
    expect(registry.assertOwner({ windowInstanceId: detached.windowInstanceId, hostEpoch: detached.hostEpoch }))
      .toMatchObject({ status: 'ok' })
    expect(registry.assertOwner({ windowInstanceId: detached.windowInstanceId, hostEpoch: detached.hostEpoch + 1 }))
      .toEqual({ status: 'rejected', errorCode: 'epoch-mismatch' })
    expect(registry.assertOwner({ windowInstanceId: 'window-missing', hostEpoch: WorkspaceOwnershipPolicy.initialHostEpoch }))
      .toEqual({ status: 'rejected', errorCode: 'unknown-window' })
  })
})
