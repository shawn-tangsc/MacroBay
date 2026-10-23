// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, useEffect, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import type { WorkspacePageRegistration, WorkspaceTabState } from '@platform/workspace/contracts'
import { builtInWorkspacePages, builtInWorkspacePageModuleIds } from '@platform/workspace/registry/builtInWorkspacePages'
import { createWorkspacePageRegistry } from '@platform/workspace/registry/workspacePageRegistry'
import { createWorkspaceTabStore } from '@platform/workspace/runtime/workspaceTabStore'

import { platformText } from '../../i18n/platformText'
import { createShellWorkspacePageRegistry } from '../navigation/workspacePageRegistry'
import { WorkspacePageHost, workspaceTabElementIds } from './WorkspacePageHost'

/**
 * Owner: apps/desktop-shell renderer / workspace 页面宿主（P2-02）。
 * 权威：技术设计 §3（一个 workspaceInstanceKey = 一个逻辑页面）、§6（容器移动只重新 attach/订阅）、
 * A-T02「最后 Tab 后空工作区仍可打开菜单」、A-T04「关闭父页不留子窗」。
 *
 * 判据重点：**切换保留状态**（页面组件在 tab 切换时不被重建）、`tabpanel` 语义与可达性、
 * 空工作区不死锁、未注册页 fail closed 但**绝不隐藏 Tab**。
 */

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let root: Root | undefined
afterEach(async () => { await act(async () => { root?.unmount() }); root = undefined; document.body.replaceChildren() })

const language = 'en-US' as const
const labels = platformText[language].workspace

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

/** 真实 P2-01 注册/runtime 作为「fake runtime」：没有 IPC/窗口，但权威仍是平台 store。 */
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
  const open = async (pageId: string) => {
    const result = await store.openTab({ ...mutate(), pageId })
    return result.workspaceInstanceKey as string
  }
  const activate = (workspaceInstanceKey: string) => store.activateTab({ ...mutate(), workspaceInstanceKey })
  const close = (workspaceInstanceKey: string) => store.closeTab({ ...mutate(), workspaceInstanceKey })
  return { store, pages, open, activate, close }
}

/** 真实页面视图：挂载/卸载计数 + 真实 input 草稿，用来证明「切换不重建、不丢状态」。 */
function PageView(props: {
  instanceKey: string
  pageId: string
  mounts: string[]
  unmounts: string[]
}): React.ReactElement {
  useEffect(() => {
    props.mounts.push(props.instanceKey)
    return () => { props.unmounts.push(props.instanceKey) }
  }, [props.instanceKey, props.mounts, props.unmounts])
  return (
    <div data-page-view={props.instanceKey}>
      <input aria-label={`draft-${props.instanceKey}`} defaultValue="" />
      <span>{props.pageId}</span>
    </div>
  )
}

async function renderHost(options: {
  store: ReturnType<typeof fixture>['store']
  state?: WorkspaceTabState
  renderPage?: (tab: { pageId: string; workspaceInstanceKey: string }) => React.ReactNode
} = { store: fixture().store }) {
  const mounts: string[] = []
  const unmounts: string[] = []
  const container = document.createElement('div')
  document.body.append(container)
  let updateState: (value: WorkspaceTabState) => void = () => {}
  function Harness(): React.ReactElement {
    const [state, setState] = useState<WorkspaceTabState>(() => options.state ?? options.store.getSnapshot())
    updateState = setState
    return (
      <WorkspacePageHost
        language={language}
        state={state}
        renderPage={(input) => options.renderPage
          ? options.renderPage(input.tab)
          : <PageView instanceKey={input.tab.workspaceInstanceKey} pageId={input.tab.pageId} mounts={mounts} unmounts={unmounts} />}
      />
    )
  }
  root = createRoot(container)
  await act(async () => { root!.render(<Harness />) })
  const refresh = async () => { await act(async () => { updateState(options.store.getSnapshot()) }) }
  const panel = (key: string) => container.querySelector<HTMLElement>(`[data-workspace-tab="${key}"]`)
  const tabNode = (key: string) => panel(key)!
  return { container, mounts, unmounts, refresh, panel, tabNode }
}

describe('WorkspacePageHost：每个实例一个 tabpanel，切换不重建', () => {
  it('renders one labelled tabpanel per open tab and hides the inactive ones in place', async () => {
    const f = fixture()
    const a = await f.open('assistants')
    const b = await f.open('agents')
    const host = await renderHost({ store: f.store })

    const panels = Array.from(host.container.querySelectorAll<HTMLElement>('[role="tabpanel"]'))
    expect(panels.map((panel) => panel.dataset.workspaceTab)).toEqual([a, b])
    const ids = workspaceTabElementIds(a)
    expect(host.panel(a)?.id).toBe(ids.panelId)
    expect(host.panel(a)?.getAttribute('aria-labelledby')).toBe(ids.tabId)
    // b 后打开 ⇒ b 是活动项；a 必须**就地隐藏**而不是卸载
    expect(host.panel(b)?.hidden).toBe(false)
    expect(host.panel(a)?.hidden).toBe(true)
    expect(host.panel(b)?.tabIndex).toBe(0)
    expect(host.panel(a)?.tabIndex).toBe(-1)
    expect(host.panel(a)?.dataset.pageId).toBe('assistants')

    await f.activate(a)
    await host.refresh()
    expect(host.panel(a)?.hidden).toBe(false)
    expect(host.panel(b)?.hidden).toBe(true)
    expect(host.panel(a)?.tabIndex).toBe(0)
    expect(host.panel(b)?.tabIndex).toBe(-1)
  })

  it('keeps every page mounted across A→B→A so component state and DOM identity survive', async () => {
    const f = fixture()
    const a = await f.open('assistants')
    const b = await f.open('agents')
    const host = await renderHost({ store: f.store })

    const inputA = host.panel(a)!.querySelector<HTMLInputElement>('input')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(inputA, 'assistant draft')
      inputA.dispatchEvent(new Event('input', { bubbles: true }))
    })

    await f.activate(a)
    await host.refresh()
    await f.activate(b)
    await host.refresh()
    await f.activate(a)
    await host.refresh()

    expect(host.mounts.filter((key) => key === a)).toHaveLength(1)
    expect(host.mounts.filter((key) => key === b)).toHaveLength(1)
    expect(host.unmounts).toEqual([])
    expect(host.panel(a)!.querySelector('input')).toBe(inputA)
    expect(inputA.value).toBe('assistant draft')
    expect(host.panel(a)!.hidden).toBe(false)
  })

  it('unmounts exactly the closed instance and keeps the sibling mounted', async () => {
    const f = fixture()
    const a = await f.open('assistants')
    const b = await f.open('agents')
    const host = await renderHost({ store: f.store })
    await f.close(b)
    await host.refresh()
    expect(host.unmounts).toEqual([b])
    expect(host.mounts.filter((key) => key === a)).toHaveLength(1)
    expect(host.panel(b)).toBeNull()
    expect(host.panel(a)).not.toBeNull()
  })

  it('keeps multi-instance pages of the same pageId separated in state and identity', async () => {
    const f = fixture()
    const first = await f.open('sample.alpha')
    const second = await f.store
      .openTab({ requestScope: 'main', hostEpoch: 1, requestId: 'multi', expectedRevision: f.store.getSnapshot().layoutRevision, pageId: 'sample.alpha', newInstance: true })
      .then((result) => result.workspaceInstanceKey as string)
    const host = await renderHost({ store: f.store })
    expect(first).not.toBe(second)
    const inputFirst = host.panel(first)!.querySelector<HTMLInputElement>('input')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(inputFirst, 'first only')
      inputFirst.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(host.mounts).toEqual([first, second])
    expect(host.panel(second)!.querySelector<HTMLInputElement>('input')!.value).toBe('')
    expect(host.panel(first)!.querySelector('input')).toBe(inputFirst)
  })

  it('renders a calm i18n empty state when the workspace has no open tab', async () => {
    const f = fixture()
    const emptyState: WorkspaceTabState = { layoutRevision: 0, activeWorkspaceInstanceKey: null, tabs: [] }
    const host = await renderHost({ store: f.store, state: emptyState })
    expect(host.container.querySelector('[data-workspace-page-host="empty"]')).not.toBeNull()
    expect(host.container.textContent).toContain(labels.tabEmptyTitle)
    expect(host.container.textContent).toContain(labels.tabEmptyHint)
    expect(host.container.querySelector('[role="tabpanel"]')).toBeNull()
  })

  it('fails closed for a page without a renderer but never hides its tab', async () => {
    const f = fixture()
    const key = await f.open('sample.alpha')
    const host = await renderHost({ store: f.store, renderPage: () => null })
    const panel = host.panel(key)!
    expect(panel).not.toBeNull()
    expect(panel.dataset.pageMissing).toBe('true')
    expect(panel.textContent).toContain(labels.tabPageMissing)
  })
})

describe('临时双路由已由 P2-03 移除（反向 guard）', () => {
  const appShell = readFileSync(
    resolve(process.cwd(), 'apps/desktop-shell/src/renderer/src/shell/AppShell.tsx'),
    'utf8'
  )
  const adapters = readFileSync(
    resolve(process.cwd(), 'apps/desktop-shell/src/renderer/src/shell/workspace/builtInPageAdapters.tsx'),
    'utf8'
  )

  it('no longer carries the temporary direct-route marker anywhere', () => {
    // 反向 guard：标注移除后不得再出现「临时双路由」；出现即说明旧路径复活
    expect(appShell).not.toContain('WORKSPACE_TEMP_DIRECT_ROUTE')
    expect(adapters).not.toContain('WORKSPACE_TEMP_DIRECT_ROUTE')
    expect(adapters).not.toContain('temporary: true')
  })

  it('mounts the production tab host in the shell (tab strip + page host driven by .tabs.*)', () => {
    // 生产路径必须真正用上「非活动就地隐藏、不卸载」的 Tab 宿主，而不是只换菜单外观
    expect(appShell).toContain('WorkspaceTabStrip')
    expect(appShell).toContain('WorkspacePageHost')
    expect(appShell).toContain('createWorkspaceTabClient')
    expect(appShell).toContain('readWorkspaceTabsBridge')
    // 直接切页只作为「没有受控 Tab 桥」时的兜底，不再是被标注的长期临时路径
    expect(appShell).toContain('activateNavKey')
  })
})
