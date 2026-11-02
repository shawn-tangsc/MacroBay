import { app, shell, type BrowserWindow } from 'electron'

import { formatBootFailureLogPath, renderBootFailurePage, resolveBootFailureAction } from './bootFailurePage'
import { presentBootFailure, type BootFailureDetail } from './failurePresentation'

/**
 * 把失败页放进已经建好的主窗。这里只做三件事：渲染、接管三个动作、不引入任何产品模块。
 * 业务模块都没起来，这条路径上不允许再出现第二个可能挂掉的东西。
 */
export function showBootFailurePage(window: BrowserWindow, detail: BootFailureDetail): void {
  const logDirectory = `${app.getPath('userData')}/logs`
  const page = presentBootFailure(detail)
  const html = renderBootFailurePage(page, {
    locale: app.getLocale(),
    logPath: formatBootFailureLogPath(process.platform, logDirectory)
  })

  const navigate = (event: Electron.Event, url: string): void => {
    const action = resolveBootFailureAction(url)
    if (!action) return
    event.preventDefault()
    if (action === 'retry') {
      app.relaunch()
      app.exit(0)
      return
    }
    if (action === 'logs') {
      void shell.openPath(logDirectory)
      return
    }
    app.quit()
  }

  window.webContents.on('will-navigate', navigate)
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (resolveBootFailureAction(url)) void window.webContents.loadURL(url)
    return { action: 'deny' }
  })
  void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
}
