import type { IpcMain, IpcMainInvokeEvent } from 'electron'

import { IpcChannels } from '../../ipc/channels'
import { validateLaunchExternalAppRequest } from '../externalApps/externalAppLauncher'

/**
 * 存储/缓存、外部应用、产品清单摘要三类只读（除缓存操作外）handler 的注册点。
 * 它们同属「平台自检面」：都不携带业务状态，只读平台自己的存储与外设。
 *
 * 只是搬家：8 个 handler 的行为逐字未动。
 */
export type StorageIpcPorts = Readonly<{
  cacheGovernance: Readonly<{
    listCaches: () => unknown
    inspectCache: (cacheId: unknown) => unknown
    clearCache: (input: unknown) => unknown
    compactCache: (input: unknown) => unknown
    listOperations: (query?: unknown) => unknown
  }>
  externalApps: Readonly<{
    listInstalledAppViews: () => unknown
    launchWorkspace: (input: ReturnType<typeof validateLaunchExternalAppRequest>) => unknown
  }>
  /** 产品清单摘要：入参在 app.ts 里，这里只取结果。 */
  summarizeProducts: () => unknown
}>

export function registerStorageIpc(ipcMain: Pick<IpcMain, 'handle'>, ports: StorageIpcPorts): void {
  const { cacheGovernance, externalApps, summarizeProducts } = ports

  ipcMain.handle(IpcChannels.productSummaries, () => summarizeProducts())

  // PLAT-27：`platform:external-apps-*` 只补上 handler（此前是死通道）；不新增通道、不改 fail-closed。
  ipcMain.handle(IpcChannels.externalAppsListInstalled, () => externalApps.listInstalledAppViews())
  ipcMain.handle(IpcChannels.externalAppsLaunchWorkspace, (_event: IpcMainInvokeEvent, input: unknown) =>
    externalApps.launchWorkspace(validateLaunchExternalAppRequest(input)))

  ipcMain.handle(IpcChannels.storageListCaches, () => cacheGovernance.listCaches())
  ipcMain.handle(IpcChannels.storageInspectCache, (_event: IpcMainInvokeEvent, cacheId: unknown) =>
    cacheGovernance.inspectCache(cacheId)
  )
  ipcMain.handle(IpcChannels.storageClearCache, (_event: IpcMainInvokeEvent, input: unknown) =>
    cacheGovernance.clearCache(input)
  )
  ipcMain.handle(IpcChannels.storageCompactCache, (_event: IpcMainInvokeEvent, input: unknown) =>
    cacheGovernance.compactCache(input)
  )
  ipcMain.handle(IpcChannels.storageListCacheOperations, (_event: IpcMainInvokeEvent, query?: unknown) =>
    cacheGovernance.listOperations(query)
  )
}
