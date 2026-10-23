// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, useEffect, useMemo, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import type {
  WorkspacePageRegistration,
  WorkspaceTabCommandResult,
  WorkspaceTabState
} from '@platform/workspace/contracts'
import { builtInWorkspacePages, builtInWorkspacePageModuleIds } from '@platform/workspace/registry/builtInWorkspacePages'
import { createWorkspacePageRegistry } from '@platform/workspace/registry/workspacePageRegistry'
import { createWorkspaceTabStore } from '@platform/workspace/runtime/workspaceTabStore'

import { platformText } from '../../i18n/platformText'
import { createShellWorkspacePageRegistry } from '../navigation/workspacePageRegistry'
import { WorkspacePageHost } from './WorkspacePageHost'
import { WorkspaceTabStrip, type WorkspaceTabDraftGuard } from './WorkspaceTabStrip'
import { createWorkspaceTabClient, type WorkspaceTabsBridge } from './workspaceClient'

/**
 * Owner: apps/desktop-shell renderer / workspace（P2-13）。
 *
 * 缺口（P2-12 审计）：Tab 菜单的「重开最近关闭」入口在真机**恒禁用** —— `AppShell` 的
 * `recentlyClosedCount` 只在 `openTab` 时被置 0，受控 Tab 快照里没有该字段，渲染侧因此永远认为
 * 「最近关闭」为空。
 *
 * 本文件是**生产接线**级别的判据：状态**只**来自受控 `.tabs.*` 桥（`createWorkspaceTabClient`），
 * 计数**只**来自 Main 的受控投影字段，renderer 绝不自行从「tab 数量变化」之类推断。
 * 命令走与真机同一条链：strip → `client.port` → `.tabs.command` → 真实 `workspaceTabStore`，
 * 命令被接受后由「Main」发布受控事件（真机＝router.publish）⇒ 渲染侧重取权威快照。
 *
 * 边界：本文件里的 `snapshot()` 是**假 Main**（真机＝`tabWorkspaceIpcHandlers.scopeState`）；
 * 投影的作用域/身份判据由 `platform/desktop/main/workspace/tabWorkspaceIpcHandlers.test.ts` 断言。
 */

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let root: Root | undefined
afterEach(async () => { await act(async () => { root?.unmount() }); root = undefined; document.body.replaceChildren() })

const language = 'en-US' as const
const text = platformText[language]
const labels = text.workspace

const productPage: WorkspacePageRegistration = {
  pageId: 'sample.alpha',
  menuKey: '/sample/alpha',
  title: { 'zh-CN': 'Alpha 页', 'en-US': 'Alpha page' },
  icon: 'home',
  module: 'sample.alpha',
  productId: 'sample',
  supportsDetached: true,
  allowMultipleInstances: true,
  binding: { persistence: 'none', maxKeyBytes: 256 }
}

/**
 * 生产 `AppShell` 的入口禁用判据（逐字同构）：条数**只**取自受控快照，renderer 不做第二次推断。
 * 形状校验（负数/小数/非数字 ⇒ 视为「无」）是 `workspaceClient.readTabSnapshot` 的职责；因此这里
 * 只写 `?? 0`：投影一旦畸形而客户端没有 fail closed，下面的用例就会看到「入口被点亮」。
 */
function readRecentlyClosedCount(state: WorkspaceTabState): number {
  return (state as { recentlyClosedCount?: number }).recentlyClosedCount ?? 0
}

/** 假 Main 的受控投影：真机＝`scopeState`（主窗拿真实条数；作用域收窄见 Main 侧断言文件）。 */
type ProjectedTabState = Omit<WorkspaceTabState, 'recentlyClosedCount'> & { recentlyClosedCount?: unknown }

function fixture(options: { count?: (store: ReturnType<typeof createWorkspaceTabStore>) => unknown } = {}) {
  const registry = createWorkspacePageRegistry({
    moduleIds: [...builtInWorkspacePageModuleIds, 'sample.alpha'],
    productIds: ['sample']
  })
  builtInWorkspacePages.forEach((page) => registry.register(page))
  registry.register(productPage)
  registry.seal()
  let sequence = 0
  const store = createWorkspaceTabStore({
    pageRegistry: registry,
    createOpaqueId: (prefix = 'id') => `${prefix}-${++sequence}`
  })
  const pages = createShellWorkspacePageRegistry({
    language,
    productMenuEntries: [{
      id: 'sample.alpha',
      productId: 'sample',
      productName: { 'zh-CN': '示例', 'en-US': 'Sample' },
      title: productPage.title!,
      icon: 'home',
      order: 1,
      routePath: '/sample/alpha',
      workspace: { supportsDetached: true, allowMultipleInstances: true },
      load: async () => ({})
    }],
    builtInPageLoaders: { assistants: async () => ({}), agents: async () => ({}), settings: async () => ({}) }
  }).list()

  const log: string[] = []
  const listeners = new Set<(event: unknown) => void>()

  const projection = (): ProjectedTabState => {
    const state = store.getSnapshot()
    const raw = options.count === undefined ? store.recentlyClosed().length : options.count(store)
    return { ...state, recentlyClosedCount: raw }
  }

  /** Main 在命令被真实接受后发布的受控事件（只带 type/revision/scope，正文必须回取）。 */
  const publish = (type: 'open' | 'close' | 'restore'): void => {
    const event = Object.freeze({
      type, scope: { workspaceInstanceKey: store.getSnapshot().tabs[0]?.workspaceInstanceKey ?? 'none' },
      layoutRevision: store.getSnapshot().layoutRevision
    })
    for (const listener of [...listeners]) listener(event)
  }

  const bridge: WorkspaceTabsBridge = {
    tabsGetSnapshot: async () => ({ status: 'ok', snapshot: projection(), pendingDetach: null }),
    tabsCommand: async (raw) => {
      const request = raw as {
        method: string
        requestId: string
        pageId?: string
        menuKey?: string
        workspaceInstanceKey?: string
        workspaceInstanceKeys?: readonly string[]
      }
      const common = {
        requestId: request.requestId, requestScope: 'main', hostEpoch: 1,
        expectedRevision: store.getSnapshot().layoutRevision
      }
      let result: WorkspaceTabCommandResult
      switch (request.method) {
        // strip 的「打开页面」按 pageId 发命令（真机里 `menuKey` 由 Main 查注册表解析，此处用不到）
        case 'openTab':
          result = await store.openTab({ ...common, pageId: request.pageId! })
          break
        case 'activateTab':
          result = await store.activateTab({ ...common, workspaceInstanceKey: request.workspaceInstanceKey! })
          break
        case 'closeTab':
          result = await store.closeTab({ ...common, workspaceInstanceKey: request.workspaceInstanceKey! })
          break
        case 'reopenLastClosed':
          result = await store.reopenLastClosed({ ...common })
          break
        default:
          throw new Error(`fake main: unsupported method ${request.method}`)
      }
      log.push(request.method)
      if (result.status === 'applied') {
        publish(request.method === 'openTab' ? 'open' : request.method === 'reopenLastClosed' ? 'restore' : 'close')
      }
      return { ...result, snapshot: projection() }
    },
    onEvent: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    }
  }
  return { store, pages, bridge, log }
}

type Fixture = ReturnType<typeof fixture>

function cleanGuard(): WorkspaceTabDraftGuard {
  return { owner: () => undefined, renderPrompt: () => null }
}

async function renderAvailability(options: Parameters<typeof fixture>[0] = {}) {
  const f = fixture(options)
  const container = document.createElement('div')
  document.body.append(container)

  function Harness(): React.ReactElement {
    const client = useMemo(() => createWorkspaceTabClient(f.bridge), [])
    const [state, setState] = useState<WorkspaceTabState | null>(null)
    useEffect(() => {
      let cancelled = false
      void client.load().then((next) => { if (!cancelled && next !== null) setState(next) })
      const stop = client.observe((next) => { if (!cancelled) setState(next) })
      return () => { cancelled = true; stop(); client.dispose() }
    }, [client])
    if (state === null) return <div data-tab-strip-pending="true" />
    return (
      <WorkspaceTabStrip
        language={language}
        state={state}
        pages={f.pages}
        port={client.port}
        recentlyClosedCount={readRecentlyClosedCount(state)}
        draftGuard={cleanGuard()}>
        <WorkspacePageHost
          language={language}
          state={state}
          renderPage={({ tab }) => <div data-page-view={tab.workspaceInstanceKey} />}
        />
      </WorkspaceTabStrip>
    )
  }

  root = createRoot(container)
  await act(async () => { root!.render(<Harness />) })
  // 受控命令 ⇒ Main 发布事件 ⇒ 渲染侧异步重取快照：连续冲掉微任务，直到 strip 出现
  const settle = async () => { await act(async () => { for (let index = 0; index < 8; index += 1) await Promise.resolve() }) }
  const menuItems = () => Array.from(container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
  const click = async (element: Element | null | undefined) => {
    expect(element ?? null).not.toBeNull()
    await act(async () => { (element as HTMLElement).click() })
    await settle()
  }
  const openPages = async () => {
    if (menuItems().length === 0) await click(container.querySelector<HTMLElement>('[data-tab-strip-open-page]'))
  }
  const openActions = async () => {
    if (menuItems().length === 0) await click(container.querySelector<HTMLElement>('[data-tab-strip-actions]'))
  }
  const openPage = async (label: string) => {
    await openPages()
    await click(menuItems().find((node) => node.textContent === label) ?? null)
  }
  const chooseAction = async (label: string) => {
    await openActions()
    await click(menuItems().find((node) => node.textContent === label) ?? null)
  }
  const reopenItem = async (): Promise<HTMLButtonElement | undefined> => {
    await openActions()
    return menuItems().find((node) => node.textContent === labels.tabReopen)
  }
  const reopenCalls = () => f.log.filter((method) => method === 'reopenLastClosed').length
  return { f, container, settle, openPage, chooseAction, reopenItem, reopenCalls, openTabKeys: () => Array.from(container.querySelectorAll<HTMLElement>('[role="tab"]')).map((tab) => tab.dataset.tabKey) }
}

describe('P2-13：Tab 菜单「重开最近关闭」的可用性由 Main 权威投影驱动', () => {
  it('刚关闭过一个 Tab 后入口可用，且点击恰好触发一次 reopenLastClosed', async () => {
    const ui = await renderAvailability()
    expect(ui.container.querySelector('[data-tab-strip-pending]')).toBeNull()
    await ui.openPage(text.nav.assistants)
    expect(ui.openTabKeys()).toHaveLength(1)
    expect(ui.f.store.recentlyClosed()).toHaveLength(0)

    await ui.chooseAction(labels.tabClose)
    expect(ui.openTabKeys()).toEqual([])
    expect(ui.f.store.recentlyClosed()).toHaveLength(1)

    const reopen = await ui.reopenItem()
    // RED：当前实现下渲染侧拿不到「最近关闭条数」⇒ 恒 disabled
    expect(reopen?.disabled).toBe(false)
    expect(reopen?.getAttribute('aria-disabled')).toBe('false')
    await clickAndCount(ui, reopen)
    expect(ui.reopenCalls()).toBe(1)
    expect(ui.openTabKeys()).toHaveLength(1)
  })

  it('刚关闭过一个 Tab 后，点击该入口必须恰好触发一次 reopenLastClosed', async () => {
    const ui = await renderAvailability()
    await ui.openPage(text.nav.assistants)
    await ui.chooseAction(labels.tabClose)
    expect(ui.f.store.recentlyClosed()).toHaveLength(1)

    const reopen = await ui.reopenItem()
    await clickAndCount(ui, reopen)
    // RED：当前实现下入口恒禁用 ⇒ 命令 0 次
    expect(ui.reopenCalls()).toBe(1)
    expect(ui.openTabKeys()).toHaveLength(1)
  })

  it('无历史时入口禁用并给出可见原因，点击不发命令', async () => {
    const ui = await renderAvailability()
    const reopen = await ui.reopenItem()
    expect(reopen?.disabled).toBe(true)
    expect(reopen?.getAttribute('aria-disabled')).toBe('true')
    expect(reopen?.getAttribute('title')).toBe(labels.tabReopenUnavailable)
    expect(reopen?.getAttribute('aria-description')).toBe(labels.tabReopenUnavailable)
    await ui.settle()
    expect(ui.reopenCalls()).toBe(0)
  })

  it('受控投影畸形（负数/非整数/非数字）按「无」处理：入口保持禁用且绝不发命令', async () => {
    for (const count of [() => -1, () => 1.5, () => 'two', () => null]) {
      const ui = await renderAvailability({ count })
      await ui.openPage(text.nav.assistants)
      await ui.chooseAction(labels.tabClose)
      expect(ui.f.store.recentlyClosed()).toHaveLength(1)
      const reopen = await ui.reopenItem()
      expect(reopen?.disabled).toBe(true)
      expect(reopen?.getAttribute('title')).toBe(labels.tabReopenUnavailable)
      await ui.settle()
      expect(ui.reopenCalls()).toBe(0)
      await act(async () => { root?.unmount() })
      root = undefined
      document.body.replaceChildren()
    }
  })
})

/** 点一下「重开」并冲掉随后的权威重取（命令计数在点击瞬间已由假 Main 记录）。 */
async function clickAndCount(ui: Awaited<ReturnType<typeof renderAvailability>>, element: HTMLElement | undefined) {
  expect(element ?? null).not.toBeNull()
  await act(async () => { (element as HTMLElement).click() })
  await ui.settle()
}

describe('P2-13：AppShell 的入口判据（源码护栏）', () => {
  it('条数只取自受控快照，绝不再用本地 state 自造（恒禁用的旧写法不许回归）', () => {
    const appShell = readFileSync(resolve(process.cwd(), 'apps/desktop-shell/src/renderer/src/shell/AppShell.tsx'), 'utf8')
    // 生产判据：解析后的权威快照字段 → 入口禁用态
    expect(appShell).toContain('recentlyClosedCount={state.recentlyClosedCount ?? 0}')
    // 旧根因：本地 0 起手、只在 openTab 时归零 ⇒ 关闭后入口永远拿不到「有可重开项」
    expect(appShell).not.toContain('setRecentlyClosedCount')
    // 也不许把条数换成 renderer 自行推断的任何来源
    expect(appShell).not.toMatch(/recentlyClosedCount=\{(?!state\.recentlyClosedCount)/u)
  })
})
