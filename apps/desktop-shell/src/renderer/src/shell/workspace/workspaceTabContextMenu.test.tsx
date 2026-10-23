// @vitest-environment happy-dom
import { act, useMemo, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import type { WorkspaceTabCommandResult, WorkspaceTabState } from '@platform/workspace/contracts'
import { builtInWorkspacePageModuleIds, builtInWorkspacePages } from '@platform/workspace/registry/builtInWorkspacePages'
import { createWorkspacePageRegistry } from '@platform/workspace/registry/workspacePageRegistry'
import { createWorkspaceTabStore } from '@platform/workspace/runtime/workspaceTabStore'

import { platformText } from '../../i18n/platformText'
import { createShellWorkspacePageRegistry } from '../navigation/workspacePageRegistry'
import {
  WorkspaceTabStrip,
  type WorkspaceTabDraftGuard,
  type WorkspaceTabPageDescriptor,
  type WorkspaceTabPort
} from './WorkspaceTabStrip'

/**
 * Owner: apps/desktop-shell renderer / workspace Tab 右键上下文菜单（P2-15）。
 * 权威：A-T08「控件可发现、ARIA 正确、键盘可达」+ 用户实测「我右键 tab 没用啊」。
 *
 * 缺陷（本包 RED 的对象）：Tab 上**没有任何** `contextmenu` 入口 —— `WorkspaceTabStrip` 此前只在
 * `onClick`/`onKeyDown` 接语义，右键既不打开菜单也不报错（浏览器/Electron 里右键完全无反应）。
 * 本文件只用既有 `WorkspaceTabMenu` 的呈现与键盘语义取证，不引入第二套菜单。
 */

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let root: Root | undefined
afterEach(async () => { await act(async () => { root?.unmount() }); root = undefined; document.body.replaceChildren() })

const language = 'en-US' as const
const text = platformText[language]
const labels = text.workspace
const AGENTS_LABEL = text.nav.agents

/** shell 投影的独立构造（测试用它覆盖「页面/实例不支持分离」的受控描述，不改 Main 注册表）。 */
function shellPages(): readonly WorkspaceTabPageDescriptor[] {
  return createShellWorkspacePageRegistry({
    language,
    productMenuEntries: [],
    builtInPageLoaders: { assistants: async () => ({}), agents: async () => ({}), settings: async () => ({}) }
  }).list()
}

function fixture() {
  const registry = createWorkspacePageRegistry({ moduleIds: [...builtInWorkspacePageModuleIds] })
  builtInWorkspacePages.forEach((page) => registry.register(page))
  registry.seal()
  let sequence = 0
  const store = createWorkspaceTabStore({
    pageRegistry: registry,
    createOpaqueId: (prefix = 'id') => `${prefix}-${++sequence}`
  })
  const pages = shellPages()
  let request = 0
  const mutate = () => ({
    requestScope: 'main',
    hostEpoch: 1,
    requestId: `req-${++request}`,
    expectedRevision: store.getSnapshot().layoutRevision
  })
  return { store, pages, mutate }
}

type Fixture = ReturnType<typeof fixture>

/** typed port：唯一命令出口；`log` 记录调用点（用来断言「分离恰一次」「禁用项零命令」）。 */
function createPort(f: Fixture, log: string[], onApplied: () => void): WorkspaceTabPort {
  const wrap = async (method: string, run: () => Promise<WorkspaceTabCommandResult>) => {
    log.push(method)
    const result = await run()
    onApplied()
    return result
  }
  return {
    openTab: (input) => wrap('openTab', () => f.store.openTab({ ...f.mutate(), ...input })),
    activateTab: (input) => wrap('activateTab', () => f.store.activateTab({ ...f.mutate(), ...input })),
    closeTab: (input) => wrap('closeTab', () => f.store.closeTab({ ...f.mutate(), ...input })),
    closeOthers: (input) => wrap('closeOthers', () => f.store.closeOthers({ ...f.mutate(), ...input })),
    closeRight: (input) => wrap('closeRight', () => f.store.closeRight({ ...f.mutate(), ...input })),
    reopenLastClosed: () => wrap('reopenLastClosed', () => f.store.reopenLastClosed({ ...f.mutate() })),
    reorderTabs: (input) => wrap('reorderTabs', () => f.store.reorderTabs({ ...f.mutate(), ...input })),
    detachTab: (input) => wrap('detachTab', () => f.store.detachTab({ ...f.mutate(), ...input }))
  }
}

const cleanGuard: WorkspaceTabDraftGuard = { owner: () => undefined, renderPrompt: () => null }

function withDetachSupport(pages: readonly WorkspaceTabPageDescriptor[], supportsDetached: boolean): readonly WorkspaceTabPageDescriptor[] {
  return pages.map((page) => (page.pageId === 'agents' ? { ...page, supportsDetached } : { ...page }))
}

async function renderStrip(options: {
  pages?: readonly WorkspaceTabPageDescriptor[]
  prepare?: (f: Fixture) => Promise<void>
} = {}) {
  const f = fixture()
  if (options.prepare) await options.prepare(f)
  const log: string[] = []
  const container = document.createElement('div')
  document.body.append(container)
  function Harness(): React.ReactElement {
    const [state, setState] = useState<WorkspaceTabState>(() => f.store.getSnapshot())
    const port = useMemo(() => createPort(f, log, () => setState(f.store.getSnapshot())), [])
    return (
      <WorkspaceTabStrip
        language={language}
        state={state}
        pages={options.pages ?? f.pages}
        port={port}
        recentlyClosedCount={f.store.recentlyClosed().length}
        draftGuard={cleanGuard}
      />
    )
  }
  root = createRoot(container)
  await act(async () => { root!.render(<Harness />) })
  const openPage = async (label: string) => {
    if (menuItems(container).length === 0) await click(container.querySelector<HTMLElement>('[data-tab-strip-open-page]'))
    await click(menuItems(container).find((node) => node.textContent === label) ?? null)
  }
  const tabEl = (key: string | undefined) => (key === undefined
    ? null
    : container.querySelector<HTMLElement>(`[role="tab"][data-tab-key="${key}"]`))
  const openTabKeys = () => Array.from(container.querySelectorAll<HTMLElement>('[role="tab"]')).map((tab) => tab.dataset.tabKey)
  return { f, log, container, openPage, tabEl, openTabKeys }
}

function menuItems(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[role="menuitem"]'))
}

function detachItem(container: HTMLElement): HTMLElement | undefined {
  return menuItems(container).find((node) => node.textContent === labels.tabDetach)
}

async function click(element: Element | null | undefined) {
  expect(element ?? null).not.toBeNull()
  await act(async () => { (element as HTMLElement).click() })
}

async function keydown(element: Element | null | undefined, init: KeyboardEventInit) {
  expect(element ?? null).not.toBeNull()
  await act(async () => {
    ;(element as Element).dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }))
  })
}

async function contextMenu(element: Element | null | undefined) {
  expect(element ?? null).not.toBeNull()
  await act(async () => {
    ;(element as Element).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 60 }))
  })
}

async function focus(element: Element | null | undefined) {
  await act(async () => { (element as HTMLElement | null)?.focus() })
}

describe('P2-15：Tab 右键上下文菜单（用户实测「右键 tab 没用」）', () => {
  it('① 对 Tab 触发 contextmenu 即出现菜单（此前右键没有任何入口）', async () => {
    const ui = await renderStrip()
    await ui.openPage(AGENTS_LABEL)
    const [key] = ui.openTabKeys()
    expect(ui.container.querySelector('[role="menu"]')).toBeNull()
    await contextMenu(ui.tabEl(key))
    expect(ui.container.querySelector('[role="menu"]')).not.toBeNull()
    expect(menuItems(ui.container).map((node) => node.textContent)).toEqual(expect.arrayContaining([
      labels.tabClose, labels.tabCloseOthers, labels.tabCloseRight, labels.tabReopen, labels.tabDetach
    ]))
    // 触发器是 Tab 本身：ARIA 必须如实反映展开态
    expect(ui.tabEl(key)?.getAttribute('aria-haspopup')).toBe('menu')
    expect(ui.tabEl(key)?.getAttribute('aria-expanded')).toBe('true')
  })

  it('② 菜单含「分离到新窗口」：点击后 detachTab 恰一次、参数为该 Tab 的键', async () => {
    expect(typeof labels.tabDetach).toBe('string')
    const ui = await renderStrip()
    await ui.openPage(AGENTS_LABEL)
    const [key] = ui.openTabKeys()
    await contextMenu(ui.tabEl(key))
    const item = detachItem(ui.container)
    expect(item).not.toBeUndefined()
    expect(item?.getAttribute('aria-disabled')).toBe('false')
    await click(item)
    expect(ui.log.filter((method) => method === 'detachTab')).toEqual(['detachTab'])
    expect(ui.f.store.getSnapshot().tabs.find((tab) => tab.workspaceInstanceKey === key)?.mode).toBe('detached')
  })

  it('③-1 页面声明不支持分离 ⇒ 该项禁用并给出可见原因，点击零命令', async () => {
    const ui = await renderStrip({ pages: withDetachSupport(shellPages(), false) })
    await ui.openPage(AGENTS_LABEL)
    const [key] = ui.openTabKeys()
    await contextMenu(ui.tabEl(key))
    const item = detachItem(ui.container)
    expect(item).not.toBeUndefined()
    expect(item?.getAttribute('aria-disabled')).toBe('true')
    expect(item?.getAttribute('title')).toBe(labels.tabDetachUnsupported)
    ui.log.length = 0
    await click(item)
    expect(ui.log).toEqual([])
  })

  it('③-2 已在独立窗口的实例 ⇒ 该项禁用并给出可见原因，点击零命令', async () => {
    const ui = await renderStrip({
      prepare: async (f) => {
        const opened = await f.store.openTab({ ...f.mutate(), pageId: 'agents' })
        const key = opened.snapshot.tabs.find((tab) => tab.pageId === 'agents')!.workspaceInstanceKey
        await f.store.detachTab({ ...f.mutate(), workspaceInstanceKey: key })
      }
    })
    const [key] = ui.openTabKeys()
    expect(ui.f.store.getSnapshot().tabs.find((tab) => tab.workspaceInstanceKey === key)?.mode).toBe('detached')
    await contextMenu(ui.tabEl(key))
    const item = detachItem(ui.container)
    expect(item?.getAttribute('aria-disabled')).toBe('true')
    expect(item?.getAttribute('title')).toBe(labels.tabDetachAlreadyDetached)
    ui.log.length = 0
    await click(item)
    expect(ui.log).toEqual([])
  })

  it('④ Shift+F10（ContextMenu 键）也能打开菜单；Esc 关闭并把焦点还给该 Tab', async () => {
    const ui = await renderStrip()
    await ui.openPage(AGENTS_LABEL)
    const [key] = ui.openTabKeys()
    const tab = ui.tabEl(key)
    await focus(tab)
    await keydown(tab, { key: 'F10', shiftKey: true })
    expect(ui.container.querySelector('[role="menu"]')).not.toBeNull()
    // 上下文菜单必须把键盘焦点移入菜单，否则 Esc/方向键落在 Tab 上（菜单形同虚设）
    expect(ui.container.querySelector('[role="menu"]')?.contains(document.activeElement)).toBe(true)
    await keydown(document.activeElement, { key: 'Escape' })
    expect(ui.container.querySelector('[role="menu"]')).toBeNull()
    expect(document.activeElement).toBe(ui.tabEl(key))
    expect(ui.tabEl(key)?.getAttribute('aria-expanded')).toBe('false')
    // ContextMenu 键是同一入口的第二条键盘路径
    await keydown(ui.tabEl(key), { key: 'ContextMenu' })
    expect(ui.container.querySelector('[role="menu"]')).not.toBeNull()
  })
})
