// @vitest-environment happy-dom
/**
 * Owner: apps/desktop-shell renderer / shell/navigation。
 * 判据来源：`docs-private/10-development/home-menu-contract.md` §5（壳层改法）与口径 A。
 *
 * 这一层验的是**接线**，不是解析器（解析器在 `homeMenuKey.test.ts`）：
 *  - 首次打开 / 布局被重置 ⇒ 真的**打开**声明了 `home` 的那一页（不是只换个高亮）；
 *  - 有历史 ⇒ 一个字都不动（口径 A 的另一半：不许拿默认首页把「接着上次看」换掉）；
 *  - 用户自己关掉最后一页 ⇒ 不补开（补开就成「关掉立刻弹回来」）。
 *
 * 为什么必须挂真实 `AppShell`：`openTab` 只在壳层里发出。只测解析器的用例，即使壳层一行没接，
 * 也会全绿——那正是这类「字段能写、没人读」最容易混过去的形状。
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createDefaultAppSettings } from '@platform/settings/schema/appSettings'
import { productMenuEntries } from '@products/generated/shellRegistry'

const MAIN_WINDOW_ID = 'main'
const HOST_EPOCH = 1
/** 真实 AppShell 的模块图在 happy-dom 下要几秒（同 `workspaceTabCapabilityReadiness` 的量级）。 */
const APP_SHELL_CASE_TIMEOUT_MS = 30_000
const CONDITION_TIMEOUT_MS = 5_000
const FLUSH_TURNS = 16

/** 生成物里声明了「我是首页」的那个菜单键。没有声明就立刻报错，别让用例静默退化成「谁也没声明」。 */
const declaredHomeKey = productMenuEntries
  .map((entry) => entry as { routePath: string; home?: true })
  .find((entry) => entry.home === true)?.routePath

let root: Root | undefined
let container: HTMLDivElement | undefined

beforeEach(() => {
  // 能力就绪是每个渲染进程一份的模块状态：每个用例都从干净模块图开始，绝不互相污染。
  vi.resetModules()
})

afterEach(async () => {
  if (root !== undefined) {
    const current = root
    root = undefined
    await act(async () => { current.unmount() })
  }
  container = undefined
  document.body.replaceChildren()
  Reflect.deleteProperty(window, 'platform')
})

async function settle(): Promise<void> {
  await act(async () => {
    for (let turn = 0; turn < FLUSH_TURNS; turn += 1) await Promise.resolve()
  })
}

interface TabRecord {
  workspaceInstanceKey: string
  pageId: string
  menuKey: string
  open: boolean
  order: number
  mode: 'main'
  bindingState: 'bound'
  windowInstanceId: string
  hostEpoch: number
}

function emptySnapshot() {
  return {
    layoutRevision: 1, activeWorkspaceInstanceKey: null, panels: [], pageLayouts: [], tabs: [] as TabRecord[],
    recentlyClosedCount: 0, persistenceState: 'saved' as const
  }
}

function tabSnapshot(input: { key: string; pageId: string; menuKey: string }, revision: number) {
  return {
    layoutRevision: revision,
    activeWorkspaceInstanceKey: input.key,
    recentlyClosedCount: 0,
    panels: [],
    pageLayouts: [],
    persistenceState: 'saved' as const,
    tabs: [{
      workspaceInstanceKey: input.key, pageId: input.pageId, menuKey: input.menuKey, open: true, order: 0,
      mode: 'main' as const, bindingState: 'bound' as const,
      windowInstanceId: MAIN_WINDOW_ID, hostEpoch: HOST_EPOCH
    }]
  }
}

type TabsSnapshot = ReturnType<typeof emptySnapshot> | ReturnType<typeof tabSnapshot>

function mainContext(): unknown {
  return {
    status: 'ok',
    context: {
      windowInstanceId: MAIN_WINDOW_ID, hostEpoch: HOST_EPOCH, role: 'main', mounts: [], pendingTransfer: null,
      layoutRevision: 1, pageIds: ['assistants', 'agents', 'settings'],
      preferences: { language: 'en-US', theme: 'dark' }
    }
  }
}

/**
 * 受控面形状的 fake preload：与真 preload 逐方法同构。
 * `snapshot` 是 Main 侧的权威快照，用例可以随时换掉并发一条受控事件（模拟用户关掉最后一页）。
 */
function createSurface(input: { initial: TabsSnapshot }) {
  let snapshot: TabsSnapshot = input.initial
  const openTabRequests: { menuKey?: string }[] = []
  const listeners = new Set<(event: unknown) => void>()

  const workspace = {
    getHostContext: async () => mainContext(),
    getSnapshot: async () => ({ status: 'ok', snapshot: emptySnapshot() }),
    command: async () => ({ status: 'rejected', errorCode: 'invalid-request', snapshot: emptySnapshot() }),
    onEvent: (listener: (event: unknown) => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    tabsGetSnapshot: async () => ({ status: 'ok', snapshot }),
    tabsCommand: async (request: unknown) => {
      const record = request as { method?: string; menuKey?: string }
      if (record.method !== 'openTab') {
        return { status: 'rejected', errorCode: 'invalid-request', snapshot }
      }
      openTabRequests.push({ menuKey: record.menuKey })
      // 应用后 Main 回的权威快照：这一页真的被打开（只换高亮的实现给不出这个快照）。
      snapshot = tabSnapshot(
        { key: 'workspace-tab-landing', pageId: 'landing', menuKey: record.menuKey ?? '' },
        snapshot.layoutRevision + 1
      )
      return { status: 'applied', snapshot }
    },
    tabsHostLifecycle: async () => ({ accepted: true })
  }

  return {
    workspace,
    openTabRequests,
    /** 换掉权威快照并推一条受控事件（模拟 Main 侧变化，客户端会重新权威读取）。 */
    publish: (next: TabsSnapshot) => {
      snapshot = next
      for (const listener of [...listeners]) {
        listener({ type: 'close', layoutRevision: next.layoutRevision })
      }
    }
  }
}

function installShellPlatform(surface: ReturnType<typeof createSurface>): void {
  Reflect.set(window, 'platform', {
    app: {
      getInfo: vi.fn(async () => null),
      getProductSummaries: vi.fn(async () => []),
      openExternal: vi.fn(async () => undefined)
    },
    settings: { get: vi.fn(async () => ({ ...createDefaultAppSettings(), language: 'en-US' })) },
    modelProviders: { list: vi.fn(async () => []), upsert: vi.fn(async () => undefined) },
    assistants: {
      list: vi.fn(async () => []),
      listTopics: vi.fn(async () => ({ topics: [] })),
      listTopicMessages: vi.fn(async () => ({ messages: [] })),
      streamAttach: vi.fn(async () => ({ snapshot: { topicId: '', status: 'idle', executions: [] } })),
      onStreamChunk: vi.fn(() => () => undefined),
      onStreamDone: vi.fn(() => () => undefined),
      onStreamError: vi.fn(() => () => undefined),
      onStreamStatusChanged: vi.fn(() => () => undefined)
    },
    workspace: surface.workspace
  })
}

async function renderShell(surface: ReturnType<typeof createSurface>): Promise<void> {
  installShellPlatform(surface)
  const { AppShell } = await import('../AppShell')
  container = document.createElement('div')
  document.body.append(container)
  const current = createRoot(container)
  root = current
  await act(async () => { current.render(createElement(AppShell)) })
  await settle()
}

describe('默认首页接线（口径 A：只在没有历史时生效）', () => {
  it('生成物里确实有一处 home 声明（没有的话下面两条都会失去意义）', () => {
    expect(declaredHomeKey).toBeDefined()
    expect(declaredHomeKey).not.toBe('assistants')
  })

  it('首次打开（快照里没有活动页）⇒ 真的打开声明了 home 的那一页', { timeout: APP_SHELL_CASE_TIMEOUT_MS }, async () => {
    const surface = createSurface({ initial: emptySnapshot() })
    await renderShell(surface)

    await vi.waitFor(() => { expect(surface.openTabRequests.length).toBe(1) }, { timeout: CONDITION_TIMEOUT_MS })
    // 判据是**菜单键**：等于注册里声明首页的那一页，而不是壳层那个兜底常量。
    expect(surface.openTabRequests[0]).toEqual({ menuKey: declaredHomeKey })
    expect(surface.openTabRequests[0]?.menuKey).not.toBe('assistants')
  })

  it('有历史（快照里有活动页）⇒ 一次 openTab 都不发，接着上次看', { timeout: APP_SHELL_CASE_TIMEOUT_MS }, async () => {
    const surface = createSurface({
      initial: tabSnapshot({ key: 'workspace-tab-settings', pageId: 'settings', menuKey: 'settings' }, 2)
    })
    await renderShell(surface)
    // 给足时间：不是「还没来得及发」，而是这条路径上根本不该发。
    await new Promise((resolve) => setTimeout(resolve, 30))
    await settle()

    expect(surface.openTabRequests).toEqual([])
  })

  it('用户自己关掉最后一页 ⇒ 不补开（补开就成了「关掉立刻弹回首页」）', { timeout: APP_SHELL_CASE_TIMEOUT_MS }, async () => {
    const surface = createSurface({ initial: emptySnapshot() })
    await renderShell(surface)
    await vi.waitFor(() => { expect(surface.openTabRequests.length).toBe(1) }, { timeout: CONDITION_TIMEOUT_MS })

    // Main 侧权威快照变成「一页都没打开」（用户关掉了最后一页）。
    surface.publish({ ...emptySnapshot(), layoutRevision: 9 })
    await settle()
    await new Promise((resolve) => setTimeout(resolve, 30))
    await settle()

    expect(surface.openTabRequests.length).toBe(1)
  })
})
