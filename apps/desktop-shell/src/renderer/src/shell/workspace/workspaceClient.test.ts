// @vitest-environment happy-dom
/**
 * Owner: apps/desktop-shell renderer / workspace 宿主桥 focused 回归（P1-06g）。回归：本文件。
 * 权威：P1-07 的 D2（`ws-renderer-<seq>` 每实例从 1 重数 ⇒ 同窗重载/HMR 后新 client 的前若干命令命中 Main 的
 * 幂等旧响应）与非阻塞②（源 ACK runner 的 `handled` 集合无清理路径、长会话单调增长）。
 *
 * 只注入 fake preload 形状的 bridge：不启动 Electron、不读真实 profile/密钥、不加载产品。fake Main 复刻
 * `panelWorkspaceStore.keyFor` 的 `requestScope:requestId` 幂等缓存（旧语义＝同 key 直接回放；新语义＝
 * 方法/参数不同即 fail closed）。
 */
import { describe, expect, it } from 'vitest'

import type { WorkspaceSnapshot } from '@platform/workspace/contracts'
import { WorkspaceOwnershipPolicy } from '@platform/workspace/policies'
import {
  createWorkspaceClient,
  createWorkspaceSourceAckRunner,
  type WorkspaceBridge,
  type WorkspaceSourceAckTask
} from './workspaceClient'
import type { WorkspaceContentAdapter } from './workspaceHostAdapter'

const MAIN_WINDOW_ID = WorkspaceOwnershipPolicy.initialWindowInstanceId
const HOST_EPOCH = WorkspaceOwnershipPolicy.initialHostEpoch
const PANEL_KEY = 'panel-1'
const PANEL_ID = 'platform.inspector'

function snapshotWith(mode: 'embedded' | 'docked-right' | 'docked-bottom', revision: number): WorkspaceSnapshot {
  return {
    layoutRevision: revision,
    activeWorkspaceInstanceKey: 'ws-1',
    panels: [{
      workspaceInstanceKey: 'ws-1', panelInstanceKey: PANEL_KEY, panelId: PANEL_ID, open: true, mode,
      presentation: 'normal', bindingState: 'bound', windowInstanceId: MAIN_WINDOW_ID, hostEpoch: HOST_EPOCH,
      lastValidDock: 'embedded'
    }],
    pageLayouts: [{ workspaceInstanceKey: 'ws-1', panelOrder: [PANEL_KEY], activePanels: { [mode]: PANEL_KEY } }],
    tabs: [],
    persistenceState: 'saved'
  }
}

const emptySnapshot = (): WorkspaceSnapshot => ({
  layoutRevision: 1, activeWorkspaceInstanceKey: null, panels: [], pageLayouts: [], tabs: [], persistenceState: 'saved'
})

/**
 * fake Main：复刻 store 的 `requestScope:requestId` 幂等缓存。
 *  - `replay`（P1-06g 之前的真机语义）：同 key 一律回放旧响应（不比对方法/参数）；
 *  - `strict`（P1-06g 之后的 Main 语义）：同 key 且方法/参数不同 ⇒ `invalid-request`，完全相同才回放。
 */
function createFakeMain(mode: 'replay' | 'strict') {
  const requests: Record<string, unknown>[] = []
  const cache = new Map<string, { fingerprint: string; response: unknown }>()
  let revision = 7
  let currentMode: 'embedded' | 'docked-right' | 'docked-bottom' = 'embedded'
  const bridge: WorkspaceBridge = {
    getHostContext: async () => ({
      status: 'ok',
      context: {
        windowInstanceId: MAIN_WINDOW_ID, hostEpoch: HOST_EPOCH, role: 'main', mounts: [], pendingTransfer: null,
        layoutRevision: revision, pageIds: [], preferences: { language: 'en-US', theme: 'system' }
      }
    }),
    getSnapshot: async () => ({ status: 'ok', snapshot: snapshotWith(currentMode, revision) }),
    command: async (request: unknown) => {
      const record = request as Record<string, unknown>
      requests.push(record)
      const key = `${record.requestScope ?? 'main'}:${String(record.requestId)}`
      const fingerprint = JSON.stringify([record.method, record.mode, record.panelInstanceKey, record.dockSize])
      const cached = cache.get(key)
      if (cached) {
        if (mode === 'replay' || cached.fingerprint === fingerprint) return cached.response
        return { status: 'rejected', snapshot: snapshotWith(currentMode, revision), errorCode: 'invalid-request', panelInstanceKey: PANEL_KEY }
      }
      if (typeof record.mode === 'string') currentMode = record.mode as typeof currentMode
      revision += 1
      const response = { status: 'applied', snapshot: snapshotWith(currentMode, revision), panelInstanceKey: PANEL_KEY }
      cache.set(key, { fingerprint, response })
      return response
    },
    hostLifecycle: async () => ({ accepted: true }),
    onEvent: () => () => undefined
  }
  return { bridge, requests }
}

describe('D2 requestId 跨 client 实例唯一', () => {
  it('重载/重挂后用旧缓存误答第一条命令（真机症状）绝不复现', async () => {
    const main = createFakeMain('replay')
    const first = createWorkspaceClient(main.bridge)
    await first.readHostContext()
    const applied = await first.port.switchContainer({ panelInstanceKey: PANEL_KEY, mode: 'docked-right' })
    expect(applied.status).toBe('applied')

    // 同窗重载/HMR：桥（= Main 的幂等缓存）不变，只重建 client
    const reloaded = createWorkspaceClient(main.bridge)
    await reloaded.readHostContext()
    const next = await reloaded.port.switchContainer({ panelInstanceKey: PANEL_KEY, mode: 'docked-bottom' })

    expect(next.status).toBe('applied')
    expect(next.snapshot.panels[0]?.mode).toBe('docked-bottom') // 旧实现拿到的是 'docked-right' 的旧响应
    expect(next.snapshot.layoutRevision).toBe(9) // 旧实现停在 8
    expect(main.requests).toHaveLength(2)
    expect(main.requests[0]?.requestId).not.toBe(main.requests[1]?.requestId) // 跨实例绝不重号
  })

  it('重建 client 后第一条命令不会被新 Main 的 fail closed 误拒', async () => {
    const main = createFakeMain('strict')
    const first = createWorkspaceClient(main.bridge)
    await first.readHostContext()
    await first.port.switchContainer({ panelInstanceKey: PANEL_KEY, mode: 'docked-right' })

    const reloaded = createWorkspaceClient(main.bridge)
    await reloaded.readHostContext()
    const next = await reloaded.port.switchContainer({ panelInstanceKey: PANEL_KEY, mode: 'docked-bottom' })

    expect(next.status).toBe('applied')
    expect(next.snapshot.panels[0]?.mode).toBe('docked-bottom')
  })

  it('同一 client 内 requestId 严格不重复，且带上实例标识', async () => {
    const main = createFakeMain('strict')
    const client = createWorkspaceClient(main.bridge)
    await client.readHostContext()
    await client.port.activate({ panelInstanceKey: PANEL_KEY })
    await client.port.activate({ panelInstanceKey: PANEL_KEY })
    await client.port.activate({ panelInstanceKey: PANEL_KEY })

    const ids = main.requests.map((request) => String(request.requestId))
    expect(new Set(ids).size).toBe(3)
    // 请求仍然通过受控命令面（不新增字段、不改 method）
    expect(main.requests.every((request) => request.method === 'activatePanel')).toBe(true)
    expect(ids.every((id) => id.startsWith('ws-renderer-') && id.length <= 200)).toBe(true)
  })
})

/** 源 ACK 的最小可用桥（身份取自受控上下文，ACK 一律 accepted）。 */
function ackBridge() {
  const ackRequests: Record<string, unknown>[] = []
  const bridge: WorkspaceBridge = {
    getHostContext: async () => ({
      status: 'ok',
      context: {
        windowInstanceId: MAIN_WINDOW_ID, hostEpoch: HOST_EPOCH, role: 'main', mounts: [], pendingTransfer: null,
        layoutRevision: 1, pageIds: [], preferences: { language: 'en-US', theme: 'system' }
      }
    }),
    getSnapshot: async () => ({ status: 'ok', snapshot: emptySnapshot() }),
    command: async () => ({ status: 'applied', snapshot: emptySnapshot(), panelInstanceKey: PANEL_KEY }),
    hostLifecycle: async (request: unknown) => { ackRequests.push(request as Record<string, unknown>); return { accepted: true } },
    onEvent: () => () => undefined
  }
  return { bridge, ackRequests }
}

const readyAdapter = (): WorkspaceContentAdapter => ({
  prepare: async () => ({ status: 'ready' }),
  release: async () => ({ status: 'released', acknowledged: true })
})

const task = (operationId: string): WorkspaceSourceAckTask => ({
  key: `${operationId}:awaiting-source-prepared`, operationId, phase: 'awaiting-source-prepared',
  panelInstanceKey: PANEL_KEY, panelId: PANEL_ID
})

async function readyRunner() {
  const main = ackBridge()
  const client = createWorkspaceClient(main.bridge)
  await client.readHostContext()
  return { runner: createWorkspaceSourceAckRunner(client), ackRequests: main.ackRequests }
}

describe('源 ACK runner 的 handled 集合有界（P1-06g 非阻塞②）', () => {
  it('长会话不单调增长：持续受理新任务时已受理 key 数保持有界', async () => {
    const { runner, ackRequests } = await readyRunner()
    const adapter = readyAdapter()
    for (let index = 0; index < 200; index += 1) await runner.run(task(`operation-${index}`), adapter)
    const afterFirstBatch = runner.acceptedKeys().length
    for (let index = 200; index < 400; index += 1) await runner.run(task(`operation-${index}`), adapter)

    expect(afterFirstBatch).toBeLessThan(200)
    expect(runner.acceptedKeys().length).toBe(afterFirstBatch) // 再加 200 条也不再增长
    expect(ackRequests).toHaveLength(400) // 有界只影响诊断历史，绝不影响 ACK 真的发出
  })

  it('事务收敛时清理：retain 只保留仍在飞的 key，返回淘汰条数', async () => {
    const { runner } = await readyRunner()
    const adapter = readyAdapter()
    await runner.run(task('operation-live'), adapter)
    await runner.run(task('operation-done'), adapter)
    expect(runner.acceptedKeys()).toHaveLength(2)

    expect(runner.retain([task('operation-live').key])).toBe(1)
    expect(runner.acceptedKeys()).toEqual([task('operation-live').key])
    expect(runner.retain([])).toBe(1)
    expect(runner.acceptedKeys()).toEqual([])
  })

  it('保留「每 operationId×相位只发一次」：并发/重复 run 只发一条 ACK', async () => {
    const { runner, ackRequests } = await readyRunner()
    const adapter = readyAdapter()
    const same = task('operation-1')
    await Promise.all([runner.run(same, adapter), runner.run(same, adapter), runner.run(same, adapter)])
    await runner.run(same, adapter)
    expect(ackRequests).toHaveLength(1)
  })

  it('仍在飞的 key 绝不因加界被淘汰（保 phase 幂等）', async () => {
    const { runner, ackRequests } = await readyRunner()
    const adapter = readyAdapter()
    const live = task('operation-live')
    await runner.run(live, adapter)
    runner.retain([live.key]) // 调用方声明该事务仍在飞
    for (let index = 0; index < 200; index += 1) await runner.run(task(`noise-${index}`), adapter)
    const bounded = runner.acceptedKeys().length
    for (let index = 200; index < 400; index += 1) await runner.run(task(`noise-${index}`), adapter)

    expect(runner.acceptedKeys()).toContain(live.key) // 在飞 key 绝不被淘汰
    expect(runner.acceptedKeys().length).toBe(bounded) // 再加 200 条噪声也不再增长
    await runner.run(live, adapter) // 重复 run 仍只发一次
    expect(ackRequests.filter((request) => request.operationId === 'operation-live')).toHaveLength(1)
  })
})

/**
 * P2-03：`.tabs.*` 桥的 focused 回归（同一文件，沿用上面的 fake-bridge 口径）。
 * 判据：受控 requestId + 权威 revision CAS + 畸形响应 fail closed + 事件合并重取 + 订阅释放。
 */
describe('workspace tab client (P2-03)', () => {
  function createTabBridge(overrides: { snapshot?: unknown; command?: (request: unknown) => unknown } = {}) {
    const requests: Array<Record<string, unknown>> = []
    const listeners = new Set<(event: unknown) => void>()
    let revision = 3
    return {
      requests,
      emit: (event: unknown) => { for (const listener of [...listeners]) listener(event) },
      listenerCount: () => listeners.size,
      bridge: {
        tabsGetSnapshot: async () => overrides.snapshot ?? {
          status: 'ok',
          snapshot: {
            layoutRevision: revision, activeWorkspaceInstanceKey: 'ws-1',
            tabs: [{
              workspaceInstanceKey: 'ws-1', pageId: 'agents', menuKey: 'agents', open: true, order: 0,
              mode: 'main', bindingState: 'bound', windowInstanceId: MAIN_WINDOW_ID, hostEpoch: HOST_EPOCH
            }]
          }
        },
        tabsCommand: async (request: unknown) => {
          requests.push(request as Record<string, unknown>)
          revision += 1
          if (overrides.command) return overrides.command(request)
          return {
            status: 'applied',
            snapshot: {
              layoutRevision: revision, activeWorkspaceInstanceKey: 'ws-1',
              tabs: [{
                workspaceInstanceKey: 'ws-1', pageId: 'agents', menuKey: 'agents', open: true, order: 0,
                mode: 'main', bindingState: 'bound', windowInstanceId: MAIN_WINDOW_ID, hostEpoch: HOST_EPOCH
              }]
            },
            workspaceInstanceKey: 'ws-1'
          }
        },
        onEvent: (listener: (event: unknown) => void) => {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        }
      }
    }
  }

  it('sends a controlled requestId with the authoritative revision and adopts the authoritative snapshot', async () => {
    const harness = createTabBridge()
    const { createWorkspaceTabClient } = await import('./workspaceClient')
    const client = createWorkspaceTabClient(harness.bridge)
    const loaded = await client.load()
    expect(loaded?.tabs).toHaveLength(1)
    expect(client.getState()?.layoutRevision).toBe(3)

    const result = await client.port.openTab({ menuKey: 'agents' })
    expect(result.status).toBe('applied')
    expect(harness.requests[0]).toMatchObject({
      method: 'openTab', expectedRevision: 3, menuKey: 'agents'
    })
    expect(String(harness.requests[0].requestId)).toMatch(/^ws-renderer-tabs-/)
    // 响应里的真实 revision 被采纳：下一条命令用新 revision
    await client.port.activateTab({ workspaceInstanceKey: 'ws-1' })
    expect(harness.requests[1]).toMatchObject({ method: 'activateTab', expectedRevision: 4 })
    // 绝不外泄 renderer 自选身份
    expect(harness.requests[0]).not.toHaveProperty('windowInstanceId')
    client.dispose()
  })

  it('fails closed on a malformed snapshot and never issues a command without an authoritative revision', async () => {
    const malformed = createTabBridge({ snapshot: { status: 'ok', snapshot: { layoutRevision: -1, tabs: [] } } })
    const { createWorkspaceTabClient } = await import('./workspaceClient')
    const broken = createWorkspaceTabClient(malformed.bridge)
    expect(await broken.load()).toBeNull()
    await expect(broken.port.openTab({ menuKey: 'agents' })).rejects.toThrow('no-authoritative-revision')
    expect(malformed.requests).toHaveLength(0)
    broken.dispose()

    const badShape = createTabBridge({ snapshot: { status: 'ok', snapshot: { layoutRevision: 1, activeWorkspaceInstanceKey: null, tabs: [{ pageId: 'agents' }] } } })
    const client = createWorkspaceTabClient(badShape.bridge)
    expect(await client.load()).toBeNull()
    client.dispose()
  })

  it('refreshes on a controlled event and releases the single subscription on dispose', async () => {
    const harness = createTabBridge()
    const { createWorkspaceTabClient } = await import('./workspaceClient')
    const client = createWorkspaceTabClient(harness.bridge)
    const seen: number[] = []
    const stop = client.observe((state) => seen.push(state.layoutRevision))
    expect(harness.listenerCount()).toBe(1)

    harness.emit({ type: 'container-changed', layoutRevision: 9, scope: { workspaceInstanceKey: 'ws-1' } })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(seen).toContain(3)
    // 白名单外的事件类型被丢弃（不触发重取，也绝不报错）
    harness.emit({ type: 'not-an-event', layoutRevision: 10, scope: {} })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(harness.listenerCount()).toBe(1)

    stop()
    expect(harness.listenerCount()).toBe(0)
    client.dispose()
    expect(harness.listenerCount()).toBe(0)
  })
})
