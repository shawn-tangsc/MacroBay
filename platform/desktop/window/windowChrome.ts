import type { BrowserWindow } from 'electron'

import { IpcChannels } from '../ipc/channels'

/**
 * Owner: platform/desktop/window（**跨平台窗口装饰的唯一来源**）。
 *
 * 目标姿态与常见「同时支持 macOS / Windows」的桌面应用一致：
 *  - macOS：`hiddenInset` —— 原生红绿灯内嵌在左上角，内容一直铺到窗口顶部；
 *  - Windows：`frame: false` —— 没有 OS 绘制的标题条，窗口顶部那一行由渲染层自绘
 *    （主窗 `.topbar`、独立窗 `WorkspaceWindowTopBar`），最小化/最大化/关闭画在该行最右侧
 *    （`WindowControls`）；
 *  - 其它平台：保留原生装饰（当前发行目标不含 Linux 桌面，不为未验证的平台改外观）。
 *
 * Windows 上**不**另传 `thickFrame`：Electron 对无边框窗的默认值仍是 `true`，即保留原生缩放边、
 * 阴影、贴边吸附与双击最大化——拖动区命中测试返回 `HTCAPTION`，这些手势由系统自己处理，
 * 渲染层不需要实现任何窗口拖拽/吸附逻辑。
 *
 * 主窗与独立面板窗必须消费**同一份**选项（PLAT-39 ① 的装饰对齐要求），因此这里只导出策略，
 * 调用点不得各写一套布尔值。
 */
export type WindowChromeOptions = {
  frame?: boolean
  titleBarStyle?: 'default' | 'hidden' | 'hiddenInset'
  trafficLightPosition?: { x: number; y: number }
}

export function resolveWindowChromeOptions(platform: NodeJS.Platform = process.platform): WindowChromeOptions {
  if (platform === 'darwin') {
    return { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 14 } }
  }
  if (platform === 'win32') {
    return { frame: false }
  }
  return { titleBarStyle: 'default' }
}

/**
 * 自绘标题栏的**最大化/还原**事实广播：只发给**窗口自己**的渲染器（`WindowControls` 据此换图形）。
 *
 * 主窗（`wireWindowEvents`）与独立窗（`panelDetachedWindowFactory`）共用同一条广播；
 * 事件端口缺失（测试替身）或窗口已销毁时静默跳过——外观事件绝不影响窗口语义，也绝不冒泡。
 */
export function wireWindowChromeState(window: BrowserWindow): void {
  const send = (): void => {
    if (window.isDestroyed()) return
    const webContents = window.webContents as { send?: (channel: string, ...args: unknown[]) => void } | undefined
    if (typeof webContents?.send !== 'function') return
    try {
      webContents.send(IpcChannels.windowMaximizedChanged, window.isMaximized())
    } catch {
      // 渲染器已消失（重载/崩溃）时只丢一条外观事件，不影响窗口本身
    }
  }
  const on = (window as unknown as { on?: (event: string, listener: () => void) => void }).on
  if (typeof on !== 'function') return
  try {
    on.call(window, 'maximize', send)
    on.call(window, 'unmaximize', send)
  } catch {
    // 事件端口缺失（测试替身）时不影响建窗
  }
}
