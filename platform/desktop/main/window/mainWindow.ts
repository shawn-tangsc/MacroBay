import { BrowserWindow, type IpcMainInvokeEvent } from 'electron'

import { wireRendererProcessDiagnostics, type RendererProcessDiagnosticEvent } from '../../window/rendererProcessDiagnostics'
import { wireRendererSendGuard } from '../../window/safeRendererSend'
import { wireWindowChromeState } from '../../window/windowChrome'

/**
 * 主窗的持有与接线：建窗、窗口事件、两个取窗口函数。
 *
 * 顺序是这一步的全部意义：建窗 → 发送守卫 → 渲染进程诊断 → 标题栏广播 → `closed` 清引用；
 * 「加载渲染器 → 登记 workspace → 挂载 workspace」是**第二个时机**（产品 seal 之后），所以拆成
 * `createAndWire()` 与 `loadAndMount()` 两个入口，bootstrap 先建窗、后挂载，`activate` 走完整条
 * `createAndLoad()`。谁把它们合成一个函数，主窗的加载时机就会被提前。
 *
 * 不碰的方案点（受保护接缝）：scheme 特权注册、单实例锁、应用名与 `userData` 的读取时机——这些都留在
 * `app.ts` 的启动入口，本模块连看都不看。
 */
export type MainWindowHostPorts = Readonly<{
  createWindow: () => Promise<BrowserWindow>
  loadRenderer: (window: BrowserWindow) => Promise<void>
  logRendererEvent: (event: RendererProcessDiagnosticEvent) => void
  /** 工作区组合体只在产品注册 seal 之后存在；没有它时加载完就结束。 */
  getWorkspace: () => Readonly<{
    registerMainWindow: (input: { webContentsId: number }) => void
    attachMainWindow: (input: { webContentsId: number }) => void
  }> | null
  onClosed?: () => void
}>

export type MainWindowHost = Readonly<{
  getMainWindow: () => BrowserWindow | null
  /** 自绘标题栏窗口按钮的唯一目标：发起调用的那个窗口。 */
  resolveInvokingWindow: (event: IpcMainInvokeEvent) => BrowserWindow | null
  /** 建窗并接窗口事件（不加载渲染器）。 */
  createAndWire: () => Promise<BrowserWindow>
  /** 产品 seal 之后：加载渲染器 → 登记并挂载工作区。 */
  loadAndMount: () => Promise<void>
  /** `activate` 且没有其它窗口时的完整重建。 */
  createAndLoad: () => Promise<void>
}>

export function createMainWindowHost(ports: MainWindowHostPorts): MainWindowHost {
  let current: BrowserWindow | null = null

  function getMainWindow(): BrowserWindow | null {
    return current && !current.isDestroyed() ? current : null
  }

  function resolveInvokingWindow(event: IpcMainInvokeEvent): BrowserWindow | null {
    const window = BrowserWindow.fromWebContents(event.sender)
    return window && !window.isDestroyed() ? window : null
  }

  function wireWindowEvents(window: BrowserWindow): void {
    wireRendererSendGuard(window)
    wireRendererProcessDiagnostics(window, { logEvent: ports.logRendererEvent })
    // 自绘标题栏：最大化/还原事实（主窗与独立窗共用同一条广播，见 `window/windowChrome.ts`）
    wireWindowChromeState(window)
    window.on('closed', () => {
      current = null
      ports.onClosed?.()
    })
  }

  async function createAndWire(): Promise<BrowserWindow> {
    const window = await ports.createWindow()
    current = window
    wireWindowEvents(window)
    return window
  }

  async function loadAndMount(): Promise<void> {
    const window = getMainWindow()
    if (!window) return
    await ports.loadRenderer(window)
    const workspace = ports.getWorkspace()
    if (!workspace) return
    // workspace：重建的主窗同样要登记并在加载后挂载，否则它的 workspace IPC 会被 not-owner 拒绝
    workspace.registerMainWindow({ webContentsId: window.webContents.id })
    workspace.attachMainWindow({ webContentsId: window.webContents.id })
  }

  async function createAndLoad(): Promise<void> {
    await createAndWire()
    await loadAndMount()
  }

  return { getMainWindow, resolveInvokingWindow, createAndWire, loadAndMount, createAndLoad }
}
