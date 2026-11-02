// @vitest-environment happy-dom
/**
 * Owner: apps/desktop-shell renderer / workspace **源宿主**侧 ACK 链（P1-06f）。回归：本文件。
 * 权威：P1-03 的内容适配器 prepare/release 语义 + P1-06d 的 hostLifecycle 准入。
 *
 * 只注入 fake preload `window.platform.workspace`：不启动 Electron、不读真实 profile/userData、不加载产品。
 * 断言源侧：prepare 据结果发 source-prepared；release 成功才发 source-released；失败/异常一律 fail closed；
 * 不是本窗承载的面板绝不代发 ACK（防冒名）；同一 operationId×相位幂等。
 */
import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { WorkspacePanelRegistration, WorkspacePanelSnapshot, WorkspaceSnapshot } from '@platform/workspace/contracts'
import { WorkspaceOwnershipPolicy } from '@platform/workspace/policies'
import { WorkspaceWindowRoot, type WorkspaceWindowRootProps } from './WorkspaceWindowRoot'
import type { WorkspaceBridge } from './workspaceClient'
import type { WorkspaceContentAdapter } from './workspaceHostAdapter'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const FLUSH_TURNS = 16
const WORKSPACE_KEY = 'ws-1'
const PANEL_KEY = 'panel-1'
const PANEL_ID = 'platform.inspector'
const MAIN_WINDOW_ID = 'window-main-1'
const OPERATION_ID = 'operation-1'
const REVISION = 7

let root: Root | undefined
let container: HTMLDivElement | undefined

afterEach(async () => {
  if (root) {
    const current = root
    root = undefined
    await act(async () => { current.unmount() })
  }
  container = undefined
  document.body.replaceChildren()
  Reflect.deleteProperty(window, 'platform')
  window.localStorage.clear()
  window.history.replaceState({}, '', '/')
})

async function settle(): Promise<void> {
  await act(async () => {
    for (let turn = 0; turn < FLUSH_TURNS; turn += 1) await Promise.resolve()
  })
}

const registration: WorkspacePanelRegistration = {
  panelId: PANEL_ID,
  title: { 'en-US': 'Inspector', 'zh-CN': '检查器' },
  icon: 'file-text',
  module: 'platform.inspector',
  pageIds: [],
  supportedModes: ['embedded', 'docked-right', 'docked-bottom', 'detached'],
  defaultMode: 'docked-right',
  allowMultipleInstances: false,
  minSize: { width: 200, height: 150 },
  preferredSize: { width: 300, height: 220 },
  binding: { persistence: 'none', maxKeyBytes: 256 },
  lifecycleEvents: []
}

function mainContext(): unknown {
  return {
    status: 'ok',
    context: {
      windowInstanceId: MAIN_WINDOW_ID, hostEpoch: WorkspaceOwnershipPolicy.initialHostEpoch, role: 'main',
      mounts: [{
        workspaceInstanceKey: WORKSPACE_KEY, panelInstanceKey: PANEL_KEY, panelId: PANEL_ID,
        open: true, mode: 'docked-right', bindingState: 'bound'
      }],
      pendingTransfer: null, layoutRevision: REVISION, pageIds: [],
      preferences: { language: 'en-US', theme: 'system' }
    }
  }
}

/** 本窗（主窗）承载的面板 + 指定相位的飞事务。 */
function sourceSnapshot(phase: string, revision: number, host: { windowInstanceId: string; hostEpoch: number } = {
  windowInstanceId: WorkspaceOwnershipPolicy.initialWindowInstanceId,
  hostEpoch: WorkspaceOwnershipPolicy.initialHostEpoch
}): WorkspaceSnapshot {
  const panel: WorkspacePanelSnapshot = {
    workspaceInstanceKey: WORKSPACE_KEY, panelInstanceKey: PANEL_KEY, panelId: PANEL_ID,
    open: true, mode: 'docked-right', presentation: 'normal', bindingState: 'bound',
    windowInstanceId: host.windowInstanceId, hostEpoch: host.hostEpoch, lastValidDock: 'docked-right',
    transfer: { operationId: OPERATION_ID, phase: phase as never }
  }
  return {
    layoutRevision: revision, activeWorkspaceInstanceKey: WORKSPACE_KEY, panels: [panel],
    pageLayouts: [{ workspaceInstanceKey: WORKSPACE_KEY, panelOrder: [PANEL_KEY], activePanels: { 'docked-right': PANEL_KEY } }],
    tabs: [], persistenceState: 'saved'
  }
}

type AckRequest = Record<string, unknown>
type BridgeHarness = {
  bridge: WorkspaceBridge
  ackRequests: AckRequest[]
  setSnapshot: (value: WorkspaceSnapshot) => void
  emit: (event: unknown) => void
}

/** fake 受控桥（镜像 preload 的 platform.workspace，含 hostLifecycle）。 */
function createTransferBridge(input: { context: unknown; snapshot: WorkspaceSnapshot }): BridgeHarness {
  const listeners = new Set<(event: unknown) => void>()
  const state = { context: input.context, snapshot: input.snapshot }
  const harness: BridgeHarness = {
    bridge: null as unknown as WorkspaceBridge,
    ackRequests: [],
    setSnapshot: (value) => { state.snapshot = value },
    emit: (event) => { for (const listener of [...listeners]) listener(event) }
  }
  harness.bridge = {
    getHostContext: async () => state.context,
    getSnapshot: async () => ({ status: 'ok', snapshot: state.snapshot }),
    command: async () => ({ status: 'applied', snapshot: state.snapshot, panelInstanceKey: PANEL_KEY }),
    hostLifecycle: async (request: unknown) => {
      harness.ackRequests.push(request as AckRequest)
      return { accepted: true }
    },
    onEvent: (listener: (event: unknown) => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    }
  } as unknown as WorkspaceBridge
  return harness
}

async function renderRoot(
  bridge: WorkspaceBridge,
  props: Partial<WorkspaceWindowRootProps> = {},
  children?: ReactNode
): Promise<HTMLDivElement> {
  Reflect.set(window, 'platform', { workspace: bridge })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  const current = root
  await act(async () => {
    current.render(createElement(WorkspaceWindowRoot, props as WorkspaceWindowRootProps, children))
  })
  await settle()
  return container
}

/** spy 适配器：release 默认按 P1-03 契约返回 released，显式返回值原样透传（用于失败路径）。 */
function createAdapter(prepare: () => unknown, release: () => unknown): WorkspaceContentAdapter {
  return {
    prepare: vi.fn(async () => await prepare()) as unknown as WorkspaceContentAdapter['prepare'],
    release: vi.fn(async () => {
      const outcome = await release()
      return outcome === undefined ? { status: 'released' as const, acknowledged: true as const } : outcome
    }) as unknown as WorkspaceContentAdapter['release']
  }
}

const sourceAck = (phase: 'source-prepared' | 'source-released', accepted?: boolean) => ({
  operationId: OPERATION_ID, phase,
  ...(accepted === undefined ? {} : { accepted }),
  windowInstanceId: MAIN_WINDOW_ID, hostEpoch: WorkspaceOwnershipPolicy.initialHostEpoch
})

describe('源宿主：prepare → source-prepared → release → source-released', () => {
  it('快照出现本窗承载的飞事务：先 adapter.prepare()，再发送 source-prepared accepted:true（幂等）', async () => {
    const prepare = vi.fn(async () => ({ status: 'ready' as const }))
    const adapter = createAdapter(prepare, async () => undefined)
    const harness = createTransferBridge({ context: mainContext(), snapshot: sourceSnapshot('awaiting-source-prepared', REVISION) })
    await renderRoot(harness.bridge, { registrations: [registration], resolvePanelAdapter: () => adapter }, createElement('div', {}, 'SHELL'))

    expect(prepare).toHaveBeenCalledTimes(1)
    expect(harness.ackRequests).toEqual([sourceAck('source-prepared', true)])

    // 同一相位的重复事件必须幂等：重复 ACK 会污染 ACK 链
    harness.emit({ type: 'container-changing', layoutRevision: REVISION, scope: { panelInstanceKey: PANEL_KEY } })
    await settle()
    expect(prepare).toHaveBeenCalledTimes(1)
    expect(harness.ackRequests).toHaveLength(1)
  })

  it('prepare 未就绪（handoff-required）⇒ source-prepared accepted:false，不静默', async () => {
    const adapter = createAdapter(
      async () => ({ status: 'handoff-required' as const, reason: 'unsaved-content' as const }), async () => undefined
    )
    const harness = createTransferBridge({ context: mainContext(), snapshot: sourceSnapshot('awaiting-source-prepared', REVISION) })
    await renderRoot(harness.bridge, { registrations: [registration], resolvePanelAdapter: () => adapter }, createElement('div', {}, 'SHELL'))
    expect(harness.ackRequests).toEqual([sourceAck('source-prepared', false)])
  })

  it('prepare 抛错（准备失败/超时）⇒ source-prepared accepted:false，绝不让事务悬挂', async () => {
    const adapter = createAdapter(async () => { throw new Error('prepare-timeout') }, async () => undefined)
    const harness = createTransferBridge({ context: mainContext(), snapshot: sourceSnapshot('awaiting-source-prepared', REVISION) })
    await renderRoot(harness.bridge, { registrations: [registration], resolvePanelAdapter: () => adapter }, createElement('div', {}, 'SHELL'))
    expect(harness.ackRequests).toHaveLength(1)
    expect(harness.ackRequests[0]).toMatchObject({ phase: 'source-prepared', accepted: false })
  })

  it('相位推进到 awaiting-source-release：adapter.release() 后发送 source-released（不带 accepted）', async () => {
    const release = vi.fn(async () => undefined)
    const adapter = createAdapter(async () => ({ status: 'ready' as const }), release)
    const harness = createTransferBridge({ context: mainContext(), snapshot: sourceSnapshot('awaiting-source-prepared', REVISION) })
    await renderRoot(harness.bridge, { registrations: [registration], resolvePanelAdapter: () => adapter }, createElement('div', {}, 'SHELL'))
    expect(release).not.toHaveBeenCalled()

    harness.setSnapshot(sourceSnapshot('awaiting-source-release', REVISION + 1))
    harness.emit({ type: 'container-changing', layoutRevision: REVISION + 1, scope: { panelInstanceKey: PANEL_KEY } })
    await settle()
    expect(release).toHaveBeenCalledTimes(1)
    expect(harness.ackRequests).toHaveLength(2)
    expect(harness.ackRequests[1]).toEqual(sourceAck('source-released'))
  })

  it('release 失败 ⇒ 不发任何 ACK（fail closed，绝不冒名 commit）', async () => {
    const adapter = createAdapter(
      async () => ({ status: 'ready' as const }),
      async () => ({ status: 'rejected' as const, reason: 'release-failed' as const })
    )
    const harness = createTransferBridge({ context: mainContext(), snapshot: sourceSnapshot('awaiting-source-release', REVISION) })
    await renderRoot(harness.bridge, { registrations: [registration], resolvePanelAdapter: () => adapter }, createElement('div', {}, 'SHELL'))
    expect(harness.ackRequests).toHaveLength(0)
  })

  it('release 抛错同样 fail closed：绝不发 source-released', async () => {
    const adapter = createAdapter(
      async () => ({ status: 'ready' as const }),
      async () => { throw new Error('release-exploded') }
    )
    const harness = createTransferBridge({ context: mainContext(), snapshot: sourceSnapshot('awaiting-source-release', REVISION) })
    await renderRoot(harness.bridge, { registrations: [registration], resolvePanelAdapter: () => adapter }, createElement('div', {}, 'SHELL'))
    expect(harness.ackRequests).toHaveLength(0)
  })

  it('面板归属别的宿主（身份/epoch 不符）时绝不代发 ACK', async () => {
    const adapter = createAdapter(async () => ({ status: 'ready' as const }), async () => undefined)
    const harness = createTransferBridge({
      context: mainContext(),
      snapshot: sourceSnapshot('awaiting-source-prepared', REVISION, { windowInstanceId: 'window-other', hostEpoch: 3 })
    })
    await renderRoot(harness.bridge, { registrations: [registration], resolvePanelAdapter: () => adapter }, createElement('div', {}, 'SHELL'))
    expect(harness.ackRequests).toHaveLength(0)
  })
})
