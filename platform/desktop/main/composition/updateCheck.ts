import type { IpcMain } from 'electron'

import { createJsonFileStorage } from '../../../storage/jsonFileStorage'
import type { UpdateCheckProjection } from '../../../updates/contracts/updateCheck'
import { registerUpdateCheckIpc } from '../../../updates/ipc/registerUpdateCheckIpc'
import { openUpdateLink } from '../../../updates/runtime/openUpdateLink'
import { autoCheckDelayMs, createUpdateCheckService, type UpdateCheckMode } from '../../../updates/runtime/updateCheckService'
import { createEmptyUpdateCheckState } from '../../../updates/runtime/updateCheckState'

/**
 * 更新检查的装配：建服务、注册三条通道、把自动检查排到主界面之后。
 *
 * 为什么单独一片而不是塞回 `app.ts`：`app.ts` 是受保护接缝、而且是体积基线文件（只减不增）。
 * 这里只做接线，**不含任何判断**；判断全在 `platform/updates/**` 里，模式仍由组合根判一次传进来
 * （开发期写死 `'packaged'`，交付前改成按「装没装」判的三元；那一行带交付标记，留在 app.ts 里）。
 * 这个文件**不读任何应用级事实**（数据目录、应用名、装没装都从入参来），有守卫用例盯着。
 */
export type UpdateCheckCompositionPorts = Readonly<{
  ipcMain: Pick<IpcMain, 'handle'>
  mode: UpdateCheckMode
  currentVersion: string
  platform: string
  /** `userData/platform/updates/state.json`：日桶、上次结论、上次手动检查都记在这里。 */
  stateFilePath: string
  fetch: typeof fetch
  now: () => Date
  isCheckEnabled: () => Promise<boolean>
  openExternal: (url: string) => Promise<void>
  log: (level: 'info' | 'warn', event: string, fields?: Record<string, unknown>) => void
}>

export type UpdateCheckComposition = Readonly<{
  getProjection: () => UpdateCheckProjection
  /** 主界面出来之后调用一次：延迟 15 秒的单次自动检查。不在退出链上，一次性定时器没有清理义务。 */
  startAutomaticCheck: () => void
}>

export async function composeUpdateCheck(ports: UpdateCheckCompositionPorts): Promise<UpdateCheckComposition> {
  const service = await createUpdateCheckService({
    mode: ports.mode,
    currentVersion: ports.currentVersion,
    platform: ports.platform,
    storage: createJsonFileStorage(ports.stateFilePath, createEmptyUpdateCheckState()),
    fetch: ports.fetch,
    now: ports.now,
    isCheckEnabled: ports.isCheckEnabled,
    log: ports.log
  })

  registerUpdateCheckIpc(ports.ipcMain, {
    mode: ports.mode,
    getProjection: service.getProjection,
    checkNow: () => service.checkNow('manual'),
    openUpdateLink: () =>
      openUpdateLink({
        openExternal: ports.openExternal,
        log: ports.log
      })
  })

  return {
    getProjection: service.getProjection,
    startAutomaticCheck: () => {
      // 闸门在服务里（开关、同一个 UTC 自然日最多一次）；这里只负责「什么时候试一次」。
      setTimeout(() => {
        void service.checkNow('auto').catch(() => undefined)
      }, autoCheckDelayMs)
    }
  }
}
