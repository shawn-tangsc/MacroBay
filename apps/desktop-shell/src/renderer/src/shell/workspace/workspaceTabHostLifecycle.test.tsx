// @vitest-environment happy-dom
/**
 * Owner: apps/desktop-shell renderer / workspace **独立页面窗**的 `.tabs.*` host-lifecycle ACK 链（P2-07）。
 * 回归：本文件（focused）。
 *
 * 权威：P2-06 真机缺陷 B1 —— 页窗分支（`readWorkspaceTabsBridge()` ⇒ `status:'page'`）此前从不经
 * `.tabs.hostLifecycle` 报 `target-ready`，于是 Main 的分离事务恒停在 awaiting-ready，10s 后按
 * `window-load-failed` 回滚并销毁真实窗口（主窗事件序 open → container-change-requested → fallback）。
 *
 * 本文件只注入 fake preload `window.platform.workspace`（含 `.tabs.*`）：不启动 Electron、不读真实
 * profile/userData、不加载产品模块。断言：
 *  - 页窗状态机确实调用 `tabsHostLifecycle('target-ready')` **恰一次**（StrictMode 双调用 + 重复事件下仍一次）；
 *  - ACK 的 operationId 只能来自**受控** `.tabs.*` 投影（不从 URL/localStorage/事件推断）；
 *  - 非目标窗（身份/epoch 不一致）、畸形投影、缺少 ACK 能力一律 fail closed（零 ACK）。
 */
import { act, createElement, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import type { WorkspaceSnapshot } from '@platform/workspace/contracts'
import { WorkspaceWindowRoot, type WorkspaceWindowRootProps } from './WorkspaceWindowRoot'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const FLUSH_TURNS = 16
const PAGE_WINDOW_ID = 'window-page-1'
const PAGE_EPOCH = 2
const OTHER_WINDOW_ID = 'window-someone-else'
const TAB_KEY = 'ws-page-1'
const PAGE_ID = 'agents'
const OPERATION_ID = 'main:req-detach'
const TAB_REVISION = 3

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

/** 页窗的受控宿主上下文：mounts 恒空（页面窗不承载面板），pendingTransfer 与页面无关。 */
function pageContext(input: { windowInstanceId?: string; hostEpoch?: number } = {}): unknown {
  return {
    status: 'ok',
    context: {
      windowInstanceId: input.windowInstanceId ?? PAGE_WINDOW_ID,
      hostEpoch: input.hostEpoch ?? PAGE_EPOCH,
      role: 'panel',
      mounts: [],
      pendingTransfer: null,
      layoutRevision: 1,
      pageIds: [PAGE_ID],
      preferences: { language: 'en-US', theme: 'system' }
    }
  }
}

function emptySnapshot(): WorkspaceSnapshot {
  return {
    layoutRevision: 1, activeWorkspaceInstanceKey: null, panels: [], pageLayouts: [], tabs: [], persistenceState: 'saved'
  }
}

function tabEntry(input: { windowInstanceId?: string; hostEpoch?: number } = {}) {
  return {
    workspaceInstanceKey: TAB_KEY, pageId: PAGE_ID, menuKey: PAGE_ID, open: true, order: 0,
    mode: 'detached', bindingState: 'bound',
    windowInstanceId: input.windowInstanceId ?? PAGE_WINDOW_ID,
    hostEpoch: input.hostEpoch ?? PAGE_EPOCH
  }
}

/** 受控待 ACK 投影（Main 侧 `.tabs.getSnapshot` 的 additive 字段）。`undefined` = 字段缺失。 */
function pendingDetach(input: { operationId?: string; windowInstanceId?: string; hostEpoch?: number } = {}) {
  return {
    operationId: input.operationId ?? OPERATION_ID,
    windowInstanceId: input.windowInstanceId ?? PAGE_WINDOW_ID,
    hostEpoch: input.hostEpoch ?? PAGE_EPOCH
  }
}

type AckRequest = Record<string, unknown>
type AckOutcome = { accepted: boolean; reason?: string }

function createTabPageBridge(input: {
  withTabsHostLifecycle?: boolean
  pending?: unknown
  tab?: ReturnType<typeof tabEntry>
} = {}) {
  const listeners = new Set<(event: unknown) => void>()
  let pending: unknown = input.pending === undefined ? pendingDetach() : input.pending
  const state = {
    tab: input.tab ?? tabEntry(), ackRequests: [] as AckRequest[], tabSnapshotCalls: 0,
    unsubscribes: 0, ackOutcome: { accepted: true } as AckOutcome | ((request: AckRequest) => AckOutcome)
  }
  const base = {
    getHostContext: async () => pageContext(),
    getSnapshot: async () => ({ status: 'ok', snapshot: emptySnapshot() }),
    command: async () => ({ status: 'rejected', errorCode: 'invalid-request', snapshot: emptySnapshot(), panelInstanceKey: 'p' }),
    tabsGetSnapshot: async () => {
      state.tabSnapshotCalls += 1
      return {
        status: 'ok',
        snapshot: { layoutRevision: TAB_REVISION, activeWorkspaceInstanceKey: TAB_KEY, tabs: [state.tab] },
        ...(pending === undefined ? {} : { pendingDetach: pending })
      }
    },
    tabsCommand: async () => ({ status: 'rejected', errorCode: 'invalid-request', snapshot: { layoutRevision: TAB_REVISION, activeWorkspaceInstanceKey: null, tabs: [] } }),
    onEvent: (listener: (event: unknown) => void) => {
      listeners.add(listener)
      return () => { state.unsubscribes += 1; listeners.delete(listener) }
    }
  }
  const bridge = (input.withTabsHostLifecycle === false ? base : {
    ...base,
    tabsHostLifecycle: async (request: unknown) => {
      const record = request as AckRequest
      state.ackRequests.push(record)
      return typeof state.ackOutcome === 'function' ? state.ackOutcome(record) : state.ackOutcome
    }
  })
  return {
    bridge,
    state,
    setPending: (value: unknown) => { pending = value },
    setAckOutcome: (value: AckOutcome | ((request: AckRequest) => AckOutcome)) => { state.ackOutcome = value },
    emit: (event: unknown) => { for (const listener of [...listeners]) listener(event) },
    listenerCount: () => listeners.size
  }
}

async function renderPageWindow(bridge: unknown): Promise<HTMLDivElement> {
  Reflect.set(window, 'platform', { workspace: bridge })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  const current = root
  // 真实 dev 渲染器就是 StrictMode：页窗 ACK 链必须对 effect 双调用幂等
  await act(async () => {
    current.render(createElement(StrictMode, null, createElement(WorkspaceWindowRoot, {} as WorkspaceWindowRootProps)))
  })
  await settle()
  return container
}

describe('P2-07 页窗 ACK：受控 .tabs.* 投影 → target-ready 恰一次', () => {
  it('页窗渲染后从受控投影拿到 operationId，并只报一次 target-ready（StrictMode 双调用亦然）', async () => {
    const harness = createTabPageBridge()
    const host = await renderPageWindow(harness.bridge)

    // 角色判定仍是页窗（不是错误壳）
    expect(host.querySelector('[data-window-shell="page"]')).not.toBeNull()
    expect(host.querySelector('[data-window-shell="error"]')).toBeNull()

    expect(harness.state.ackRequests).toEqual([{
      operationId: OPERATION_ID, phase: 'target-ready', windowInstanceId: PAGE_WINDOW_ID, hostEpoch: PAGE_EPOCH
    }])
  })

  it('重复事件（snapshot/container-changed）与反复重取都不得重复 ACK，且投影消失后也不再 ACK', async () => {
    const harness = createTabPageBridge()
    await renderPageWindow(harness.bridge)
    expect(harness.state.ackRequests).toHaveLength(1)

    for (const type of ['snapshot', 'container-changing', 'container-changed', 'open']) {
      harness.emit({ type, layoutRevision: TAB_REVISION + 1, scope: { workspaceInstanceKey: TAB_KEY } })
      await settle()
    }
    expect(harness.state.ackRequests).toHaveLength(1)

    // 提交后 Main 不再给待 ACK 投影：页窗保持自己的正文，且绝不补发 ACK
    harness.setPending(undefined)
    harness.emit({ type: 'container-changed', layoutRevision: TAB_REVISION + 2, scope: { workspaceInstanceKey: TAB_KEY } })
    await settle()
    expect(harness.state.ackRequests).toHaveLength(1)
    expect(harness.state.tabSnapshotCalls).toBeGreaterThan(1)
  })

  it('投影身份与自己的受控上下文不一致（非目标窗/陈旧 epoch）⇒ 零 ACK，仍收敛到安全错误壳之外的页窗正文', async () => {
    for (const forged of [
      pendingDetach({ windowInstanceId: OTHER_WINDOW_ID }),
      pendingDetach({ hostEpoch: PAGE_EPOCH + 1 })
    ]) {
      const harness = createTabPageBridge({ pending: forged })
      const host = await renderPageWindow(harness.bridge)
      expect(harness.state.ackRequests).toEqual([])
      // 归属判定只看受控 tab 快照：页窗仍渲染自己的正文，绝不因此变成 error-shell
      expect(host.querySelector('[data-window-shell="page"]')).not.toBeNull()
      const current = root
      root = undefined
      await act(async () => { current?.unmount() })
    }
  })

  it('畸形投影（缺 operationId/超长/非法形状）一律视为「没有可 ACK 的事务」', async () => {
    for (const malformed of [
      { windowInstanceId: PAGE_WINDOW_ID, hostEpoch: PAGE_EPOCH },
      { operationId: '', windowInstanceId: PAGE_WINDOW_ID, hostEpoch: PAGE_EPOCH },
      { operationId: 'x'.repeat(201), windowInstanceId: PAGE_WINDOW_ID, hostEpoch: PAGE_EPOCH },
      { operationId: 42, windowInstanceId: PAGE_WINDOW_ID, hostEpoch: PAGE_EPOCH }
    ]) {
      const harness = createTabPageBridge({ pending: malformed })
      await renderPageWindow(harness.bridge)
      expect(harness.state.ackRequests).toEqual([])
      const current = root
      root = undefined
      await act(async () => { current?.unmount() })
    }
  })

  it('桥没有 .tabs.hostLifecycle 能力时绝不假装 ready（fail closed，零 ACK）', async () => {
    const harness = createTabPageBridge({ withTabsHostLifecycle: false })
    const host = await renderPageWindow(harness.bridge)
    expect(harness.state.ackRequests).toEqual([])
    expect(host.querySelector('[data-window-shell="page"]')).not.toBeNull()
  })

  it('ACK 被 Main 拒绝（迟到/未知 operation）时不重试、不伪造后续相位，页窗保持正文', async () => {
    const harness = createTabPageBridge()
    harness.setAckOutcome({ accepted: false, reason: 'unknown-operation' })
    const host = await renderPageWindow(harness.bridge)
    expect(harness.state.ackRequests).toHaveLength(1)
    harness.emit({ type: 'container-changed', layoutRevision: TAB_REVISION + 1, scope: { workspaceInstanceKey: TAB_KEY } })
    await settle()
    expect(harness.state.ackRequests).toHaveLength(1)
    expect(host.querySelector('[data-window-shell="page"]')).not.toBeNull()
    // 只发 target-ready：renderer 绝不自造 source-released/source-invalid 相位
    expect(harness.state.ackRequests.every((request) => request.phase === 'target-ready')).toBe(true)
  })

  it('卸载即退订：不残留 .tabs 订阅，也不再有任何 ACK', async () => {
    const harness = createTabPageBridge()
    await renderPageWindow(harness.bridge)
    expect(harness.listenerCount()).toBe(1)
    const current = root
    root = undefined
    await act(async () => { current?.unmount() })
    expect(harness.listenerCount()).toBe(0)
    harness.emit({ type: 'container-changed', layoutRevision: TAB_REVISION + 3, scope: { workspaceInstanceKey: TAB_KEY } })
    await settle()
    expect(harness.state.ackRequests).toHaveLength(1)
  })
})
