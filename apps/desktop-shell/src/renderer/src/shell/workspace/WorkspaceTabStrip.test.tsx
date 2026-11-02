// @vitest-environment happy-dom
import { act, useEffect, useMemo, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

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
import { WorkspaceTabStrip, type WorkspaceTabDraftGuard, type WorkspaceTabPort } from './WorkspaceTabStrip'
import type { WorkspaceDraftDecision, WorkspaceDraftOwnerPort, WorkspaceDraftProbe } from './workspaceDraftGate'

/**
 * Owner: apps/desktop-shell renderer / workspace 顶部 Tab Strip（P2-02）。
 * 权威：技术设计 §3（一个 workspaceInstanceKey = 一个逻辑页面）、§5.4（Tab 视图）、
 * A-T02「关闭/重开/其他/右侧/排序/最后 Tab：状态、顺序、焦点正确；最后 Tab 后空工作区仍可打开菜单」、
 * A-T08「键盘可达、ARIA 正确」。
 *
 * fake runtime = 真实 P2-01 `workspaceTabStore` + 真实注册表，只把 IPC/窗口换成 typed port；
 * renderer **不**维护第二份 tab/布局状态（strip 只消费受控 `state` 快照）。
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

function fixture() {
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

/** typed port：唯一命令出口；`log` 记录调用点，用来断言「不误触发」「取消不部分关闭」。 */
function createPort(
  f: Fixture,
  log: string[],
  onApplied: () => void,
  hooks: { failNext?: () => boolean; stale?: () => boolean } = {}
): WorkspaceTabPort {
  // 可选：故意用过陈 revision 触发权威拒绝（证明拒绝词表不进入 UI 文案）
  const mutate = () => (hooks.stale?.() ? { ...f.mutate(), expectedRevision: 0 } : f.mutate())
  const wrap = async (method: string, run: () => Promise<WorkspaceTabCommandResult>) => {
    log.push(method)
    if (hooks.failNext?.()) throw new Error('private transport failure payload')
    const result = await run()
    onApplied()
    return result
  }
  return {
    openTab: (input) => wrap('openTab', () => f.store.openTab({ ...mutate(), ...input })),
    activateTab: (input) => wrap('activateTab', () => f.store.activateTab({ ...mutate(), ...input })),
    closeTab: (input) => wrap('closeTab', () => f.store.closeTab({ ...mutate(), ...input })),
    closeOthers: (input) => wrap('closeOthers', () => f.store.closeOthers({ ...mutate(), ...input })),
    closeRight: (input) => wrap('closeRight', () => f.store.closeRight({ ...mutate(), ...input })),
    reopenLastClosed: () => wrap('reopenLastClosed', () => f.store.reopenLastClosed({ ...mutate() })),
    reorderTabs: (input) => wrap('reorderTabs', () => f.store.reorderTabs({ ...mutate(), ...input })),
    detachTab: (input) => wrap('detachTab', () => f.store.detachTab({ ...mutate(), ...input }))
  }
}

/** 真实草稿 owner：probe 读活状态；测试用它证明 strip 只通过 owner 端口判断草稿。 */
function liveOwner(sensitivity: 'safe' | 'sensitive', failSave = false): WorkspaceDraftOwnerPort & { draft: string; saves: number; discards: number } {
  const owner = {
    draft: 'draft-body',
    saves: 0,
    discards: 0,
    probe: vi.fn((): WorkspaceDraftProbe => (owner.draft === ''
      ? { status: 'clean' }
      : { status: 'dirty', sensitivity })),
    save: vi.fn(async () => {
      if (failSave) throw new Error('private save failure payload')
      owner.saves += 1
      owner.draft = ''
    }),
    discard: vi.fn(() => { owner.discards += 1; owner.draft = '' })
  }
  return owner
}

/** P2-10③：草稿门是必填 prop ⇒ 未显式注入的用例统一用「任何实例都无草稿」的干净 guard。 */
function cleanGuard(): WorkspaceTabDraftGuard {
  return { owner: () => undefined, renderPrompt: () => null }
}

function fakeGuard(owners: Map<string, WorkspaceDraftOwnerPort>): WorkspaceTabDraftGuard {
  return {
    owner: (key) => owners.get(key),
    renderPrompt: ({ probe, pending, onDecision }) => (
      <div data-draft-prompt={probe.sensitivity}>
        <button type="button" disabled={pending} onClick={() => onDecision('save')}>{labels.draftGateSave}</button>
        <button type="button" disabled={pending} onClick={() => onDecision('discard')}>{labels.draftGateDiscard}</button>
        <button type="button" disabled={pending} onClick={() => onDecision('cancel')}>{labels.draftGateCancel}</button>
      </div>
    )
  }
}

async function renderStrip(options: {
  guard?: WorkspaceTabDraftGuard
  failNext?: () => boolean
  stale?: () => boolean
  /** 覆盖 shell 投影：用来模拟「Main 注册与 shell loader 不一致」。 */
  pages?: ReturnType<typeof fixture>['pages']
  /** 首帧前预置权威状态（直接从 store 打开，不经 UI）。 */
  prepare?: (f: Fixture) => Promise<void>
} = {}) {
  const f = fixture()
  if (options.prepare) await options.prepare(f)
  const log: string[] = []
  const mounts: string[] = []
  const container = document.createElement('div')
  document.body.append(container)
  function PageView(props: { instanceKey: string }): React.ReactElement {
    useEffect(() => { mounts.push(props.instanceKey) }, [props.instanceKey])
    return <div data-page-view={props.instanceKey}><input aria-label={`draft-${props.instanceKey}`} /></div>
  }
  function Harness(): React.ReactElement {
    const [state, setState] = useState<WorkspaceTabState>(() => f.store.getSnapshot())
    const port = useMemo(
      () => createPort(f, log, () => setState(f.store.getSnapshot()), options),
      []
    )
    return (
      <WorkspaceTabStrip
        language={language}
        state={state}
        pages={options.pages ?? f.pages}
        port={port}
        recentlyClosedCount={f.store.recentlyClosed().length}
        draftGuard={options.guard ?? cleanGuard()}>
        <WorkspacePageHost
          language={language}
          state={state}
          renderPage={(input) => <PageView instanceKey={input.tab.workspaceInstanceKey} />}
        />
      </WorkspaceTabStrip>
    )
  }
  root = createRoot(container)
  await act(async () => { root!.render(<Harness />) })
  const open = async (label: string) => {
    if (menuItems(container).length === 0) await click(container.querySelector<HTMLElement>('[data-tab-strip-open-page]'))
    const item = menuItems(container).find((node) => node.textContent === label)
    await click(item ?? null)
  }
  const openActions = async () => {
    if (menuItems(container).length === 0) await click(container.querySelector<HTMLElement>('[data-tab-strip-actions]'))
  }
  const chooseAction = async (label: string) => {
    await openActions()
    await click(menuItems(container).find((node) => node.textContent === label) ?? null)
  }
  const tabEl = (key: string | undefined) => (key === undefined
    ? null
    : container.querySelector<HTMLElement>(`[role="tab"][data-tab-key="${key}"]`))
  const panelEl = (key: string | undefined) => (key === undefined
    ? null
    : container.querySelector<HTMLElement>(`[data-workspace-tab="${key}"]`))
  const openTabs = () => Array.from(container.querySelectorAll<HTMLElement>('[role="tab"]'))
  const openTabKeys = () => openTabs().map((tab) => tab.dataset.tabKey)
  return { f, log, mounts, container, open, openActions, chooseAction, tabEl, panelEl, openTabs, openTabKeys, labels }
}

function menuItems(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[role="menuitem"]'))
}

async function click(element: Element | null | undefined) {
  expect(element ?? null).not.toBeNull()
  await act(async () => { (element as HTMLElement).click() })
}

async function keydown(element: Element | null | undefined, init: KeyboardEventInit) {
  expect(element ?? null).not.toBeNull()
  await act(async () => {
    (element as Element).dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }))
  })
}

async function focus(element: Element | null | undefined) {
  await act(async () => { (element as HTMLElement).focus() })
}

describe('WorkspaceTabStrip：语义、状态与切换保留', () => {
  it('exposes tablist/tab semantics that point at the hosted tabpanels', async () => {
    const ui = await renderStrip()
    await ui.open(text.nav.assistants)
    await ui.open(text.nav.agents)
    const [first, second] = ui.openTabKeys()
    expect(ui.container.querySelector('[role="tablist"]')?.getAttribute('aria-label')).toBe(labels.tabStrip)
    expect(ui.tabEl(first!)?.getAttribute('aria-controls')).toBe(ui.panelEl(first!)?.id)
    expect(ui.tabEl(first!)?.getAttribute('aria-selected')).toBe('false')
    expect(ui.tabEl(second!)?.getAttribute('aria-selected')).toBe('true')
    expect(ui.tabEl(first!)?.tabIndex).toBe(-1)
    expect(ui.tabEl(second!)?.tabIndex).toBe(0)

    await click(ui.tabEl(first))
    expect(ui.panelEl(first!)?.hidden).toBe(false)
    expect(ui.panelEl(second!)?.hidden).toBe(true)
    expect(ui.tabEl(first!)?.getAttribute('aria-selected')).toBe('true')
  })

  it('keeps page state when switching tabs through the strip (no remount, no lost draft)', async () => {
    const ui = await renderStrip()
    await ui.open(text.nav.assistants)
    await ui.open(text.nav.agents)
    const [assistants, agents] = ui.openTabKeys()
    const input = ui.panelEl(assistants!)!.querySelector<HTMLInputElement>('input')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'assistant draft')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click(ui.tabEl(agents))
    expect(ui.panelEl(assistants!)?.hidden).toBe(true)
    await click(ui.tabEl(assistants))
    expect(ui.mounts.filter((key) => key === assistants)).toHaveLength(1)
    expect(ui.panelEl(assistants!)!.querySelector('input')).toBe(input)
    expect(input.value).toBe('assistant draft')
  })

  it('stops the strip from acting twice on a repeated activation of the same tab', async () => {
    const ui = await renderStrip()
    await ui.open(text.nav.assistants)
    const [only] = ui.openTabKeys()
    await click(ui.tabEl(only))
    await click(ui.tabEl(only))
    expect(ui.f.store.getSnapshot().activeWorkspaceInstanceKey).toBe(only)
    expect(ui.f.store.getSnapshot().tabs).toHaveLength(1)
  })

  it('labels a tab whose page is missing from the shell projection without hiding it', async () => {
    // Main 注册里存在 agents，但 shell loader 投影缺项：Tab 仍必须可见、可聚焦、可关闭
    const ui = await renderStrip({
      prepare: async (f) => { await f.store.openTab({ ...f.mutate(), pageId: 'agents' }) },
      pages: [] as ReturnType<typeof fixture>['pages']
    })
    const [only] = ui.openTabKeys()
    expect(ui.tabEl(only!)).not.toBeNull()
    expect(ui.tabEl(only!)?.textContent).toContain(labels.tabPageMissing)
    expect(ui.tabEl(only!)?.dataset.pageMissing).toBe('true')
    await click(ui.tabEl(only))
    expect(ui.panelEl(only!)).not.toBeNull()
    await keydown(ui.tabEl(only!), { key: 'Delete' })
    expect(ui.f.store.getSnapshot().tabs[0]?.open).toBe(false)
  })
})

describe('WorkspaceTabStrip：键盘与 IME', () => {
  it('moves focus with arrows, Home/End and activates with Enter', async () => {
    const ui = await renderStrip()
    await ui.open(text.nav.assistants)
    await ui.open(text.nav.agents)
    await ui.open(text.nav.settings)
    const [first, second, third] = ui.openTabKeys()
    await focus(ui.tabEl(third))
    await keydown(document.activeElement!, { key: 'ArrowLeft' })
    expect((document.activeElement as HTMLElement).dataset.tabKey).toBe(second)
    await keydown(document.activeElement!, { key: 'ArrowLeft' })
    expect((document.activeElement as HTMLElement).dataset.tabKey).toBe(first)
    await keydown(document.activeElement!, { key: 'Home' })
    expect((document.activeElement as HTMLElement).dataset.tabKey).toBe(first)
    await keydown(document.activeElement!, { key: 'End' })
    expect((document.activeElement as HTMLElement).dataset.tabKey).toBe(third)
    await keydown(document.activeElement!, { key: 'ArrowRight' })
    expect((document.activeElement as HTMLElement).dataset.tabKey).toBe(third)
    await keydown(ui.tabEl(first!), { key: 'Enter' })
    expect(ui.f.store.getSnapshot().activeWorkspaceInstanceKey).toBe(first)
    await keydown(ui.tabEl(first!), { key: ' ' })
    expect(ui.f.store.getSnapshot().activeWorkspaceInstanceKey).toBe(first)
  })

  it('ignores shortcuts while an IME composition is in flight', async () => {
    const ui = await renderStrip()
    await ui.open(text.nav.assistants)
    await ui.open(text.nav.agents)
    const [first, second] = ui.openTabKeys()
    ui.log.length = 0
    await keydown(ui.tabEl(second!), { key: 'Delete', isComposing: true })
    await keydown(ui.tabEl(second!), { key: 'w', ctrlKey: true, isComposing: true })
    await keydown(ui.tabEl(second!), { key: 'w', ctrlKey: true, keyCode: 229 })
    await keydown(ui.tabEl(first!), { key: 'ArrowRight', isComposing: true })
    expect(ui.log).toEqual([])
    expect(ui.f.store.getSnapshot().tabs.filter((tab) => tab.open)).toHaveLength(2)
    await keydown(ui.tabEl(second!), { key: 'w', ctrlKey: true })
    expect(ui.log).toEqual(['closeTab'])
  })

  it('does not hijack shortcuts typed inside page content', async () => {
    const ui = await renderStrip()
    await ui.open(text.nav.assistants)
    const [only] = ui.openTabKeys()
    const input = ui.panelEl(only!)!.querySelector<HTMLInputElement>('input')!
    ui.log.length = 0
    await keydown(input, { key: 'w', ctrlKey: true })
    await keydown(input, { key: 'Delete' })
    expect(ui.log).toEqual([])
    expect(ui.f.store.getSnapshot().tabs[0]?.open).toBe(true)
  })

  it('closes with Delete or Ctrl+W and reopens with Ctrl+Shift+T in place', async () => {
    const ui = await renderStrip()
    await ui.open(text.nav.assistants)
    await ui.open(text.nav.agents)
    const [first, second] = ui.openTabKeys()
    await keydown(ui.tabEl(second!), { key: 'Delete' })
    expect(ui.f.store.getSnapshot().tabs.find((tab) => tab.workspaceInstanceKey === second)?.open).toBe(false)
    await keydown(ui.tabEl(first!), { key: 'w', ctrlKey: true })
    expect(ui.f.store.getSnapshot().tabs.filter((tab) => tab.open)).toHaveLength(0)
    await keydown(ui.container.querySelector('[role="tablist"]')!, { key: 'T', ctrlKey: true, shiftKey: true })
    const snapshot = ui.f.store.getSnapshot()
    expect(snapshot.tabs.filter((tab) => tab.open)).toHaveLength(1)
    // 重开是原地恢复同一实例键，不是新开实例
    expect(snapshot.tabs.map((tab) => tab.workspaceInstanceKey)).toEqual([first, second])
    expect(snapshot.activeWorkspaceInstanceKey).toBe(first)
    // 快捷键必须阻止宿主默认行为（浏览器里 Ctrl+W 会关窗）
    const event = new KeyboardEvent('keydown', { key: 'w', ctrlKey: true, bubbles: true, cancelable: true })
    await act(async () => { ui.tabEl(first!)!.dispatchEvent(event); await Promise.resolve() })
    expect(event.defaultPrevented).toBe(true)
  })

  it('reorders with Alt+Shift+Arrow and keeps the logical order in the authority', async () => {
    const ui = await renderStrip()
    await ui.open(text.nav.assistants)
    await ui.open(text.nav.agents)
    const [first, second] = ui.openTabKeys()
    await keydown(ui.tabEl(first!), { key: 'ArrowRight', altKey: true, shiftKey: true })
    expect(ui.log).toContain('reorderTabs')
    expect(ui.f.store.getSnapshot().tabs.map((tab) => tab.workspaceInstanceKey)).toEqual([second, first])
    expect(ui.openTabKeys()).toEqual([second, first])
    // 边界：最右再往右移动不改动权威顺序
    ui.log.length = 0
    await keydown(ui.tabEl(first!), { key: 'ArrowRight', altKey: true, shiftKey: true })
    expect(ui.f.store.getSnapshot().tabs.map((tab) => tab.workspaceInstanceKey)).toEqual([second, first])
  })
})

describe('WorkspaceTabStrip：菜单动作（关闭其他/右侧/重开/空工作区）', () => {
  it('closes every other tab and keeps only the chosen one active', async () => {
    const ui = await renderStrip()
    await ui.open(text.nav.assistants)
    await ui.open(text.nav.agents)
    await ui.open(text.nav.settings)
    const [first] = ui.openTabKeys()
    await click(ui.tabEl(first))
    await ui.chooseAction(labels.tabCloseOthers)
    const snapshot = ui.f.store.getSnapshot()
    expect(ui.openTabKeys()).toEqual([first])
    expect(snapshot.activeWorkspaceInstanceKey).toBe(first)
    expect(snapshot.tabs.filter((tab) => tab.open)).toHaveLength(1)
    expect(ui.f.store.recentlyClosed()).toHaveLength(2)
  })

  it('closes only the tabs to the right of the chosen tab', async () => {
    const ui = await renderStrip()
    await ui.open(text.nav.assistants)
    await ui.open(text.nav.agents)
    await ui.open(text.nav.settings)
    const [first, second] = ui.openTabKeys()
    // 以 agents（第二个）为锚：只有它右侧的 settings 关闭
    await click(ui.tabEl(second))
    await ui.chooseAction(labels.tabCloseRight)
    expect(ui.openTabKeys()).toEqual([first, second])
    expect(ui.f.store.getSnapshot().tabs.find((tab) => tab.pageId === 'settings')?.open).toBe(false)
  })

  it('disables the reopen entry when the closed history is empty and reopens the same instance after a close', async () => {
    const ui = await renderStrip()
    await ui.open(text.nav.assistants)
    const [only] = ui.openTabKeys()
    await ui.openActions()
    const reopen = menuItems(ui.container).find((node) => node.textContent === labels.tabReopen)
    expect(reopen?.getAttribute('aria-disabled')).toBe('true')
    expect(reopen?.getAttribute('title')).toBe(labels.tabReopenUnavailable)
    await click(reopen)
    expect(ui.f.store.getSnapshot().tabs[0]?.open).toBe(true)

    await click(ui.tabEl(only))
    await ui.chooseAction(labels.tabClose)
    expect(ui.openTabKeys()).toEqual([])
    const closedKey = ui.f.store.getSnapshot().tabs[0]!.workspaceInstanceKey
    await ui.chooseAction(labels.tabReopen)
    expect(ui.openTabKeys()).toEqual([closedKey])
    expect(ui.f.store.getSnapshot().activeWorkspaceInstanceKey).toBe(closedKey)
    expect(ui.f.store.getSnapshot().tabs).toHaveLength(1)
  })

  it('keeps the workspace usable after the last tab closes (empty state + open menu)', async () => {
    const ui = await renderStrip()
    await ui.open(text.nav.assistants)
    const [only] = ui.openTabKeys()
    await click(ui.tabEl(only))
    await ui.chooseAction(labels.tabClose)
    expect(ui.openTabs()).toEqual([])
    expect(ui.container.querySelector('[data-workspace-page-host="empty"]')).not.toBeNull()
    expect(ui.container.textContent).toContain(labels.tabEmptyTitle)
    // 空工作区仍可打开全部注册菜单（内置 3 + 产品 1），不是被隐藏的菜单
    await click(ui.container.querySelector<HTMLElement>('[data-tab-strip-open-page]'))
    expect(menuItems(ui.container).map((node) => node.textContent)).toEqual([
      text.nav.assistants,
      text.nav.agents,
      text.nav.settings,
      'Alpha page'
    ])
    await click(menuItems(ui.container).find((node) => node.textContent === 'Alpha page') ?? null)
    expect(ui.openTabs()).toHaveLength(1)
    expect(ui.f.store.getSnapshot().tabs.find((tab) => tab.open)?.pageId).toBe('sample.alpha')
  })

  it('gives every disabled tab action a visible reason instead of a silent grey entry', async () => {
    const ui = await renderStrip()
    await ui.openActions()
    const reasons = new Map(menuItems(ui.container).map((node) => [node.textContent, node.getAttribute('title')]))
    expect(reasons.get(labels.tabClose)).toBe(labels.tabCloseUnavailable)
    expect(reasons.get(labels.tabCloseOthers)).toBe(labels.tabCloseOthersUnavailable)
    expect(reasons.get(labels.tabCloseRight)).toBe(labels.tabCloseRightUnavailable)
    expect(reasons.get(labels.tabReopen)).toBe(labels.tabReopenUnavailable)
    for (const item of menuItems(ui.container)) {
      expect(item.getAttribute('aria-disabled')).toBe('true')
      expect(item.getAttribute('title')).toBeTruthy()
    }
  })

  it('reports an authority rejection with paired i18n text instead of a raw error code', async () => {
    let stale = false
    const ui = await renderStrip({ stale: () => stale })
    await ui.open(text.nav.assistants)
    await ui.open(text.nav.agents)
    const [first] = ui.openTabKeys()
    stale = true
    await click(ui.tabEl(first))
    // 权威拒绝（stale revision）不得被 strip 解释成成功，也不得把错误码直接渲染出来
    expect(ui.container.textContent).toContain(labels.tabCommandRejected)
    expect(ui.container.textContent).not.toContain('stale-revision')
    expect(ui.container.textContent).not.toContain('errorCode')
  })

  it('reports a failed command transport with an i18n notice', async () => {
    let fail = false
    const ui = await renderStrip({ failNext: () => fail })
    await ui.open(text.nav.assistants)
    fail = true
    await ui.chooseAction(labels.tabClose)
    expect(ui.container.textContent).toContain(labels.tabCommandFailed)
    expect(ui.container.textContent).not.toContain('private transport failure payload')
  })
})

describe('WorkspaceTabStrip：草稿保护（三态 + 批量原子）', () => {
  it('blocks a close on a dirty owner until the user decides, then closes on save', async () => {
    const owner = liveOwner('sensitive')
    const owners = new Map<string, WorkspaceDraftOwnerPort>()
    const ui = await renderStrip({ guard: fakeGuard(owners) })
    await ui.open(text.nav.settings)
    const [key] = ui.openTabKeys()
    owners.set(key!, owner)
    await click(ui.tabEl(key))
    await ui.chooseAction(labels.tabClose)
    expect(ui.container.querySelector('[data-draft-prompt="sensitive"]')).not.toBeNull()
    expect(owner.saves).toBe(0)
    expect(ui.f.store.getSnapshot().tabs[0]?.open).toBe(true)

    await click(Array.from(ui.container.querySelectorAll('button')).find((button) => button.textContent === labels.draftGateSave)!)
    expect(owner.saves).toBe(1)
    expect(ui.f.store.getSnapshot().tabs[0]?.open).toBe(false)
    expect(ui.container.querySelector('[data-draft-prompt]')).toBeNull()
  })

  it('keeps the tab open on cancel or on a failed save (window preserved)', async () => {
    const cancelling = liveOwner('sensitive')
    const owners = new Map<string, WorkspaceDraftOwnerPort>()
    const ui = await renderStrip({ guard: fakeGuard(owners) })
    await ui.open(text.nav.settings)
    const [key] = ui.openTabKeys()
    owners.set(key!, cancelling)
    await ui.chooseAction(labels.tabClose)
    await click(Array.from(ui.container.querySelectorAll('button')).find((button) => button.textContent === labels.draftGateCancel)!)
    expect(cancelling.saves).toBe(0)
    expect(cancelling.discards).toBe(0)
    expect(cancelling.draft).toBe('draft-body')
    expect(ui.f.store.getSnapshot().tabs[0]?.open).toBe(true)
    expect(ui.container.querySelector('[data-draft-prompt]')).toBeNull()

    const failing = liveOwner('safe', true)
    owners.set(key!, failing)
    await ui.chooseAction(labels.tabClose)
    await click(Array.from(ui.container.querySelectorAll('button')).find((button) => button.textContent === labels.draftGateSave)!)
    expect(failing.draft).toBe('draft-body')
    expect(ui.f.store.getSnapshot().tabs[0]?.open).toBe(true)
    expect(ui.container.textContent).toContain(labels.draftGateSaveFailed)
    expect(ui.container.textContent).not.toContain('private save failure payload')
  })

  it('never partially closes a batch when the user cancels', async () => {
    const first = liveOwner('sensitive')
    const second = liveOwner('safe')
    const owners = new Map<string, WorkspaceDraftOwnerPort>()
    const ui = await renderStrip({ guard: fakeGuard(owners) })
    await ui.open(text.nav.assistants)
    await ui.open(text.nav.agents)
    await ui.open(text.nav.settings)
    const [a, b] = ui.openTabKeys()
    owners.set(a!, first)
    owners.set(b!, second)
    ui.log.length = 0
    await ui.chooseAction(labels.tabCloseOthers)
    expect(ui.container.querySelector('[data-draft-prompt]')).not.toBeNull()
    expect(ui.log).not.toContain('closeOthers')
    await click(Array.from(ui.container.querySelectorAll('button')).find((button) => button.textContent === labels.draftGateCancel)!)
    expect(ui.log).not.toContain('closeOthers')
    expect(first.saves).toBe(0)
    expect(second.saves).toBe(0)
    expect(ui.f.store.getSnapshot().tabs.filter((tab) => tab.open)).toHaveLength(3)
  })

  it('closes the batch only after every dirty owner resolved', async () => {
    const first = liveOwner('sensitive')
    const second = liveOwner('safe')
    const owners = new Map<string, WorkspaceDraftOwnerPort>()
    const ui = await renderStrip({ guard: fakeGuard(owners) })
    await ui.open(text.nav.assistants)
    await ui.open(text.nav.agents)
    await ui.open(text.nav.settings)
    const [a, b, c] = ui.openTabKeys()
    owners.set(a!, first)
    owners.set(b!, second)
    await ui.chooseAction(labels.tabCloseOthers)
    await click(Array.from(ui.container.querySelectorAll('button')).find((button) => button.textContent === labels.draftGateDiscard)!)
    expect(first.discards).toBe(1)
    expect(second.discards).toBe(1)
    expect(ui.openTabKeys()).toEqual([c])
  })
})
