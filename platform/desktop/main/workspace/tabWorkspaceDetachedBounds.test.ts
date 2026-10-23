import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import type { ProductManifest } from '@platform/product-manifest'
import type { WorkspaceBounds } from '@platform/workspace/contracts'
import { WorkspaceDetachedWindowPolicy } from '@platform/workspace/policies'
import { createJsonFileStorage, type JsonFileStorage } from '@platform/storage/jsonFileStorage'
import { createPanelLayoutStore } from '@platform/workspace/persistence/panelLayoutStore'
import { WorkspaceWritePolicy } from '@platform/workspace/persistence/panelLayoutDocument'
import { emptyWorkspaceLayoutDocumentV2, type WorkspaceLayoutDocumentV2 } from '@platform/workspace/persistence/workspaceLayoutDocument'
import { createSecureWindowSecurity } from '../../window/createMainWindow'
import { composePanelWorkspace } from './composePanelWorkspace'
import {
  createPanelDetachedWindowHost,
  type DetachedHostEvent,
  type DetachedWindowFactory,
  type DetachedWindowHandle
} from './panelDetachedWindowHost'
import { createWorkspaceWindowRegistry } from './workspaceWindowRegistry'

/**
 * Owner: platform/desktop/main/workspace（PLAT-04 focused）。权威：清单 PLAT-04 + 技术设计 §7（v2 单写）。
 *
 * 组合层 RED/GREEN 矩阵（真 compose + 真宿主机 + 真 store/handlers + 真 v2 文件；只把窗口工厂与定时器
 * 换成注入 fake，不启动 Electron）：
 *  ① 页窗 resize（跨过合并窗口）⇒ v2 文档里 `tabs[].detachedBounds` 出现且与实测一致（修复前：字段缺失）；
 *  ② 含 `detachedBounds` 的 v2 文档 hydrate ⇒ 页窗按**持久化尺寸**开，而不是策略默认尺寸；
 *  ③ 畸形/缺失/超工作区 bounds ⇒ fail closed：回落策略默认并在工作区内夹紧（绝不 NaN/超屏）；
 *  ④ 连续 N 次 resize ⇒ 落盘次数 ≪ N（采集侧 + 落盘侧双重合并），且最终值正确；
 *  ⑤ 未知 `schemaVersion`：原文件**逐字节不变**，且不因 bounds 采集产生任何写入；
 *  ⑥ shutdown barrier：pending bounds 不丢在退出之后（退出落盘必须含最终尺寸）。
 *
 * 尺寸口径（真机同源）：工作区 1920×1040 ⇒ 策略默认 1280×800（源区域不可用时），夹紧上界 = 工作区。
 */

const PRELOAD = '/app/preload/index.js'
const APP_ROOT = 'file:///app/renderer'
const ENTRY = 'file:///app/renderer/index.html'
const PAGE_ID = 'sample.overview'
const MAIN_WEBCONTENTS = 1
const PAGE_WEBCONTENTS = 100
const WORK_AREA: WorkspaceBounds = { x: 0, y: 0, width: 1920, height: 1040 }
/** 用户实测（模拟真机上用户拖出来的尺寸/位置）：既不是策略默认，也不是源区域放大结果。 */
const USER_BOUNDS: WorkspaceBounds = { x: 120, y: 80, width: 1100, height: 720 }

const MANIFEST = {
  id: 'sample', name: 'Sample', version: '1.0.0',
  shellContributions: {
    menuPages: [{ id: 'overview', title: { 'zh-CN': '总览', 'en-US': 'Overview' }, icon: 'home', order: 1, module: './desktop/pages/overview' }],
    settingsSections: [], panels: []
  },
  routes: [], navigation: [], settingsSections: [], serviceRoutes: [], tools: [], skills: [],
  agents: [], workflows: [], policies: [], evaluations: [], jobHandlers: [], migrations: []
} as unknown as ProductManifest

const roots: string[] = []
afterEach(() => {
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }))
})

type Timer = { delayMs: number; run: () => void; cancelled: boolean; dueAt: number }

function countingStorage(inner: JsonFileStorage<unknown>): { storage: JsonFileStorage<unknown>; counters: { writes: number } } {
  const counters = { writes: 0 }
  return {
    counters,
    storage: {
      read: () => inner.read(),
      write: async (value) => { counters.writes += 1; await inner.write(value) }
    }
  }
}

/** v2 文档：一个 detached 页 Tab（可选 bounds），面板载荷为空（本文件只判 Tab 载荷）。 */
function v2Document(input: { bounds?: unknown; boundsPresent?: boolean; schemaVersion?: number } = {}): Record<string, unknown> {
  const tab: Record<string, unknown> = {
    workspaceInstanceKey: 'workspace_page', pageId: PAGE_ID, open: true, order: 0, mode: 'detached'
  }
  if (input.boundsPresent !== false) tab.detachedBounds = Object.hasOwn(input, 'bounds') ? input.bounds : USER_BOUNDS
  return {
    schemaVersion: input.schemaVersion ?? 2,
    savedAt: '2026-10-06T00:00:00.000Z', layoutRevision: 9,
    workspaces: [{ workspaceInstanceKey: 'workspace_page', pageId: PAGE_ID, panelOrder: [], activePanels: {} }],
    panels: [], tabs: [tab], activeWorkspaceInstanceKey: 'workspace_page'
  }
}

function createHarness() {
  const root = mkdtempSync(join(tmpdir(), 'plat-04-bounds-'))
  roots.push(root)
  const filePath = join(root, 'layout.json')
  let sequence = 0
  let clock = 0
  const timers: Timer[] = []
  const created: WorkspaceBounds[] = []
  const emitters: Array<(bounds: WorkspaceBounds) => void> = []
  const hostEvents: DetachedHostEvent[] = []
  const registry = createWorkspaceWindowRegistry({ createOpaqueId: (prefix) => `${prefix}-${++sequence}` })

  const createWindow: DetachedWindowFactory = (input) => {
    created.push({ ...input.bounds })
    const listeners = new Set<(bounds: WorkspaceBounds) => void>()
    emitters.push((bounds) => { for (const listener of [...listeners]) listener(bounds) })
    const handle = {
      webContentsId: PAGE_WEBCONTENTS + created.length,
      loadURL: () => Promise.resolve(),
      isDestroyed: () => false,
      isCrashed: () => false,
      destroy: () => undefined,
      focus: () => undefined,
      setWindowOpenHandler: () => undefined,
      onBoundsChanged: (listener: (bounds: WorkspaceBounds) => void) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      }
    } as unknown as DetachedWindowHandle
    return handle
  }

  const timerPort = {
    schedule: (delayMs: number, run: () => void) => {
      const entry: Timer = { delayMs, run, cancelled: false, dueAt: clock + delayMs }
      timers.push(entry)
      return () => { entry.cancelled = true }
    }
  }

  let workspaceRef: { publishHostEvent: ReturnType<typeof composePanelWorkspace>['publishHostEvent'] } | null = null
  const host = createPanelDetachedWindowHost({
    entryUrl: ENTRY, appRoot: APP_ROOT, createWindow,
    security: createSecureWindowSecurity({ preload: PRELOAD, openExternal: () => undefined }),
    registry,
    displays: () => [{ id: 'primary', workArea: WORK_AREA, scaleFactor: 2 }],
    timers: timerPort,
    onEvent: (event: DetachedHostEvent) => { hostEvents.push(event); workspaceRef?.publishHostEvent(event) }
  })

  const inner = createJsonFileStorage<unknown>(filePath, emptyWorkspaceLayoutDocumentV2())
  const counted = countingStorage(inner)
  const layoutStore = createPanelLayoutStore({ filePath, storage: counted.storage, timers: timerPort })
  const composition = composePanelWorkspace({
    productManifests: [MANIFEST],
    ipcMain: { handle: () => undefined },
    layoutFilePath: filePath,
    panelLayoutStore: layoutStore,
    sendToHost: () => true,
    preferences: { getLanguage: async () => 'zh-CN', getTheme: () => 'light' , getTimeZone: async () => 'UTC'},
    windowRegistry: registry,
    detachedHost: host,
    transferTimers: timerPort,
    savedAtNow: () => '2026-10-06T00:00:00.000Z'
  })
  if (composition.status !== 'ready') throw new Error(`composition disabled: ${composition.reason}`)
  workspaceRef = { publishHostEvent: composition.publishHostEvent }
  const tabHandlers = composition.tabHandlers
  if (tabHandlers === null) throw new Error('tab handlers not wired')

  const event = (webContentsId: number) => ({
    senderFrame: { parent: null }, sender: { id: webContentsId, isDestroyed: () => false }
  })
  const settle = async (): Promise<void> => {
    for (let turn = 0; turn < 20; turn += 1) await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))
    for (let turn = 0; turn < 20; turn += 1) await Promise.resolve()
  }
  /** 手动时钟：只在请求的窗口内兑现定时器（绝不推进真实时间）。 */
  const advance = async (deltaMs: number): Promise<void> => {
    const target = clock + deltaMs
    for (;;) {
      const next = timers.filter((timer) => !timer.cancelled && timer.dueAt <= target)
        .sort((left, right) => left.dueAt - right.dueAt)[0]
      if (next === undefined) break
      next.cancelled = true
      clock = next.dueAt
      next.run()
      await settle()
    }
    clock = target
    await settle()
  }
  const mainWindow = composition.registerMainWindow({ webContentsId: MAIN_WEBCONTENTS })
  const tabRevision = (): number => composition.tabStore.getSnapshot().layoutRevision
  const openTab = async (): Promise<string> => {
    const result = await tabHandlers.command(event(MAIN_WEBCONTENTS), {
      method: 'openTab', requestId: 'req-open', expectedRevision: tabRevision(),
      windowInstanceId: mainWindow.windowInstanceId, hostEpoch: mainWindow.hostEpoch, pageId: PAGE_ID
    })
    if (result.status !== 'applied' || result.workspaceInstanceKey === undefined) throw new Error(`openTab failed: ${JSON.stringify(result)}`)
    return result.workspaceInstanceKey
  }
  const detachTab = (workspaceInstanceKey: string) => tabHandlers.command(event(MAIN_WEBCONTENTS), {
    method: 'detachTab', requestId: 'req-detach', expectedRevision: tabRevision(),
    windowInstanceId: mainWindow.windowInstanceId, hostEpoch: mainWindow.hostEpoch, workspaceInstanceKey
  })
  const onDisk = (): WorkspaceLayoutDocumentV2 => JSON.parse(readFileSync(filePath, 'utf8')) as WorkspaceLayoutDocumentV2
  const rawOnDisk = (): string => readFileSync(filePath, 'utf8')
  /** 真机语义：页窗自己报告 resize/move（Main 侧只做观察，不接受 renderer 自报身份）。 */
  const resizePageWindow = (bounds: WorkspaceBounds, index = 0): void => {
    const emit = emitters[index]
    if (emit === undefined) throw new Error('no live page window to resize')
    emit(bounds)
  }

  return {
    composition, tabHandlers, layoutStore, registry, host, created, emitters, hostEvents,
    filePath, counters: counted.counters, event, tabRevision, openTab, detachTab, advance, settle,
    onDisk, rawOnDisk, resizePageWindow, mainWindow
  }
}

describe('PLAT-04 组合层：页窗 bounds 采集到 v2 单写路径', () => {
  it('① resize（跨过合并窗口）⇒ v2 文档出现 tabs[].detachedBounds 且与实测一致（当前：字段缺失）', async () => {
    const harness = createHarness()
    await harness.composition.start()
    const key = await harness.openTab()
    const detached = await harness.detachTab(key)
    expect(detached.status).toBe('applied')

    harness.resizePageWindow(USER_BOUNDS)
    await harness.advance(WorkspaceWritePolicy.boundsMergeMs * 2)
    await harness.layoutStore.flush()

    const onDisk = harness.onDisk()
    expect(onDisk.schemaVersion).toBe(2)
    expect(onDisk.tabs[0]).toMatchObject({ workspaceInstanceKey: key, mode: 'detached' })
    expect(onDisk.tabs[0]?.detachedBounds).toEqual(USER_BOUNDS)
    expect(harness.rawOnDisk()).not.toMatch(/"schemaVersion": 1/u) // 绝不旧格式双写
  })

  it('② 含 detachedBounds 的 v2 文档 hydrate ⇒ 页窗按持久化尺寸开（策略默认绝不覆盖用户尺寸）', async () => {
    const harness = createHarness()
    writeFileSync(harness.filePath, `${JSON.stringify(v2Document({ bounds: USER_BOUNDS }), null, 2)}\n`, 'utf8')
    const report = await harness.composition.start()
    expect(report).toMatchObject({ restore: 'restored', restoredTabs: 1 })
    // 启动期不物化页窗（P2-04 语义）：降级为 main，但用户尺寸作为布局数据被保留
    expect(harness.composition.tabStore.getSnapshot().tabs[0]).toMatchObject({ mode: 'main' })
    expect(harness.composition.tabStore.detachedBoundsOf('workspace_page')).toEqual(USER_BOUNDS)

    const detached = await harness.detachTab('workspace_page')
    expect(detached.status).toBe('applied')
    expect(harness.created[0]).toEqual(USER_BOUNDS)
    // 缺陷回归门：绝不是策略默认尺寸（源区域不可用时 1280×800）
    expect({ width: harness.created[0]?.width, height: harness.created[0]?.height })
      .not.toEqual({ width: WorkspaceDetachedWindowPolicy.defaultSize.width, height: WorkspaceDetachedWindowPolicy.defaultSize.height })
  })

  it('③ 畸形 / 缺失 bounds ⇒ 回落策略默认并在工作区内夹紧（fail closed）', async () => {
    const cases: Array<{ label: string; document: Record<string, unknown>; expectDefaultSize: boolean }> = [
      { label: '负宽度', document: v2Document({ bounds: { x: 0, y: 0, width: -1280, height: 800 } }), expectDefaultSize: true },
      { label: '零高度', document: v2Document({ bounds: { x: 0, y: 0, width: 1280, height: 0 } }), expectDefaultSize: true },
      { label: 'null', document: v2Document({ bounds: null }), expectDefaultSize: true },
      { label: '缺字段', document: v2Document({ boundsPresent: false }), expectDefaultSize: true },
      { label: '超工作区', document: v2Document({ bounds: { x: 100, y: 100, width: 5000, height: 4000 } }), expectDefaultSize: false }
    ]
    for (const testCase of cases) {
      const harness = createHarness()
      writeFileSync(harness.filePath, `${JSON.stringify(testCase.document, null, 2)}\n`, 'utf8')
      const report = await harness.composition.start()
      // 畸形尺寸只丢字段：整份布局仍恢复（绝不因一个尺寸把用户整个工作区打成 protected）
      expect([testCase.label, report.restore]).toEqual([testCase.label, 'restored'])
      expect(harness.composition.tabStore.getSnapshot().tabs).toHaveLength(1)

      const detached = await harness.detachTab('workspace_page')
      expect([testCase.label, detached.status]).toEqual([testCase.label, 'applied'])
      const bounds = harness.created[0] as WorkspaceBounds
      expect([testCase.label, Number.isFinite(bounds.x) && Number.isFinite(bounds.y)]).toEqual([testCase.label, true])
      expect([testCase.label, bounds.width <= WORK_AREA.width && bounds.height <= WORK_AREA.height]).toEqual([testCase.label, true])
      expect([testCase.label, bounds.x >= WORK_AREA.x && bounds.y >= WORK_AREA.y]).toEqual([testCase.label, true])
      if (testCase.expectDefaultSize) {
        expect([testCase.label, bounds.width, bounds.height])
          .toEqual([testCase.label, WorkspaceDetachedWindowPolicy.defaultSize.width, WorkspaceDetachedWindowPolicy.defaultSize.height])
      }
    }
  })

  it('④ 连续 N 次 resize ⇒ 落盘次数 ≪ N（双重合并），且最终值正确', async () => {
    const harness = createHarness()
    await harness.composition.start()
    const key = await harness.openTab()
    await harness.detachTab(key)
    const revisionBefore = harness.tabRevision()
    const writesBefore = harness.counters.writes

    const resizes = 200
    let last: WorkspaceBounds = USER_BOUNDS
    for (let step = 0; step < resizes; step += 1) {
      last = { x: 10 + step, y: 20, width: 1000 + step, height: 700 }
      harness.resizePageWindow(last)
    }
    // 合并窗口内：一次受控状态更新、零落盘
    expect(harness.tabRevision()).toBe(revisionBefore)
    expect(harness.counters.writes).toBe(writesBefore)

    await harness.advance(WorkspaceWritePolicy.boundsMergeMs * 4)
    await harness.layoutStore.flush()
    const writes = harness.counters.writes - writesBefore

    expect(writes).toBeGreaterThanOrEqual(1)
    expect(writes).toBeLessThan(resizes / 10) // ≪ N
    expect(harness.tabRevision()).toBe(revisionBefore + 1) // 一次拖拽 = 一次受控状态推进
    expect(harness.onDisk().tabs[0]?.detachedBounds).toEqual(last)
  })

  it('⑤ 未知 schemaVersion：原文件逐字节不变，且不因 bounds 采集产生任何写入', async () => {
    const harness = createHarness()
    const hostile = `${JSON.stringify(v2Document({ bounds: USER_BOUNDS, schemaVersion: 3 }), null, 2)}\n`
    writeFileSync(harness.filePath, hostile, 'utf8')
    const report = await harness.composition.start()
    expect(report).toMatchObject({ restore: 'protected', restoredTabs: 0, mayOverwrite: false })

    // 完整走一遍采集链（打开 → 分离 → resize）：受保护文件的写入口一律被挡，且原文件逐字不变
    const key = await harness.openTab()
    expect((await harness.detachTab(key)).status).toBe('applied')
    harness.resizePageWindow(USER_BOUNDS)
    await harness.advance(WorkspaceWritePolicy.boundsMergeMs * 4)
    await harness.layoutStore.flush()
    expect(harness.counters.writes).toBe(0)
    expect(harness.rawOnDisk()).toBe(hostile)

    const dispose = await harness.composition.dispose()
    expect(dispose.flushOutcome).toBe('failed') // reset-required：原始结论如实上报
    expect(harness.rawOnDisk()).toBe(hostile)
  })

  it('⑥ shutdown barrier：pending bounds 不丢在退出之后（dispose 落盘含最终尺寸）', async () => {
    const harness = createHarness()
    await harness.composition.start()
    const key = await harness.openTab()
    await harness.detachTab(key)

    // 关键路径：resize 后**不**推进合并时钟，直接退出（合并窗口内的最终值必须落盘）
    harness.resizePageWindow(USER_BOUNDS)
    const dispose = await harness.composition.dispose()

    expect(dispose.status).toBe('ready')
    expect(harness.onDisk().tabs[0]?.detachedBounds).toEqual(USER_BOUNDS)
  })
})
