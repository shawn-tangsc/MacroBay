import { describe, expect, it } from 'vitest'

import type { WorkspacePanelRegistration } from '@platform/workspace/contracts'
import { createPanelRegistry } from '@platform/workspace/registry/panelRegistry'
import { builtInWorkspacePages, builtInWorkspacePageModuleIds } from '@platform/workspace/registry/builtInWorkspacePages'
import { createWorkspacePageRegistry, toProductWorkspacePage } from '@platform/workspace/registry/workspacePageRegistry'
import { createPanelWorkspaceStore } from '@platform/workspace/runtime/panelWorkspaceStore'
import { createWorkspaceTabStore } from '@platform/workspace/runtime/workspaceTabStore'
import { createPanelWorkspaceIpcHandlers } from './panelWorkspaceIpcHandlers'
import { createTabWorkspaceIpcHandlers } from './tabWorkspaceIpcHandlers'
import { createWorkspaceWindowRegistry } from './workspaceWindowRegistry'

/**
 * Owner: platform/desktop/main/workspace（PLAT-35 RED，Main 侧那一半）。
 *
 * 两条链的键统一**只在 Main 完成**（renderer 绝不持有第二份布局权威）：
 *  - **Tab → 面板**：`openTab` 接受后由 compose 采纳一个同键面板 workspace（幂等，不抬 revision）；
 *  - **面板 → Tab**：`openWorkspace({pageId})` 若该页已有打开的 Tab，则**采纳该 Tab 的键**并原样返回
 *    （不再自造第二个 workspace）；没有 Tab 时保持既有语义（自造新键）。
 *  - 采纳回调只在「命令真的 applied」时被调用；被拒/陈旧/非主窗零调用（绝不因一次失败写入把键混在一起）。
 */
const PAGE_ID = 'sample.page-a'
const PANEL_ID = 'sample.inspector'
const TAB_KEY = 'workspace-tab-chain-1'

function panelRegistration(): WorkspacePanelRegistration {
  return {
    panelId: PANEL_ID,
    title: { 'zh-CN': '检查器', 'en-US': 'Inspector' },
    icon: 'file-text',
    module: PANEL_ID,
    pageIds: [PAGE_ID],
    supportedModes: ['embedded', 'docked-right', 'docked-bottom', 'detached'],
    defaultMode: 'docked-right',
    allowMultipleInstances: false,
    minSize: { width: 320, height: 240 },
    preferredSize: { width: 480, height: 360 },
    binding: { persistence: 'none', maxKeyBytes: 256 },
    lifecycleEvents: ['open', 'close']
  }
}

function createPageRegistry() {
  const registry = createWorkspacePageRegistry({ moduleIds: [...builtInWorkspacePageModuleIds, 'sample.page-a'], productIds: ['sample'] })
  for (const page of builtInWorkspacePages) registry.register(page)
  registry.register(toProductWorkspacePage('sample', {
    id: 'page-a', title: { 'zh-CN': '页面 A', 'en-US': 'Page A' },
    icon: 'file-text', order: 1, module: 'sample.page'
  }))
  registry.seal()
  return registry
}

function createPanelHandlerHarness(options: { tabKeyForPage?: string | null } = {}) {
  let sequence = 0
  const panelRegistry = createPanelRegistry({ pageIds: [PAGE_ID], moduleIds: [PANEL_ID] })
  panelRegistry.register(panelRegistration())
  panelRegistry.seal()
  const runtimeStore = createPanelWorkspaceStore({
    panelRegistry, pageIds: [PAGE_ID], createOpaqueId: (prefix) => `${prefix}-${++sequence}`
  })
  const windowRegistry = createWorkspaceWindowRegistry({ createOpaqueId: (prefix) => `${prefix}-${++sequence}` })
  windowRegistry.registerMainWindow({ webContentsId: 1 })
  const handlers = createPanelWorkspaceIpcHandlers({
    panelRegistry, pageIds: [PAGE_ID], runtimeStore, windowRegistry,
    preferences: { getLanguage: async () => 'en-US', getTheme: () => 'dark', getTimeZone: async () => 'UTC' },
    resolvePageWorkspaceKey: () => options.tabKeyForPage ?? null
  })
  const event = { senderFrame: { parent: null }, sender: { id: 1, isDestroyed: () => false } }
  return { runtimeStore, handlers, event }
}

describe('PLAT-35 Main 侧桥接：面板 openWorkspace 采纳 Tab 链的键', () => {
  it('该页已有打开的 Tab ⇒ openWorkspace 原样返回 Tab 的键（不再自造第二个 workspace）', async () => {
    const harness = createPanelHandlerHarness({ tabKeyForPage: TAB_KEY })
    const opened = await harness.handlers.command(harness.event, {
      method: 'openWorkspace', requestId: 'req-workspace', expectedRevision: 0, pageId: PAGE_ID
    })
    expect(opened.status).toBe('applied')
    expect(opened.workspaceInstanceKey).toBe(TAB_KEY)
    expect(harness.runtimeStore.getSnapshot().pageLayouts.map((layout) => layout.workspaceInstanceKey)).toEqual([TAB_KEY])

    // 采纳后的键可以直接承载面板（真机 A-T05 的驱动路径）
    const panel = await harness.handlers.command(harness.event, {
      method: 'openPanel', requestId: 'req-panel', expectedRevision: harness.runtimeStore.getSnapshot().layoutRevision,
      workspaceInstanceKey: TAB_KEY, panelId: PANEL_ID
    })
    expect(panel.status).toBe('applied')
    const layout = harness.runtimeStore.getSnapshot().pageLayouts.find((entry) => entry.workspaceInstanceKey === TAB_KEY)
    expect(layout?.panelOrder).toEqual([panel.panelInstanceKey])
  })

  it('该页没有 Tab ⇒ 保持既有语义（自造新键），不依赖桥接端口', async () => {
    const harness = createPanelHandlerHarness({ tabKeyForPage: null })
    const opened = await harness.handlers.command(harness.event, {
      method: 'openWorkspace', requestId: 'req-workspace', expectedRevision: 0, pageId: PAGE_ID
    })
    expect(opened.status).toBe('applied')
    expect(opened.workspaceInstanceKey).not.toBe(TAB_KEY)
    expect(typeof opened.workspaceInstanceKey).toBe('string')
  })

  it('非主窗仍不得新建工作区（桥接不放宽既有准入）', async () => {
    const harness = createPanelHandlerHarness({ tabKeyForPage: TAB_KEY })
    const panelSender = { senderFrame: { parent: null }, sender: { id: 99, isDestroyed: () => false } }
    const rejected = await harness.handlers.command(panelSender, {
      method: 'openWorkspace', requestId: 'req-workspace', expectedRevision: 0, pageId: PAGE_ID
    })
    expect(rejected.status).toBe('rejected')
    expect(rejected.errorCode).toBe('not-owner')
  })
})

describe('PLAT-35 Main 侧桥接：openTab 后采纳同键面板 workspace', () => {
  function createTabHarness() {
    let sequence = 0
    const windowRegistry = createWorkspaceWindowRegistry({ createOpaqueId: (prefix) => `${prefix}-${++sequence}` })
    const main = windowRegistry.registerMainWindow({ webContentsId: 10 })
    void main
    const pageRegistry = createPageRegistry()
    let tabSequence = 0
    const tabStore = createWorkspaceTabStore({
      pageRegistry, createOpaqueId: (prefix = 'id') => `tab-${prefix}-${++tabSequence}`
    })
    const adopted: { workspaceInstanceKey: string; pageId: string }[] = []
    const handlers = createTabWorkspaceIpcHandlers({
      pageRegistry, tabStore, windowRegistry,
      adoptPanelWorkspace: (input) => { adopted.push(input) },
      release: () => undefined
    })
    const event = { senderFrame: { parent: null }, sender: { id: 10, isDestroyed: () => false } }
    return { tabStore, handlers, event, adopted }
  }

  it('openTab applied ⇒ 以同一键 + pageId 采纳（幂等回调；重复打开也不产生第二份键）', async () => {
    const harness = createTabHarness()
    const opened = await harness.handlers.command(harness.event, {
      method: 'openTab', requestId: 'req-open', expectedRevision: 0, pageId: 'sample.page-a'
    })
    expect(opened.status).toBe('applied')
    expect(harness.adopted).toEqual([{ workspaceInstanceKey: opened.workspaceInstanceKey, pageId: 'sample.page-a' }])

    // 重复打开同一页（store 幂等激活）⇒ 回调再次收到同一个键（采纳本身必须幂等）
    const again = await harness.handlers.command(harness.event, {
      method: 'openTab', requestId: 'req-open-2', expectedRevision: harness.tabStore.getSnapshot().layoutRevision,
      pageId: 'sample.page-a'
    })
    expect(again.status).toBe('applied')
    expect(harness.adopted.map((entry) => entry.workspaceInstanceKey))
      .toEqual([opened.workspaceInstanceKey, opened.workspaceInstanceKey])
  })

  it('被拒的 openTab 不触发采纳（绝不把失败命令的键混进面板链）', async () => {
    const harness = createTabHarness()
    const rejected = await harness.handlers.command(harness.event, {
      method: 'openTab', requestId: 'req-open', expectedRevision: 0, pageId: 'unregistered.page'
    })
    expect(rejected.status).toBe('rejected')
    expect(harness.adopted).toEqual([])
  })
})
