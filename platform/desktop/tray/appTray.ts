import type { BrowserWindow, Tray } from 'electron'
import { Menu, nativeImage, Tray as ElectronTray } from 'electron'

import { APP_DISPLAY_NAME } from '../appIdentity'

export function createAppTray(getMainWindow: () => BrowserWindow | null): Tray {
  const tray = new ElectronTray(nativeImage.createEmpty())

  tray.setToolTip(APP_DISPLAY_NAME)
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: 'Show Window',
        click: () => {
          const mainWindow = getMainWindow()
          mainWindow?.show()
          mainWindow?.focus()
        }
      },
      { type: 'separator' },
      {
        label: 'Quit',
        role: 'quit'
      }
    ])
  )

  tray.on('click', () => {
    const mainWindow = getMainWindow()
    mainWindow?.show()
    mainWindow?.focus()
  })

  return tray
}
