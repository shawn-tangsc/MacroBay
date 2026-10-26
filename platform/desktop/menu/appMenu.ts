import { app, BrowserWindow, Menu, shell, type MenuItemConstructorOptions } from 'electron'

import { IpcChannels } from '../ipc/channels'

export function buildAppMenu(getMainWindow: () => BrowserWindow | null): void {
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin'
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const }
            ]
          }
        ]
      : []),
    {
      label: 'File',
      submenu: [{ role: process.platform === 'darwin' ? 'close' : 'quit' }]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'delete' },
        { type: 'separator' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        {
          label: 'Bring All To Front',
          click: () => getMainWindow()?.show()
        }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Electron Documentation',
          click: () => shell.openExternal('https://www.electronjs.org/docs/latest')
        }
      ]
    }
  ]

  /**
   * **菜单的唯一定义点**（跨平台只实现一次）：
   *
   *  - macOS：这份模板就是屏幕顶部的系统菜单（Electron 直接绘制）；
   *  - Windows：主窗是 `frame: false`，系统不再绘制菜单栏，渲染层的 `AppMenuBar` 只从
   *    `Menu.getApplicationMenu()` 读**顶层标签**、点开时让 Main 用同一个子菜单 `popup()`
   *    （见 `platform/desktop/main/app.ts` 的 `windowMenuList` / `windowMenuPopup`）。
   *
   * 因此新增/删除菜单、改菜单功能，**只改这里的 template**：两个平台同步生效，渲染层不需要
   * 第二份菜单表（渲染层里出现菜单文案/命令就是重复实现，由
   * `platform/desktop/menu/appMenu.singleSource.test.ts` 守住）。
   */
  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
  /**
   * 菜单是应用级共享状态：重建后通知**所有**窗口重新读顶层标签（渲染层不缓存、不猜）。
   * 只在 `buildAppMenu` 里发一次，主窗与独立窗因此永远显示同一份菜单。
   */
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue
    try {
      window.webContents.send(IpcChannels.windowMenuChanged)
    } catch {
      // 渲染器已消失（重载/崩溃）时只丢一条外观事件，不影响菜单本身
    }
  }
}
