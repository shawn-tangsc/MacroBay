import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { WorkspacePanelRegistration, WorkspacePageRegistration } from '../contracts'
import { createPanelRegistry } from '../registry/panelRegistry'
import { createWorkspacePageRegistry } from '../registry/workspacePageRegistry'
import { createPanelWorkspaceStore } from '../runtime/panelWorkspaceStore'
import { createWorkspaceTabStore } from '../runtime/workspaceTabStore'
import { createPanelLayoutStore } from './panelLayoutStore'
import {
  buildWorkspaceLayoutDocumentV2,
  dropNonDurableBindingsV2,
  toPanelLayoutDocumentV1,
  type WorkspaceLayoutDocumentV2
} from './workspaceLayoutDocument'

/**
 * Owner: platform/workspace/persistence（P2-04）。权威：技术设计 §7/§9 Persistence + Exit 行。
 * 只用 os.tmpdir() 下的真实临时目录与真实注册表：**fresh store 完整恢复**（v2 → 面板 runtime + Tab runtime），
 * 以及反向证明——文件写出来了 ≠ 接回了 runtime（不调用恢复时两个 runtime store 必须为空）。
 */

let directory = ''
let filePath = ''

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'p2-04-layout-'))
  filePath = join(directory, 'layout.json')
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

function panelRegistration(overrides: Partial<WorkspacePanelRegistration> = {}): WorkspacePanelRegistration {
  return {
    panelId: 'sample.inspector', title: { 'zh-CN': '检查器', 'en-US': 'Inspector' }, icon: 'file-text',
    module: 'sample.inspector', pageIds: ['sample.page-a'],
    supportedModes: ['embedded', 'docked-right', 'docked-bottom', 'detached'],
    defaultMode: 'embedded', allowMultipleInstances: false,
    minSize: { width: 320, height: 240 }, preferredSize: { width: 480, height: 360 },
    binding: { persistence: 'durable', maxKeyBytes: 256 }, lifecycleEvents: ['open', 'close'],
    ...overrides
  }
}

function pageRegistration(pageId: string, overrides: Partial<WorkspacePageRegistration> = {}): WorkspacePageRegistration {
  const [productId] = pageId.split('.')
  return {
    pageId, menuKey: `/${pageId.split('.').join('/')}`, title: { 'zh-CN': pageId, 'en-US': pageId },
    icon: 'home', module: pageId, productId, supportsDetached: true, allowMultipleInstances: false,
    binding: { persistence: 'none', maxKeyBytes: 256 }, ...overrides
  }
}

function createRegistries(panels: readonly WorkspacePanelRegistration[], pages: readonly WorkspacePageRegistration[]) {
  const panelRegistry = createPanelRegistry({ pageIds: pages.map((page) => page.pageId), moduleIds: panels.map((panel) => panel.module) })
  panels.forEach((panel) => panelRegistry.register(panel))
  panelRegistry.seal()
  const pageRegistry = createWorkspacePageRegistry({
    moduleIds: pages.map((page) => page.module),
    productIds: [...new Set(pages.map((page) => page.productId).filter((id): id is string => id !== undefined))]
  })
  pages.forEach((page) => pageRegistry.register(page))
  pageRegistry.seal()
  return { panelRegistry, pageRegistry }
}

function createRuntimeStores(panels: readonly WorkspacePanelRegistration[], pages: readonly WorkspacePageRegistration[]) {
  const { panelRegistry, pageRegistry } = createRegistries(panels, pages)
  let sequence = 0
  const createOpaqueId = (prefix = 'id') => `${prefix}_${String(++sequence).padStart(4, '0')}`
  return {
    panelRegistry, pageRegistry,
    runtimeStore: createPanelWorkspaceStore({ panelRegistry, pageIds: pages.map((page) => page.pageId), createOpaqueId }),
    tabStore: createWorkspaceTabStore({ pageRegistry, createOpaqueId })
  }
}

/**
 * 端口级恢复：把 v2 文档接回两个 runtime store。语义与 Main 的 `restoreWorkspaceLayout` 相同
 * （CAS + 按注册表剪裁 + detached tab 降级为 main），但**保持在 workspace 层**，不跨层 import
 * `platform/desktop/main`。Main 组合层的接线证据见 `platform/desktop/main/workspace/restoreWorkspaceLayout.test.ts`。
 */
async function applyDocument(
  runtimeStore: ReturnType<typeof createPanelWorkspaceStore>,
  tabStore: ReturnType<typeof createWorkspaceTabStore>,
  document: WorkspaceLayoutDocumentV2
) {
  const panelResult = await runtimeStore._restoreLayout({
    requestId: 'restore', requestScope: 'restore',
    expectedRevision: runtimeStore.getSnapshot().layoutRevision,
    document: toPanelLayoutDocumentV1(document)
  })
  const tabResult = await tabStore._restoreTabs({
    requestId: 'restore-tabs', requestScope: 'restore', hostEpoch: 1,
    expectedRevision: tabStore.getSnapshot().layoutRevision,
    // 启动期没有源宿主可 ACK：detached 页窗统一恢复为 main
    tabs: document.tabs.map((tab) => ({ ...tab, mode: 'main' as const })),
    activeWorkspaceInstanceKey: document.activeWorkspaceInstanceKey
  })
  return { panelResult, tabResult }
}

/** 单写出口（与 compose 的接线同一语义，避免测试自己发明第二套合成规则）。 */
function persist(
  layoutStore: ReturnType<typeof createPanelLayoutStore>,
  runtimeStore: ReturnType<typeof createPanelWorkspaceStore>,
  tabStore: ReturnType<typeof createWorkspaceTabStore>,
  panelRegistry: ReturnType<typeof createPanelRegistry>
): void {
  const exported = runtimeStore.exportLayoutDocument({ savedAt: '2026-10-05T00:00:00.000Z' })
  if (exported.status !== 'ok') throw new Error('export failed')
  const built = buildWorkspaceLayoutDocumentV2({
    savedAt: exported.document.savedAt,
    layoutRevision: Math.max(exported.document.layoutRevision, tabStore.getSnapshot().layoutRevision),
    panelDocument: exported.document,
    tabs: tabStore.exportLayoutTabs().tabs,
    activeWorkspaceInstanceKey: tabStore.getSnapshot().activeWorkspaceInstanceKey
  })
  if (built.status !== 'ok') throw new Error(`build failed: ${built.reason}`)
  layoutStore.schedule(dropNonDurableBindingsV2(built.document, (panelId) => panelRegistry.get(panelId)?.binding.persistence).document)
}

const PANELS = [panelRegistration()]
const PAGES = [
  pageRegistration('sample.page-a'),
  pageRegistration('sample.page-b', { binding: { persistence: 'session', maxKeyBytes: 256 } })
]

/** 会话 A：真实命令 → v2 文件（含显式关闭的 Tab 与 detached 面板）。 */
async function writeSessionA(): Promise<void> {
  const sessionA = createRuntimeStores(PANELS, PAGES)
  const opened = await sessionA.runtimeStore.openWorkspace({ requestId: 'open-workspace', expectedRevision: 0, pageId: 'sample.page-a' })
  const panel = await sessionA.runtimeStore.openPanel({
    requestId: 'open-panel', expectedRevision: 1, hostEpoch: 1,
    workspaceInstanceKey: opened.workspaceInstanceKey, panelId: 'sample.inspector', bindingKey: 'durable-key-a'
  })
  await sessionA.runtimeStore.resizePanel({ requestId: 'resize', expectedRevision: 2, hostEpoch: 1, panelInstanceKey: panel.panelInstanceKey, dockSize: { width: 500, height: 400 } })
  await sessionA.runtimeStore.switchContainer({ requestId: 'dock', expectedRevision: 3, hostEpoch: 1, panelInstanceKey: panel.panelInstanceKey, mode: 'docked-bottom' })
  const tabA = await sessionA.tabStore.openTab({ requestId: 'tab-a', hostEpoch: 1, expectedRevision: 0, pageId: 'sample.page-a' })
  expect(tabA.status).toBe('applied')
  const tabB = await sessionA.tabStore.openTab({
    requestId: 'tab-b', hostEpoch: 1, expectedRevision: tabA.snapshot.layoutRevision,
    pageId: 'sample.page-b', bindingKey: 'session-key-b'
  })
  expect(tabB.status).toBe('applied')
  // 显式关闭第二个 Tab（退出不是关闭）：必须落盘 open=false，且不会在重启后被重开
  const closed = await sessionA.tabStore.closeTab({
    requestId: 'tab-b-close', hostEpoch: 1, expectedRevision: tabB.snapshot.layoutRevision,
    workspaceInstanceKey: tabB.workspaceInstanceKey!
  })
  expect(closed.status).toBe('applied')

  const layoutStore = createPanelLayoutStore({ filePath })
  persist(layoutStore, sessionA.runtimeStore, sessionA.tabStore, sessionA.panelRegistry)
  await expect(layoutStore.flush()).resolves.toMatchObject({ outcome: 'saved' })
}

describe('P2-04 v2 接回 runtime：fresh store 完整恢复', () => {
  it('反向证明：只有文件、没有恢复调用时，两个 runtime store 必须为空', async () => {
    await writeSessionA()
    const onDisk = JSON.parse(await readFile(filePath, 'utf8')) as { schemaVersion: number }
    expect(onDisk.schemaVersion).toBe(2) // 文件确实写出来了

    const sessionB = createRuntimeStores(PANELS, PAGES)
    const loaded = await createPanelLayoutStore({ filePath }).load()
    expect(loaded).toMatchObject({ outcome: 'loaded', convertedFromV1: false })
    expect(loaded.document.tabs).toHaveLength(2)
    // 没有调用恢复 ⇒ runtime 权威仍是空的（这就是「只写出文件 ≠ 接回 runtime」的反向证据）
    expect(sessionB.runtimeStore.getSnapshot().panels).toEqual([])
    expect(sessionB.runtimeStore.getSnapshot().pageLayouts).toEqual([])
    expect(sessionB.tabStore.getSnapshot().tabs).toEqual([])
  })

  it('恢复后：面板布局/bounds/binding 与 Tab 顺序/打开态/活动项全部来自 v2 文件', async () => {
    await writeSessionA()
    const sessionB = createRuntimeStores(PANELS, PAGES)
    const loaded = await createPanelLayoutStore({ filePath }).load()
    expect(loaded).toMatchObject({ outcome: 'loaded', mayOverwrite: true, convertedFromV1: false })
    const outcome = await applyDocument(sessionB.runtimeStore, sessionB.tabStore, loaded.document)
    expect(outcome.panelResult.status).toBe('applied')
    expect(outcome.tabResult).toMatchObject({ status: 'applied', restoredTabs: 2, prunedTabs: 0 })
    const panels = sessionB.runtimeStore.getSnapshot()
    expect(panels.pageLayouts[0]?.panelOrder).toHaveLength(1)
    expect(panels.pageLayouts[0]?.activePanels).toEqual({ 'docked-bottom': panels.panels[0]?.panelInstanceKey })
    expect(panels.panels[0]).toMatchObject({
      panelId: 'sample.inspector', open: true, mode: 'docked-bottom', lastValidDock: 'docked-bottom',
      dockSize: { width: 500, height: 400 }, bindingState: 'bound'
    })
    const tabs = sessionB.tabStore.getSnapshot()
    expect(tabs.tabs.map((tab) => [tab.pageId, tab.open, tab.order, tab.mode])).toEqual([
      ['sample.page-a', true, 0, 'main'], ['sample.page-b', false, 1, 'main']
    ])
    expect(tabs.activeWorkspaceInstanceKey).toBe(tabs.tabs[0]?.workspaceInstanceKey)
    // session 绑定绝不从磁盘恢复（等宿主重新补绑），durable 绑定保留
    expect(tabs.tabs[1]?.bindingState).toBe('unavailable')
    expect(sessionB.tabStore.recentlyClosed()).toEqual([])
  })

  it('恢复之后仍可继续单写：新变更经同一出口落盘，磁盘上依然只有 v2', async () => {
    await writeSessionA()
    const sessionB = createRuntimeStores(PANELS, PAGES)
    const layoutStore = createPanelLayoutStore({ filePath })
    const loaded = await layoutStore.load()
    await applyDocument(sessionB.runtimeStore, sessionB.tabStore, loaded.document)

    const resized = await sessionB.runtimeStore.resizePanel({
      requestId: 'resize-after-restore', expectedRevision: sessionB.runtimeStore.getSnapshot().layoutRevision,
      hostEpoch: 1, panelInstanceKey: sessionB.runtimeStore.getSnapshot().panels[0]!.panelInstanceKey, dockSize: { width: 520, height: 420 }
    })
    expect(resized.status).toBe('applied')
    await sessionB.tabStore.activateTab({
      requestId: 'activate-closed', hostEpoch: 1, expectedRevision: sessionB.tabStore.getSnapshot().layoutRevision,
      workspaceInstanceKey: sessionB.tabStore.getSnapshot().tabs[1]!.workspaceInstanceKey
    })
    persist(layoutStore, sessionB.runtimeStore, sessionB.tabStore, sessionB.panelRegistry)
    await expect(layoutStore.flush()).resolves.toMatchObject({ outcome: 'saved' })

    const raw = await readFile(filePath, 'utf8')
    const onDisk = JSON.parse(raw) as { schemaVersion: number; panels: readonly { dockSize: { width: number } }[]; tabs: readonly { open: boolean; order: number }[] }
    expect(onDisk.schemaVersion).toBe(2)
    expect(raw).not.toMatch(/"schemaVersion": 1/u)
    expect(onDisk.panels[0]?.dockSize.width).toBe(520)
    expect(onDisk.tabs.map((tab) => tab.open)).toEqual([true, true])

    // 再次 fresh 恢复：磁盘 → runtime 仍然自洽（单写出口可重复使用）
    const sessionC = createRuntimeStores(PANELS, PAGES)
    const thirdLoad = await createPanelLayoutStore({ filePath }).load()
    const third = await applyDocument(sessionC.runtimeStore, sessionC.tabStore, thirdLoad.document)
    expect(third.tabResult.status).toBe('applied')
    expect(sessionC.runtimeStore.getSnapshot().panels[0]?.dockSize).toEqual({ width: 520, height: 420 })
  })
})

describe('P2-04 v1→v2 转换真的接回 runtime（不是只写出文件）', () => {
  function legacyFile(): string {
    return `${JSON.stringify({
      schemaVersion: 1, savedAt: '2026-10-05T00:00:00.000Z', layoutRevision: 7,
      workspaces: [
        { workspaceInstanceKey: 'workspace_legacy_a', pageId: 'sample.page-a', panelOrder: ['panel_legacy'], activePanels: { embedded: 'panel_legacy' } },
        { workspaceInstanceKey: 'workspace_legacy_gone', pageId: 'sample.uninstalled', panelOrder: [], activePanels: {} }
      ],
      panels: [
        {
          panelInstanceKey: 'panel_legacy', workspaceInstanceKey: 'workspace_legacy_a', panelId: 'sample.inspector',
          binding: { key: 'durable-key-a' }, open: true, mode: 'docked-right', lastValidDock: 'docked-right', dockSize: { width: 480, height: 360 }
        },
        {
          panelInstanceKey: 'panel_gone', workspaceInstanceKey: 'workspace_legacy_gone', panelId: 'sample.uninstalled-panel',
          open: true, mode: 'embedded', lastValidDock: 'embedded'
        }
      ]
    }, null, 2)}\n`
  }

  it('v1 文件：一次性升级 → 恢复成运行期权威 → 卸载条目局部剪裁 → 落盘只有 v2', async () => {
    await writeFile(filePath, legacyFile(), 'utf8')
    const sessionB = createRuntimeStores(PANELS, PAGES)
    const layoutStore = createPanelLayoutStore({ filePath })
    const loaded = await layoutStore.load()
    expect(loaded).toMatchObject({ outcome: 'loaded', convertedFromV1: true, mayOverwrite: true })
    const outcome = await applyDocument(sessionB.runtimeStore, sessionB.tabStore, loaded.document)
    // 未注册页面/面板只被局部剪裁（其余布局完整恢复）；v1 的 Tab 全部升为 main
    expect(outcome.panelResult).toMatchObject({ status: 'applied', prunedWorkspaces: 1, prunedPanels: 1 })
    // v1 的第二个 workspace 属于已卸载页面：升级出 2 个 tab，恢复端只剪掉那一条
    expect(outcome.tabResult).toMatchObject({ status: 'applied', restoredTabs: 1, prunedTabs: 1 })
    const panels = sessionB.runtimeStore.getSnapshot()
    expect(panels.panels).toHaveLength(1)
    expect(panels.panels[0]).toMatchObject({ panelInstanceKey: 'panel_legacy', bindingState: 'bound', mode: 'docked-right' })
    expect(sessionB.tabStore.getSnapshot().tabs.map((tab) => [tab.workspaceInstanceKey, tab.pageId])).toEqual([
      ['workspace_legacy_a', 'sample.page-a']
    ])
    // compose 的接线：恢复发生了转换/剪裁后立刻用同一单写出口落一份「与注册表对账过」的 v2
    persist(layoutStore, sessionB.runtimeStore, sessionB.tabStore, sessionB.panelRegistry)
    await layoutStore.flush()
    const onDisk = JSON.parse(await readFile(filePath, 'utf8')) as { schemaVersion: number; tabs: readonly unknown[]; panels: readonly unknown[] }
    expect(onDisk.schemaVersion).toBe(2)
    expect(onDisk.tabs).toHaveLength(1)
    expect(onDisk.panels).toHaveLength(1)
  })

  it('未注册的 Tab（已卸载页面）只剪掉该条，其余 Tab 与面板一份都不丢', async () => {
    await writeSessionA()
    const document = JSON.parse(await readFile(filePath, 'utf8')) as Record<string, unknown>
    const tabs = document.tabs as Record<string, unknown>[]
    tabs.push({ workspaceInstanceKey: 'workspace_uninstalled', pageId: 'sample.uninstalled', open: true, order: tabs.length, mode: 'main' })
    await writeFile(filePath, `${JSON.stringify(document, null, 2)}\n`, 'utf8')

    const sessionB = createRuntimeStores(PANELS, PAGES)
    const loaded = await createPanelLayoutStore({ filePath }).load()
    const outcome = await applyDocument(sessionB.runtimeStore, sessionB.tabStore, loaded.document)
    expect(outcome.panelResult.status).toBe('applied')
    expect(outcome.tabResult).toMatchObject({ status: 'applied', restoredTabs: 2, prunedTabs: 1 })
    expect(sessionB.tabStore.getSnapshot().tabs.map((tab) => tab.pageId)).toEqual(['sample.page-a', 'sample.page-b'])
  })

  it('未知版本（v3）绝不覆写：不恢复、不写盘，原文件逐字保留', async () => {
    await writeSessionA()
    const document = JSON.parse(await readFile(filePath, 'utf8')) as Record<string, unknown>
    await writeFile(filePath, `${JSON.stringify({ ...document, schemaVersion: 3 }, null, 2)}\n`, 'utf8')
    const before = await readFile(filePath, 'utf8')

    const sessionB = createRuntimeStores(PANELS, PAGES)
    const loaded = await createPanelLayoutStore({ filePath }).load()
    expect(loaded).toMatchObject({ outcome: 'default', reason: 'unknown-schema-version', mayOverwrite: false, convertedFromV1: false })
    // 保护态：Main 的恢复根本不会调用 apply（此处按同一判据断言「一个字段都不应用」）
    expect(loaded.mayOverwrite).toBe(false)
    expect(sessionB.runtimeStore.getSnapshot().panels).toEqual([])
    expect(sessionB.tabStore.getSnapshot().tabs).toEqual([])
    expect(await readFile(filePath, 'utf8')).toBe(before)
  })

  it('projection 端口往返：v2 → v1 投影只用于 runtime 端口，不改变 v2 载荷', async () => {
    await writeSessionA()
    const loaded = await createPanelLayoutStore({ filePath }).load()
    const projection = toPanelLayoutDocumentV1(loaded.document)
    expect(projection.workspaces).toEqual(loaded.document.workspaces)
    expect(projection.panels).toEqual(loaded.document.panels)
  })
})
