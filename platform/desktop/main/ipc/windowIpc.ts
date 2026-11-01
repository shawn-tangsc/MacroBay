import {
  app,
  dialog,
  Menu,
  nativeTheme,
  shell,
  type BrowserWindow,
  type IpcMain,
  type IpcMainInvokeEvent,
  type OpenDialogOptions
} from 'electron'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { release } from 'node:os'
import { join } from 'node:path'

import { readTextFilePreview } from '../../../files/attachments/textFilePreview'
import {
  clampWindowSizeToMinimum,
  DEFAULT_MIN_WINDOW_HEIGHT,
  DEFAULT_MIN_WINDOW_WIDTH
} from '../../../ui/window/windowSizing'
import { IpcChannels } from '../../ipc/channels'

/**
 * 窗口 / 应用 / 外壳 / 对话框类 IPC 的注册点。
 *
 * 这一步只是搬家：16 个 handler 的行为逐字未动，`app.ts` 里只留一行调用。
 * 运行期状态**只经两个端口**进来（主窗引用、按 event 推目标窗口），其余 `app` / `dialog` /
 * `shell` / `fs` / `randomUUID` 都是无状态 API，直连即可——把 API 也包成端口不叫解耦，叫多绕一层。
 *
 * `settings` 那两个 handler **不在这里**：它们除了设置存储，还要刷新助手种子、应用会话代理、
 * 通知工作区偏好变更，搬进来会让这个文件不再是「窗口模块」。它们留给 settingsIpc 那一步。
 */
export type WindowIpcPorts = Readonly<{
  getMainWindow: () => BrowserWindow | null
  resolveInvokingWindow: (event: IpcMainInvokeEvent) => BrowserWindow | null
}>

export function registerWindowIpc(ipcMain: Pick<IpcMain, 'handle'>, ports: WindowIpcPorts): void {
  const { getMainWindow, resolveInvokingWindow } = ports

  ipcMain.handle(IpcChannels.appInfo, () => ({
    name: app.getName(),
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    osRelease: release(),
    theme: nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
  }))

  // 自绘标题栏的窗口按钮：目标窗口一律由 `event.sender` 推导（主窗/独立窗同一套按钮，见 resolveInvokingWindow）
  ipcMain.handle(IpcChannels.windowMinimize, (event: IpcMainInvokeEvent) => resolveInvokingWindow(event)?.minimize())
  ipcMain.handle(IpcChannels.windowMaximize, (event: IpcMainInvokeEvent) => {
    const window = resolveInvokingWindow(event)
    if (!window) return false
    if (window.isMaximized()) window.unmaximize()
    else window.maximize()
    return window.isMaximized()
  })
  ipcMain.handle(IpcChannels.windowClose, (event: IpcMainInvokeEvent) => resolveInvokingWindow(event)?.close())
  ipcMain.handle(IpcChannels.windowIsMaximized, (event: IpcMainInvokeEvent) => resolveInvokingWindow(event)?.isMaximized() ?? false)
  ipcMain.handle(IpcChannels.windowSetMinimumSize, (event: IpcMainInvokeEvent, width: number, height: number) => {
    const window = resolveInvokingWindow(event)
    if (!window) return
    const minimumWidth = Number.isFinite(width) ? Math.max(0, Math.floor(width)) : DEFAULT_MIN_WINDOW_WIDTH
    const minimumHeight = Number.isFinite(height) ? Math.max(0, Math.floor(height)) : DEFAULT_MIN_WINDOW_HEIGHT
    window.setMinimumSize(minimumWidth, minimumHeight)
    const [nextWidth, nextHeight] = clampWindowSizeToMinimum(window.getSize() as [number, number], {
      width: minimumWidth,
      height: minimumHeight
    })
    if (nextWidth !== window.getSize()[0] || nextHeight !== window.getSize()[1]) {
      window.setSize(nextWidth, nextHeight)
    }
  })
  ipcMain.handle(IpcChannels.windowResetMinimumSize, (event: IpcMainInvokeEvent) => {
    const window = resolveInvokingWindow(event)
    if (!window) return
    window.setMinimumSize(DEFAULT_MIN_WINDOW_WIDTH, DEFAULT_MIN_WINDOW_HEIGHT)
    const [nextWidth, nextHeight] = clampWindowSizeToMinimum(window.getSize() as [number, number], {
      width: DEFAULT_MIN_WINDOW_WIDTH,
      height: DEFAULT_MIN_WINDOW_HEIGHT
    })
    if (nextWidth !== window.getSize()[0] || nextHeight !== window.getSize()[1]) {
      window.setSize(nextWidth, nextHeight)
    }
  })
  /**
   * 自绘标题栏的**菜单条**（Windows 上 `frame: false` 之后，OS 不再绘制菜单栏，Alt 也唤不出）。
   *
   * 只暴露两件事：应用菜单的**顶层标签**（供渲染层排版），以及「按索引弹出既有子菜单」。
   * 没有任意 channel/命令/role 字符串入口——菜单内容仍是 `buildAppMenu` 里那一份
   * `Menu.setApplicationMenu`，点击行为与原生菜单逐字一致（不新增第二套命令表）。
   */
  ipcMain.handle(IpcChannels.windowMenuList, () => {
    const menu = Menu.getApplicationMenu()
    if (!menu) return []
    return menu.items
      .map((item, index) => ({ index, label: item.label, visible: item.visible }))
      .filter((item) => item.visible && item.label.length > 0)
  })
  ipcMain.handle(IpcChannels.windowMenuPopup, (event: IpcMainInvokeEvent, index: number, x: number, y: number) => {
    const window = resolveInvokingWindow(event)
    const items = Menu.getApplicationMenu()?.items ?? []
    const submenu = Number.isInteger(index) ? items[index]?.submenu : undefined
    if (!window || !submenu) return false
    // 坐标是渲染层给的「菜单按钮左下角」（窗口内容 CSS px = DIP）；非有限值一律夹到 0
    const popupX = Math.max(0, Math.round(Number.isFinite(x) ? x : 0))
    const popupY = Math.max(0, Math.round(Number.isFinite(y) ? y : 0))
    return new Promise<boolean>((resolve) => {
      try {
        submenu.popup({
          window,
          x: popupX,
          y: popupY,
          // 关闭回调：渲染层据此撤掉按钮的「打开中」高亮（渲染层不自己猜关闭时机）
          callback: () => resolve(true)
        })
      } catch {
        resolve(false)
      }
    })
  })
  ipcMain.handle(IpcChannels.shellOpenExternal, (_event: IpcMainInvokeEvent, url: string) => {
    if (!url.startsWith('https://') && !url.startsWith('http://')) {
      throw new Error('Only http(s) URLs can be opened externally.')
    }
    return shell.openExternal(url)
  })
  ipcMain.handle(IpcChannels.shellOpenPath, (_event: IpcMainInvokeEvent, path: string) => {
    if (!path.trim()) return ''
    return shell.openPath(path)
  })
  ipcMain.handle(IpcChannels.appQuoteToMain, (_event: IpcMainInvokeEvent, text: string) => {
    const window = getMainWindow()
    if (!window || !text.trim()) return false
    if (window.isMinimized()) window.restore()
    if (!window.isVisible()) window.show()
    window.focus()
    setTimeout(() => {
      if (!window.isDestroyed()) {
        window.webContents.send(IpcChannels.appQuoteToMain, text)
      }
    }, 100)
    return true
  })
  ipcMain.handle(IpcChannels.dialogSelectDirectory, async () => {
    const options: OpenDialogOptions = {
      properties: ['openDirectory', 'createDirectory'],
      title: '选择工作区'
    }
    const window = getMainWindow()
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
    return result.canceled ? null : result.filePaths[0] ?? null
  })
  ipcMain.handle(IpcChannels.dialogSelectFiles, async () => {
    const options: OpenDialogOptions = {
      properties: ['openFile', 'multiSelections'],
      title: '选择附件'
    }
    const window = getMainWindow()
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
    return result.canceled ? [] : result.filePaths
  })
  ipcMain.handle(IpcChannels.appReadTextFile, async (_event: IpcMainInvokeEvent, path: string) => readTextFilePreview(path))
  ipcMain.handle(IpcChannels.appSaveClipboardImage, async (_event: IpcMainInvokeEvent, payload: unknown) => {
    // Renderer paste path: clipboard pixels are not a filesystem path, so write one temp file and
    // hand the existing attachment reader a normal path.
    if (!payload || typeof payload !== 'object') throw new Error('Invalid clipboard image payload.')
    const { data, mimeType } = payload as { data?: unknown; mimeType?: unknown }
    const bytes =
      data instanceof Uint8Array
        ? data
        : data instanceof ArrayBuffer
          ? new Uint8Array(data)
          : null
    if (!bytes || bytes.byteLength === 0 || bytes.byteLength > 20 * 1024 * 1024) {
      throw new Error('Clipboard image is empty or too large.')
    }
    const extension =
      mimeType === 'image/jpeg'
        ? 'jpg'
        : mimeType === 'image/webp'
          ? 'webp'
          : mimeType === 'image/gif'
            ? 'gif'
            : 'png'
    const directory = join(app.getPath('temp'), 'macrobay-clipboard')
    await mkdirSync(directory, { recursive: true })
    const filePath = join(directory, `paste-${Date.now()}-${randomUUID()}.${extension}`)
    await writeFile(filePath, bytes)
    return filePath
  })
}
