import { ipcMain } from 'electron'

import { IpcChannels } from '../../desktop/ipc/channels'
import { getEventBusRuntime } from './registerEventBusIpc'

export function registerEventBusIpcHandlers(): void {
  ipcMain.handle(IpcChannels.eventBusGetDiagnostics, (_event, query) => getEventBusRuntime().getDiagnostics(query))
}
