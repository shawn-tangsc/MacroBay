import { describe, expect, it } from 'vitest'

import type { WorkspaceBounds } from '@platform/workspace/contracts'
import { WorkspaceWritePolicy } from '@platform/workspace/persistence/panelLayoutDocument'
import { createSecureWindowSecurity } from '../../window/createMainWindow'
import {
  createPanelDetachedWindowHost,
  type DetachedWindowFactory,
  type DetachedWindowHandle
} from './panelDetachedWindowHost'
import { createTabDetachedWindowHost } from './tabDetachedWindowHost'
import type { WorkspaceDisplayInfo } from './workspaceWindowBounds'
import { createWorkspaceWindowRegistry } from './workspaceWindowRegistry'

/**
 * Owner: platform/desktop/main/workspace（PLAT-04 focused）。权威：技术清单 PLAT-04
 * 「页窗 resize/move 变化写入受控状态，并经既有单写持久化路径落盘；不得每像素落盘、不得形成写风暴」。
 *
 * 本文件只覆盖**共享宿主的受控 bounds 端口**（真 registry + 真共享宿主 + 真 tabDetachedWindowHost，
 * 只把窗口工厂与定时器换成注入 fake，不启动 Electron）：
 *  1) resize/move 洪水在合并窗口（`WorkspaceWritePolicy.boundsMergeMs`）内只交付一次，最新值胜出；
 *  2) 畸形 bounds（NaN/负数/0）绝不进入受控状态，绝不交付；
 *  3) 交付带**注册表身份**（windowInstanceId + hostEpoch），消费方据此 fail closed；
 *  4) 窗口销毁 / 退出（appExit）前 pending 先被交付：最终尺寸绝不丢在 shutdown barrier 之后；
 *  5) 退订后不再交付；单个监听器抛错不影响其它监听器与窗口语义。
 */

const PRELOAD = '/app/preload/index.js'
const APP_ROOT = 'file:///app/renderer'
const ENTRY = 'file:///app/renderer/index.html'
const TAB_WINDOW = { windowInstanceId: 'detached-tab-1', hostEpoch: 2 }
const WORKSPACE_KEY = 'ws-1'

type Timer = { delayMs: number; run: () => void; cancelled: boolean; dueAt: number }

function createHarness() {
  let sequence = 0
  let clock = 0
  const timers: Timer[] = []
  const emitters = new Map<string, (bounds: WorkspaceBounds) => void>()
  const registry = createWorkspaceWindowRegistry({ createOpaqueId: (prefix) => `${prefix}-${++sequence}` })
  const displays = (): readonly WorkspaceDisplayInfo[] => [
    { id: 'primary', workArea: { x: 0, y: 0, width: 1920, height: 1040 }, scaleFactor: 2 }
  ]
  const createWindow: DetachedWindowFactory = (input) => {
    const listeners = new Set<(bounds: WorkspaceBounds) => void>()
    emitters.set(input.windowInstanceId, (bounds) => { for (const listener of [...listeners]) listener(bounds) })
    const handle = {
      webContentsId: 100 + sequence,
      loadURL: () => Promise.resolve(),
      isDestroyed: () => false,
      isCrashed: () => false,
      destroy: () => undefined,
      focus: () => undefined,
      setWindowOpenHandler: () => undefined,
      onBoundsChanged: (listener: (bounds: WorkspaceBounds) => void) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      }
    } as unknown as DetachedWindowHandle
    return handle
  }
  const host = createPanelDetachedWindowHost({
    entryUrl: ENTRY,
    appRoot: APP_ROOT,
    createWindow,
    security: createSecureWindowSecurity({ preload: PRELOAD, openExternal: () => undefined }),
    registry,
    displays,
    timers: {
      schedule: (delayMs: number, run: () => void) => {
        const entry: Timer = { delayMs, run, cancelled: false, dueAt: clock + delayMs }
        timers.push(entry)
        return () => { entry.cancelled = true }
      }
    }
  })
  const tabHost = createTabDetachedWindowHost({ host, registry })
  const main = registry.registerMainWindow({ webContentsId: 1 })
  /** 手动时钟：只在请求的窗口内兑现定时器（绝不推进真实时间）。 */
  const advance = (deltaMs: number): void => {
    const target = clock + deltaMs
    for (;;) {
      const next = timers.filter((timer) => !timer.cancelled && timer.dueAt <= target)
        .sort((left, right) => left.dueAt - right.dueAt)[0]
      if (next === undefined) break
      next.cancelled = true
      clock = next.dueAt
      next.run()
    }
    clock = target
  }
  return {
    registry, host, tabHost, main, emitters, timers, advance,
    /** 只数**采集合并**定时器：传输截止时间用的是另一个具名策略，不参与本文件判据。 */
    pendingMergeDelays: () => timers
      .filter((timer) => !timer.cancelled && timer.delayMs === WorkspaceWritePolicy.boundsMergeMs)
      .map((timer) => timer.delayMs)
  }
}

/** 走真实分离事务建出一扇页窗（身份来自 Tab store 的预分配，与真机一致）。 */
async function detachPageWindow() {
  const harness = createHarness()
  const reserved = harness.registry.reserveDetachedTabWindow({
    windowInstanceId: TAB_WINDOW.windowInstanceId, hostEpoch: TAB_WINDOW.hostEpoch, workspaceInstanceKey: WORKSPACE_KEY
  })
  expect(reserved.status).toBe('reserved')
  const outcome = await harness.tabHost.requestTabDetach({
    operationId: 'op-1',
    workspaceInstanceKey: WORKSPACE_KEY,
    pageId: 'sample.alpha',
    menuKey: '/sample/alpha',
    title: 'Alpha',
    sourceHost: { windowInstanceId: harness.main.windowInstanceId, hostEpoch: harness.main.hostEpoch },
    ...TAB_WINDOW
  })
  expect(outcome.status).toBe('awaiting-ready')
  const emit = harness.emitters.get(TAB_WINDOW.windowInstanceId)
  if (emit === undefined) throw new Error('window handle did not expose onBoundsChanged')
  return { ...harness, emit }
}

describe('PLAT-04 共享宿主 bounds 端口：合并窗口 + 身份 + barrier', () => {
  it('① resize 洪水在合并窗口内只交付一次（最新值胜出），合并窗口＝WorkspaceWritePolicy.boundsMergeMs', async () => {
    const harness = await detachPageWindow()
    const delivered: Array<{ windowInstanceId: string; hostEpoch: number; bounds: WorkspaceBounds }> = []
    harness.host.subscribeDetachedWindowBounds((event) => delivered.push(event))

    for (let step = 0; step < 50; step += 1) {
      harness.emit({ x: 10 + step, y: 20, width: 1000 + step, height: 700 })
    }
    expect(delivered).toEqual([]) // 合并窗口内绝不逐个交付
    expect(harness.pendingMergeDelays()).toEqual([WorkspaceWritePolicy.boundsMergeMs])

    harness.advance(WorkspaceWritePolicy.boundsMergeMs)
    expect(delivered).toHaveLength(1)
    expect(delivered[0]).toEqual({
      windowInstanceId: TAB_WINDOW.windowInstanceId, hostEpoch: TAB_WINDOW.hostEpoch,
      bounds: { x: 59, y: 20, width: 1049, height: 700 }
    })
  })

  it('② 畸形 bounds 绝不进入受控状态（NaN/负数/0/缺字段一律不交付）', async () => {
    const harness = await detachPageWindow()
    const delivered: unknown[] = []
    harness.host.subscribeDetachedWindowBounds((event) => delivered.push(event))

    const malformed = [
      { x: Number.NaN, y: 0, width: 1280, height: 800 },
      { x: 0, y: Number.POSITIVE_INFINITY, width: 1280, height: 800 },
      { x: 0, y: 0, width: -1280, height: 800 },
      { x: 0, y: 0, width: 1280, height: 0 },
      { x: 0, y: 0, width: 1280, height: Number.NaN },
      { x: 0, y: 0, width: 1280 } as unknown as WorkspaceBounds
    ]
    for (const bounds of malformed) harness.emit(bounds)
    harness.advance(WorkspaceWritePolicy.boundsMergeMs)

    expect(delivered).toEqual([])
    expect(harness.pendingMergeDelays()).toEqual([]) // 畸形值连定时器都不建
  })

  it('③ flush 立即交付 pending（shutdown barrier 之前把最终尺寸交给消费方）', async () => {
    const harness = await detachPageWindow()
    const delivered: WorkspaceBounds[] = []
    harness.host.subscribeDetachedWindowBounds((event) => delivered.push(event.bounds))

    harness.emit({ x: 7, y: 8, width: 1111, height: 777 })
    expect(delivered).toEqual([])
    harness.host.flushPendingDetachedWindowBounds()
    expect(delivered).toEqual([{ x: 7, y: 8, width: 1111, height: 777 }])
    // 再次 flush 幂等：没有 pending 就不再交付（绝不重复写）
    harness.host.flushPendingDetachedWindowBounds()
    expect(delivered).toHaveLength(1)
  })

  it('④ 窗口销毁（原生回停靠）前 pending 先被交付：最终尺寸不丢', async () => {
    const harness = await detachPageWindow()
    const delivered: WorkspaceBounds[] = []
    harness.host.subscribeDetachedWindowBounds((event) => delivered.push(event.bounds))

    harness.emit({ x: 3, y: 4, width: 1300, height: 900 })
    const closed = harness.host.handleNativeClose({
      windowInstanceId: TAB_WINDOW.windowInstanceId, hostEpoch: TAB_WINDOW.hostEpoch,
      lastValidDock: 'embedded', supportedModes: ['embedded']
    })
    expect(closed.status).toBe('redocked')
    expect(delivered).toEqual([{ x: 3, y: 4, width: 1300, height: 900 }])
  })

  it('⑤ appExit 前 pending 先被交付（绝不丢在退出 barrier 之后）', async () => {
    const harness = await detachPageWindow()
    const delivered: WorkspaceBounds[] = []
    harness.host.subscribeDetachedWindowBounds((event) => delivered.push(event.bounds))

    harness.emit({ x: 11, y: 12, width: 1212, height: 812 })
    const summary = await harness.host.appExit({ flush: () => undefined })
    expect(summary.flushOutcome).toBe('flushed')
    expect(delivered).toEqual([{ x: 11, y: 12, width: 1212, height: 812 }])
  })

  it('⑥ 退订后不再交付；单个监听器抛错不影响其它监听器', async () => {
    const harness = await detachPageWindow()
    const delivered: WorkspaceBounds[] = []
    const unsubscribe = harness.host.subscribeDetachedWindowBounds((event) => delivered.push(event.bounds))
    harness.host.subscribeDetachedWindowBounds(() => { throw new Error('consumer-failure') })

    harness.emit({ x: 1, y: 1, width: 1000, height: 700 })
    harness.advance(WorkspaceWritePolicy.boundsMergeMs)
    expect(delivered).toHaveLength(1)

    unsubscribe()
    harness.emit({ x: 2, y: 2, width: 1001, height: 701 })
    harness.advance(WorkspaceWritePolicy.boundsMergeMs)
    expect(delivered).toHaveLength(1)
  })
})
