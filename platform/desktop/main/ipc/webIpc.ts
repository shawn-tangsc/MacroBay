import type { IpcMain, IpcMainInvokeEvent } from 'electron'

import { IpcChannels } from '../../ipc/channels'

/**
 * Web Search 的 8 个 handler 的注册点。只是搬家：行为逐字未动。
 *
 * 端口只有一个：那组 handler 本身（`createWebSearchIpcHandlers` 的产物）。
 * 通道常量来自 `ipc/channels`，运行期状态一个都不需要。
 */
export type WebIpcPorts = Readonly<{
  webSearch: Readonly<{
    listProviders: () => unknown
    getSettings: () => unknown
    updateSettings: (patch: unknown) => unknown
    updateProvider: (input: unknown) => unknown
    revealProviderApiKey: (providerId: unknown) => unknown
    checkProvider: (input: unknown) => unknown
    searchKeywords: (input: unknown) => unknown
    fetchUrls: (input: unknown) => unknown
  }>
}>

export function registerWebIpc(ipcMain: Pick<IpcMain, 'handle'>, ports: WebIpcPorts): void {
  const { webSearch } = ports

  ipcMain.handle(IpcChannels.webSearchListProviders, () => webSearch.listProviders())
  ipcMain.handle(IpcChannels.webSearchGetSettings, () => webSearch.getSettings())
  ipcMain.handle(IpcChannels.webSearchUpdateSettings, (_event: IpcMainInvokeEvent, patch: unknown) =>
    webSearch.updateSettings(patch)
  )
  ipcMain.handle(IpcChannels.webSearchUpdateProvider, (_event: IpcMainInvokeEvent, input: unknown) =>
    webSearch.updateProvider(input)
  )
  ipcMain.handle(IpcChannels.webSearchRevealProviderApiKey, (_event: IpcMainInvokeEvent, providerId: unknown) =>
    webSearch.revealProviderApiKey(providerId)
  )
  ipcMain.handle(IpcChannels.webSearchCheckProvider, (_event: IpcMainInvokeEvent, input: unknown) =>
    webSearch.checkProvider(input)
  )
  ipcMain.handle(IpcChannels.webSearchSearchKeywords, (_event: IpcMainInvokeEvent, input: unknown) =>
    webSearch.searchKeywords(input)
  )
  ipcMain.handle(IpcChannels.webSearchFetchUrls, (_event: IpcMainInvokeEvent, input: unknown) =>
    webSearch.fetchUrls(input)
  )
}
