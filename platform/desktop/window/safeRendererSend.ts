import type { BrowserWindow, WebContents } from 'electron'

import { notifyRendererUnavailable } from './rendererLifecycle'

const rendererReady = new WeakMap<WebContents, boolean>()

export function wireRendererSendGuard(window: BrowserWindow): void {
  const { webContents } = window

  const markUnavailable = (): void => {
    rendererReady.set(webContents, false)
    notifyRendererUnavailable()
  }

  rendererReady.set(webContents, false)
  webContents.on('did-start-loading', markUnavailable)
  webContents.on('destroyed', markUnavailable)
  webContents.on('render-process-gone', markUnavailable)
  webContents.on('did-finish-load', () => {
    rendererReady.set(webContents, true)
  })
}

export function safeWebContentsSend(webContents: WebContents, channel: string, ...args: unknown[]): boolean {
  if (webContents.isDestroyed()) return false
  if (rendererReady.get(webContents) !== true) return false
  if (webContents.isLoading()) return false

  try {
    webContents.send(channel, ...args)
    return true
  } catch {
    return false
  }
}

export function safeSendToMainWindow(
  getWindow: () => BrowserWindow | null,
  channel: string,
  ...args: unknown[]
): boolean {
  const window = getWindow()
  if (!window || window.isDestroyed()) return false
  return safeWebContentsSend(window.webContents, channel, ...args)
}
