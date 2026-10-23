import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { IpcMain } from 'electron'

import type { ProductManifest } from '@platform/product-manifest'
import { IpcChannels } from '../../ipc/channels'
import { composePanelWorkspace } from './composePanelWorkspace'
import { createWorkspaceWindowRegistry } from './workspaceWindowRegistry'

/**
 * Owner: platform/desktop/main/workspace（**PLAT-32 / PLAT-26** focused）。回归：本文件。
 *
 * `app.ts` 顺序为 `createMainWindow()`（about:blank，preload 已挂）→ `composePanelWorkspace(...)` →
 * `await start()`（**handler 这时才注册**）⇒ 任何在 `start()` 之前被挂载/驱动的窗口都可能打出
 * 面板/`.tabs.*` 通道的 `No handler registered`。产品自身渲染进程因更晚挂载 + 受控角色握手门控而不受影响；
 * 这是**顺序性隐患**而非当前用户可见故障。
 *
 * 修法（本文件固定）：把「**注册 handler**」与「**恢复布局**」拆成两个入口 —— `registerChannels()` 只挂
 * 7 条受控通道（内容/准入链逐字不变、幂等）且可在**建窗之前**调用；`start()` 内部先注册再恢复一次
 * （restore 语义/fail-closed 门槛不变），其返回值仍是启动报告的唯一权威来源。
 *
 * 本文件不启动 Electron：用「记录型 ipcMain」复刻 Electron 的 `ipcRenderer.invoke` 语义
 * （未注册通道 ⇒ `Error invoking remote method '<channel>': Error: No handler registered for '<channel>'`）。
 */

const MAIN_WEBCONTENTS = 1
const PAGE_ID = 'sample.overview'

const composeManifest = {
  id: 'sample', name: 'Sample', version: '1.0.0',
  shellContributions: {
    menuPages: [{
      id: 'overview', title: { 'zh-CN': '总览', 'en-US': 'Overview' }, icon: 'home', order: 1,
      module: './desktop/pages/overview'
    }],
    settingsSections: [], panels: []
  },
  routes: [], navigation: [], settingsSections: [], serviceRoutes: [], tools: [], skills: [],
  agents: [], workflows: [], policies: [], evaluations: [], jobHandlers: [], migrations: []
} as unknown as ProductManifest

const roots: string[] = []
afterEach(() => {
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }))
})

const mainEvent = () => ({
  senderFrame: { parent: null }, sender: { id: MAIN_WEBCONTENTS, isDestroyed: () => false }
})

/** 受控通道全集：4 条面板通道 + 3 条 `.tabs.*`（与本包前序用例的清单逐字一致）。 */
const PANEL_CHANNELS = [
  'workspaceGetHostContext', 'workspaceGetSnapshot', 'workspaceCommand', 'workspaceHostLifecycle'
] as const
const TAB_CHANNELS = ['workspaceTabsGetSnapshot', 'workspaceTabsCommand', 'workspaceTabsHostLifecycle'] as const

/**
 * 记录型 ipcMain：`handle` 语义与 Electron 一致（重复注册同一通道必须抛错），
 * `invoke` 复刻 renderer 侧 `ipcRenderer.invoke` 的原文错误（未注册 ⇒ No handler registered）。
 */
function createRecordingIpcMain() {
  const listeners = new Map<string, (event: unknown, payload?: unknown) => unknown>()
  return {
    handledChannels: () => [...listeners.keys()],
    ipcMain: {
      handle: (channel: string, listener: (event: unknown, payload?: unknown) => unknown): void => {
        if (listeners.has(channel)) throw new Error(`Attempted to register a second handler for '${channel}'`)
        listeners.set(channel, listener)
      }
    } as unknown as Pick<IpcMain, 'handle'>,
    invoke: async (channel: string, event: unknown = mainEvent(), payload?: unknown): Promise<unknown> => {
      const listener = listeners.get(channel)
      if (listener === undefined) {
        throw new Error(`Error invoking remote method '${channel}': Error: No handler registered for '${channel}'`)
      }
      return await listener(event, payload)
    }
  }
}

/** 完整宿主的最小 stub：compose 只在「是否含 requestDetach」上判定编排启用（其余端口按需调用）。 */
const detachedHostStub = {
  requestDetach: async () => ({ status: 'unsupported' as const, errorCode: 'unsupported' as const }),
  subscribeDetachedWindowBounds: () => () => undefined,
  flushPendingDetachedWindowBounds: () => undefined,
  pendingOperationIds: () => [] as readonly string[],
  committedOwners: () => [] as readonly string[],
  redockedByUser: () => false,
  closedByPanelCommand: () => false,
  closeDetachedWindow: async () => ({ status: 'closed' as const })
} as unknown as Parameters<typeof composePanelWorkspace>[0]['detachedHost']

async function createHarness(options: { withDetachedHost?: boolean; layoutFilePath?: string } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'plat-26-register-order-'))
  roots.push(root)
  const recording = createRecordingIpcMain()
  const composition = composePanelWorkspace({
    productManifests: [composeManifest],
    ipcMain: recording.ipcMain,
    layoutFilePath: options.layoutFilePath ?? join(root, 'workspace', 'panel-layout.json'),
    sendToHost: () => true,
    preferences: { getLanguage: async () => 'en-US', getTheme: async () => 'light' , getTimeZone: async () => 'UTC'},
    windowRegistry: createWorkspaceWindowRegistry(),
    ...(options.withDetachedHost === true ? { detachedHost: detachedHostStub } : {})
  })
  if (composition.status !== 'ready') throw new Error(`composition disabled: ${composition.reason}`)
  return { root, composition, recording }
}

describe('PLAT-26 ①：顺序性隐患复现（注册前驱动受控面 ⇒ Electron 原文 No handler registered）', () => {
  it('建窗（登记 + 受控挂载）发生在 handler 注册之前 ⇒ 面板与 `.tabs.*` 通道都打 No handler registered', async () => {
    const { composition, recording } = await createHarness({ withDetachedHost: true })
    // 真机时序：窗口先建（此时 preload 已挂），workspace handler 尚未注册
    composition.registerMainWindow({ webContentsId: MAIN_WEBCONTENTS })
    composition.attachMainWindow({ webContentsId: MAIN_WEBCONTENTS })

    for (const channel of [...PANEL_CHANNELS, ...TAB_CHANNELS]) {
      await expect(recording.invoke(IpcChannels[channel])).rejects.toThrow(
        new RegExp(`No handler registered for '${IpcChannels[channel]}'`, 'u')
      )
    }
  })
})

describe('PLAT-26 ②：拆开后「先注册、再建窗」⇒ 建窗驱动的受控面全部有 handler', () => {
  it('registerChannels() 挂满 7 条通道（4 面板 + 3 `.tabs.*`），且注册内容与准入链不变', async () => {
    const { composition, recording } = await createHarness({ withDetachedHost: true })
    composition.registerChannels()

    expect(recording.handledChannels().sort()).toEqual(
      [...PANEL_CHANNELS, ...TAB_CHANNELS].map((channel) => IpcChannels[channel]).sort()
    )
    // 幂等：重复注册（例如 start() 内部再挂一次）绝不抛「second handler」
    expect(() => composition.registerChannels()).not.toThrow()
    expect(recording.handledChannels()).toHaveLength(7)

    // 建窗 + 驱动受控面：全部成功（admission 链逐字不变：未登记/被拒仍 fail closed）
    composition.registerMainWindow({ webContentsId: MAIN_WEBCONTENTS })
    composition.attachMainWindow({ webContentsId: MAIN_WEBCONTENTS })
    await expect(recording.invoke(IpcChannels.workspaceGetHostContext)).resolves.toMatchObject({
      status: 'ok', context: { role: 'main' }
    })
    await expect(recording.invoke(IpcChannels.workspaceGetSnapshot)).resolves.toMatchObject({ status: 'ok' })
    await expect(recording.invoke(IpcChannels.workspaceTabsGetSnapshot)).resolves.toMatchObject({ status: 'ok' })
    // 未登记宿主仍然被拒（注册提前绝不放宽准入）
    await expect(recording.invoke(IpcChannels.workspaceGetSnapshot, {
      senderFrame: { parent: null }, sender: { id: 9999, isDestroyed: () => false }
    })).resolves.toMatchObject({ status: 'rejected' })
  })

  it('没有完整宿主时只挂 4 条面板通道（`.tabs.*` 的 P2-03 门槛不因拆分而提前）', async () => {
    const { composition, recording } = await createHarness()
    composition.registerChannels()
    expect(composition.tabHandlers).toBeNull()
    expect(recording.handledChannels().sort()).toEqual(
      PANEL_CHANNELS.map((channel) => IpcChannels[channel]).sort()
    )
  })

  it('registerChannels() 只注册、绝不恢复；恢复仍只由 start() 执行一次（restore 语义不变）', async () => {
    const first = await createHarness({ withDetachedHost: true })
    first.composition.registerChannels()
    first.composition.registerMainWindow({ webContentsId: MAIN_WEBCONTENTS })
    // 真实命令写下一份布局（单写出口 v2），供第二次组合体恢复
    const opened = await first.composition.runtimeStore.openWorkspace({
      requestId: 'req-open', expectedRevision: 0, pageId: PAGE_ID
    })
    expect(opened.status).toBe('applied')
    await expect(first.composition.flushLayout()).resolves.toMatchObject({ outcome: 'saved' })

    const second = await createHarness({ withDetachedHost: true, layoutFilePath: join(first.root, 'workspace', 'panel-layout.json') })
    second.composition.registerChannels()
    // 只注册：运行期状态仍是「未恢复」的初始快照
    expect(second.composition.runtimeStore.getSnapshot().panels).toEqual([])
    expect(second.composition.runtimeStore.getSnapshot().pageLayouts).toEqual([])
    expect(second.composition.runtimeStore.getSnapshot().layoutRevision).toBe(0)
    // start() 才恢复（有界加载 + 迟到 CAS 恢复的单点执行），并仍是启动报告的唯一权威来源
    await expect(second.composition.start()).resolves.toMatchObject({ status: 'ready' })
    expect(second.composition.runtimeStore.getSnapshot().pageLayouts.length).toBeGreaterThan(0)
  })
})

describe('PLAT-26 ③：app.ts 快照的结构判据（注册语句位于建窗之前）', () => {
  const appSource = readFileSync(resolve(__dirname, '../app.ts'), 'utf8')
  const bootstrapSource = appSource.slice(appSource.indexOf('export async function bootstrapDesktopApp('))

  it('app.ts 在 bootstrap 里调用 registerChannels()，且位于建窗之前', () => {
    const register = 'panelWorkspace.registerChannels()'
    const bootWindow = 'mainWindow = await createMainWindow()'
    const rendererLoad = 'await loadMainWindowRenderer(mainWindow)'

    expect(bootstrapSource).toContain(register)
    expect(bootstrapSource).toContain(bootWindow)
    expect(bootstrapSource.indexOf(register)).toBeGreaterThan(-1)
    expect(bootstrapSource.indexOf(register)).toBeLessThan(bootstrapSource.indexOf(bootWindow))
    expect(bootstrapSource.indexOf(register)).toBeLessThan(bootstrapSource.indexOf(rendererLoad))
  })

  it('恢复布局仍在产品 seal 之后、renderer 加载之前（且启动报告一行不动）', () => {
    const restore = 'reportPanelWorkspaceStart({ report: await panelWorkspace.start() })'
    const productSeal = 'productIpcRegistry.seal(expectedProductIpcMethods(productManifests))'
    const rendererLoad = 'await loadMainWindowRenderer(mainWindow)'

    expect(bootstrapSource).toContain(restore)
    expect(bootstrapSource.indexOf(productSeal)).toBeLessThan(bootstrapSource.indexOf(restore))
    expect(bootstrapSource.indexOf(restore)).toBeLessThan(bootstrapSource.indexOf(rendererLoad))
    // 受保护 seam：workspace 通道仍只经 compose 注册，app.ts 不得自行 handle 任意 workspace 通道
    for (const channel of [...PANEL_CHANNELS, ...TAB_CHANNELS]) {
      expect(appSource).not.toContain(`ipcMain.handle(IpcChannels.${channel}`)
    }
  })
})
