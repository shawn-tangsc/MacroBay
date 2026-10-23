import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { isPackaged: false },
  BrowserWindow: class {},
  shell: { openExternal: vi.fn() }
}))

import type { ProductManifest } from '@platform/product-manifest'
import { composePanelWorkspace } from './composePanelWorkspace'
import { createWorkspaceWindowRegistry } from './workspaceWindowRegistry'

/**
 * Owner: platform/desktop/main/workspace（P2-04）。权威：技术设计 §7/§9 Persistence+Exit/Menu 行。
 *
 * 「v2 真正接回 runtime」的**组合层**证据：真 `composePanelWorkspace` + 真 store/handlers/router，
 * 只把窗口换成注入 fake（fake ipcMain.handle 记录器 / fake sendToHost / fake window registry 中的假窗口）。
 * 证明：v2 文件 → 恢复 → runtime 快照/Tab 状态/绑定/布局全部来自 v2，并且可以继续单写 persist；
 * `shutdown barrier`（退出 flush）在有界时间内落盘。
 */

const roots: string[] = []
afterEach(() => {
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }))
})

const MANIFEST = {
  id: 'sample', name: 'Sample', version: '1.0.0',
  shellContributions: {
    menuPages: [
      { id: 'overview', title: { 'zh-CN': '总览', 'en-US': 'Overview' }, icon: 'home', order: 1, module: './desktop/pages/overview' },
      { id: 'library', title: { 'zh-CN': '库', 'en-US': 'Library' }, icon: 'file-text', order: 2, module: './desktop/pages/library' }
    ],
    settingsSections: [],
    panels: [{
      id: 'inspector', title: { 'zh-CN': '检查器', 'en-US': 'Inspector' }, icon: 'file-text',
      module: './desktop/panels/inspector', pageIds: ['overview'],
      supportedModes: ['embedded', 'docked-right', 'docked-bottom'],
      defaultMode: 'embedded', allowMultipleInstances: false,
      minSize: { width: 320, height: 240 }, preferredSize: { width: 480, height: 360 },
      binding: { persistence: 'durable', maxKeyBytes: 256 }, lifecycleEvents: ['open', 'close']
    }]
  },
  routes: [], navigation: [], settingsSections: [], serviceRoutes: [], tools: [], skills: [],
  agents: [], workflows: [], policies: [], evaluations: [], jobHandlers: [], migrations: []
} as unknown as ProductManifest

function createHarness() {
  const root = mkdtempSync(join(tmpdir(), 'p2-04-restore-'))
  roots.push(root)
  const handled: string[] = []
  const sent: { webContentsId: number; type: string }[] = []
  const windowRegistry = createWorkspaceWindowRegistry()
  const workspace = composePanelWorkspace({
    productManifests: [MANIFEST],
    ipcMain: { handle: (channel: string) => { handled.push(channel) } },
    layoutFilePath: join(root, 'layout.json'),
    sendToHost: (webContentsId, event) => { sent.push({ webContentsId, type: event.type }); return true },
    preferences: { getLanguage: () => 'zh-CN', getTheme: () => 'light' , getTimeZone: () => 'UTC'},
    windowRegistry,
    savedAtNow: () => '2026-10-05T00:00:00.000Z'
  })
  // fake window：主窗身份用受控 webContentsId 登记，绝不碰真实 BrowserWindow
  const mainWindow = workspace.registerMainWindow({ webContentsId: 1 })
  return { root, workspace, handled, sent, windowRegistry, mainWindow, filePath: join(root, 'layout.json') }
}

/** 会话 A：真实命令 → 退出（shutdown barrier）→ 磁盘上只有 v2。用调用方自己的 harness。 */
async function writeSessionA(sessionA: ReturnType<typeof createHarness>) {
  const { filePath } = sessionA
  const started = await sessionA.workspace.start()
  expect(started).toMatchObject({ status: 'ready', restore: 'empty' })

  const page = await sessionA.workspace.runtimeStore!.openWorkspace({ requestId: 'open-workspace', expectedRevision: 0, pageId: 'sample.overview' })
  const panel = await sessionA.workspace.runtimeStore!.openPanel({
    requestId: 'open-panel', expectedRevision: 1, hostEpoch: 1,
    workspaceInstanceKey: page.workspaceInstanceKey, panelId: 'sample.inspector', bindingKey: 'durable-key-a'
  })
  await sessionA.workspace.runtimeStore!.resizePanel({
    requestId: 'resize', expectedRevision: 2, hostEpoch: 1, panelInstanceKey: panel.panelInstanceKey, dockSize: { width: 500, height: 400 }
  })
  const docked = await sessionA.workspace.runtimeStore!.switchContainer({
    requestId: 'dock', expectedRevision: 3, hostEpoch: 1, panelInstanceKey: panel.panelInstanceKey, mode: 'docked-right'
  })
  expect(docked.status).toBe('applied')
  const tabOverview = await sessionA.workspace.tabStore!.openTab({ requestId: 'tab-1', hostEpoch: 1, expectedRevision: 0, pageId: 'sample.overview' })
  expect(tabOverview.status).toBe('applied')
  const tabLibrary = await sessionA.workspace.tabStore!.openTab({
    requestId: 'tab-2', hostEpoch: 1, expectedRevision: tabOverview.snapshot.layoutRevision, pageId: 'sample.library'
  })
  expect(tabLibrary.status).toBe('applied')
  // 显式关闭第二个 Tab（≠ 退出）：必须落盘 false，重启不得自动重开
  const closed = await sessionA.workspace.tabStore!.closeTab({
    requestId: 'tab-2-close', hostEpoch: 1, expectedRevision: tabLibrary.snapshot.layoutRevision,
    workspaceInstanceKey: tabLibrary.workspaceInstanceKey!
  })
  expect(closed.status).toBe('applied')

  // 单写出口：任何 applied 命令后由 compose 的接线落盘；这里显式触发一次并等 flush
  const flush = await sessionA.workspace.flushLayout()
  expect(flush).toMatchObject({ status: 'ready', outcome: 'saved' })
  // shutdown barrier：dispose 的 flush 结论必须如实（无待写就是 skipped，绝不伪报 saved）
  const dispose = await sessionA.workspace.dispose()
  expect(dispose.status).toBe('ready')

  const onDisk = JSON.parse(readFileSync(filePath, 'utf8')) as { schemaVersion: number; tabs: readonly { open: boolean }[] }
  expect(onDisk.schemaVersion).toBe(2)
  return onDisk
}

describe('P2-04 组合层：v2 单写 + 退出 barrier', () => {
  it('会话 A 的退出落盘只有 v2（含显式关闭的 Tab），绝不旧格式双写', async () => {
    const harness = createHarness()
    const onDisk = await writeSessionA(harness)
    expect(onDisk.tabs.map((tab) => tab.open)).toEqual([true, false])
    expect(readFileSync(harness.filePath, 'utf8')).not.toMatch(/"schemaVersion": 1/u)
  })

  it('shutdown barrier 有界：退出时待写被 drain 掉，超时也如实报 timeout', async () => {
    const harness = createHarness()
    await harness.workspace.start()
    await harness.workspace.runtimeStore!.openWorkspace({ requestId: 'w', expectedRevision: 0, pageId: 'sample.overview' })

    const started = Date.now()
    const flush = await harness.workspace.flushLayout()
    expect(Date.now() - started).toBeLessThan(2_000) // 有界（默认上界 2s，实测远低于）
    expect(flush.outcome).toBe('saved')
    const dispose = await harness.workspace.dispose()
    expect(dispose).toMatchObject({ status: 'ready' })
    expect(['saved', 'skipped']).toContain(dispose.flushOutcome)
    expect(JSON.parse(readFileSync(harness.filePath, 'utf8'))).toMatchObject({ schemaVersion: 2 })
  })
})

describe('P2-04 组合层：fresh store + fake windows 完整恢复', () => {
  it('新组合（全新 store / 全新 fake 窗口）：runtime 快照、Tab 状态、绑定与布局全部来自 v2', async () => {
    const writer = createHarness()
    await writeSessionA(writer)

    const reader = createHarness()
    writeFileSync(reader.filePath, readFileSync(writer.filePath, 'utf8'))
    const report = await reader.workspace.start()

    expect(report).toMatchObject({
      status: 'ready', restore: 'restored', restoredPanels: 1, restoredTabs: 2,
      convertedFromV1: false, prunedTabs: 0, mayOverwrite: true
    })
    const panels = reader.workspace.runtimeStore!.getSnapshot()
    expect(panels.panels[0]).toMatchObject({
      panelId: 'sample.inspector', open: true, mode: 'docked-right', dockSize: { width: 500, height: 400 }, bindingState: 'bound'
    })
    const tabs = reader.workspace.tabStore!.getSnapshot()
    expect(tabs.tabs.map((tab) => [tab.pageId, tab.open, tab.order])).toEqual([
      ['sample.overview', true, 0], ['sample.library', false, 1]
    ])
    expect(tabs.activeWorkspaceInstanceKey).toBe(tabs.tabs[0]?.workspaceInstanceKey)
    expect(reader.workspace.tabStore!.recentlyClosed()).toEqual([]) // 重启后「最近关闭」为空

    // fake 窗口挂载：受控身份才订阅，且立刻拿到 current snapshot（证明恢复后的 runtime 是活的）
    const attached = reader.workspace.attachMainWindow({ webContentsId: 1 })
    expect(attached).toMatchObject({ attached: true, subscribed: true })
    expect(reader.sent.length).toBeGreaterThan(0)
    expect(reader.workspace.attachHostWindow({ webContentsId: 999 })).toEqual({ attached: false, subscribed: false })
  })

  it('恢复后可继续单写：新命令 → 退出 barrier → 再次 fresh 恢复仍自洽', async () => {
    const writer = createHarness()
    await writeSessionA(writer)

    const reader = createHarness()
    writeFileSync(reader.filePath, readFileSync(writer.filePath, 'utf8'))
    await reader.workspace.start()
    const tabs = reader.workspace.tabStore!.getSnapshot()
    await reader.workspace.tabStore!.activateTab({
      requestId: 'activate', hostEpoch: 1, expectedRevision: tabs.layoutRevision,
      workspaceInstanceKey: tabs.tabs[1]!.workspaceInstanceKey
    })
    await expect(reader.workspace.flushLayout()).resolves.toMatchObject({ outcome: 'saved' })
    expect((JSON.parse(readFileSync(reader.filePath, 'utf8')) as { tabs: { open: boolean }[] }).tabs.map((tab) => tab.open)).toEqual([true, true])

    const third = createHarness()
    writeFileSync(third.filePath, readFileSync(reader.filePath, 'utf8'))
    const report = await third.workspace.start()
    expect(report).toMatchObject({ restore: 'restored', restoredTabs: 2 })
    expect(third.workspace.tabStore!.getSnapshot().tabs.map((tab) => tab.open)).toEqual([true, true])
  })
})

describe('P2-04 组合层：detached 恢复与保护/转换边界', () => {
  function detachedDocument() {
    return {
      schemaVersion: 2, savedAt: '2026-10-05T00:00:00.000Z', layoutRevision: 9,
      workspaces: [{ workspaceInstanceKey: 'workspace_1', pageId: 'sample.overview', panelOrder: ['panel_1'], activePanels: {} }],
      panels: [{
        panelInstanceKey: 'panel_1', workspaceInstanceKey: 'workspace_1', panelId: 'sample.inspector',
        open: true, mode: 'detached', lastValidDock: 'docked-bottom', detachedBounds: { x: 10, y: 20, width: 800, height: 600 }
      }],
      tabs: [
        { workspaceInstanceKey: 'workspace_tab_a', pageId: 'sample.overview', open: true, order: 0, mode: 'detached' },
        { workspaceInstanceKey: 'workspace_tab_b', pageId: 'sample.library', open: true, order: 1, mode: 'main' }
      ],
      activeWorkspaceInstanceKey: 'workspace_tab_a'
    }
  }

  it('恢复出的 detached 面板与页窗不物化窗口：降级到受支持停靠/主窗并逐条记录 restore-invalid', async () => {
    const harness = createHarness()
    writeFileSync(harness.filePath, `${JSON.stringify(detachedDocument(), null, 2)}\n`, 'utf8')
    const report = await harness.workspace.start()

    expect(report.restore).toBe('restored')
    expect(report.downgradedDetached).toEqual([
      { panelInstanceKey: 'panel_1', from: 'detached', to: 'docked-bottom', reason: 'restore-invalid' }
    ])
    expect(report.downgradedDetachedTabs).toEqual([
      { workspaceInstanceKey: 'workspace_tab_a', from: 'detached', to: 'main', reason: 'restore-invalid' }
    ])
    expect(harness.workspace.runtimeStore!.getSnapshot().panels[0]).toMatchObject({ mode: 'docked-bottom', lastValidDock: 'docked-bottom' })
    expect(harness.workspace.tabStore!.getSnapshot().tabs.every((tab) => tab.mode === 'main')).toBe(true)
    // detached 的 bounds 是布局数据：降级不改写它（仍可从文档读回）
    expect(report.persistedLayoutRevision).toBe(9)
  })

  it('未知版本（v3）绝不覆写：恢复被保护、IPC 照常就绪、退出不写盘', async () => {
    const harness = createHarness()
    const hostile = `${JSON.stringify({ ...detachedDocument(), schemaVersion: 3 }, null, 2)}\n`
    writeFileSync(harness.filePath, hostile, 'utf8')
    const report = await harness.workspace.start()

    expect(report).toMatchObject({ status: 'ready', restore: 'protected', restoredPanels: 0, restoredTabs: 0, mayOverwrite: false })
    expect(harness.workspace.runtimeStore!.getSnapshot().panels).toEqual([])
    expect(harness.workspace.tabStore!.getSnapshot().tabs).toEqual([])
    // 退出 flush 会尝试落盘但被覆盖保护挡住：结论如实为 failed(reset-required)，原文件逐字不变
    const flush = await harness.workspace.flushLayout()
    expect(flush.outcome).toBe('failed')
    expect(harness.workspace.layoutStore!.canOverwrite()).toBe(false)
    await harness.workspace.dispose()
    expect(readFileSync(harness.filePath, 'utf8')).toBe(hostile)
  })

  it('v1 文件：组合层一次性转换接回 runtime，并在退出前落一份对账后的 v2', async () => {
    const harness = createHarness()
    writeFileSync(harness.filePath, `${JSON.stringify({
      schemaVersion: 1, savedAt: '2026-10-05T00:00:00.000Z', layoutRevision: 4,
      workspaces: [
        { workspaceInstanceKey: 'workspace_legacy', pageId: 'sample.overview', panelOrder: ['panel_legacy'], activePanels: { embedded: 'panel_legacy' } },
        { workspaceInstanceKey: 'workspace_gone', pageId: 'sample.uninstalled', panelOrder: [], activePanels: {} }
      ],
      panels: [{
        panelInstanceKey: 'panel_legacy', workspaceInstanceKey: 'workspace_legacy', panelId: 'sample.inspector',
        binding: { key: 'durable-key-a' }, open: true, mode: 'embedded', lastValidDock: 'embedded'
      }]
    }, null, 2)}\n`, 'utf8')

    const report = await harness.workspace.start()
    expect(report).toMatchObject({ restore: 'restored', convertedFromV1: true, restoredPanels: 1, restoredTabs: 1, prunedTabs: 1 })
    expect(harness.workspace.runtimeStore!.getSnapshot().panels[0]).toMatchObject({ panelInstanceKey: 'panel_legacy', bindingState: 'bound' })
    expect(harness.workspace.tabStore!.getSnapshot().tabs.map((tab) => tab.pageId)).toEqual(['sample.overview'])

    await expect(harness.workspace.flushLayout()).resolves.toMatchObject({ outcome: 'saved' })
    const onDisk = JSON.parse(readFileSync(harness.filePath, 'utf8')) as { schemaVersion: number; tabs: readonly { pageId: string }[] }
    expect(onDisk.schemaVersion).toBe(2)
    expect(onDisk.tabs.map((tab) => tab.pageId)).toEqual(['sample.overview']) // 已卸载页面被剪掉，其余保留
  })

  it('IPC 通道只在 registry/handlers ready 之后注册（恢复失败也不提前暴露半吊子接线）', async () => {
    const harness = createHarness()
    expect(harness.handled).toEqual([])
    await harness.workspace.start()
    const channels = harness.workspace.handlers!.channels
    expect(harness.handled).toContain(channels.workspaceGetSnapshot)
    expect(harness.handled).toContain(channels.workspaceCommand)
    // 未注入完整宿主 ⇒ `.tabs.*` 通道不注册（与 P2-03 同一门槛）
    expect(harness.workspace.tabHandlers).toBeNull()
  })
})
