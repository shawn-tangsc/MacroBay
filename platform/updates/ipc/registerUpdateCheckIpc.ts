import type { IpcMain } from 'electron'

import type { UpdateCheckProjection } from '../contracts/updateCheck'
import { IpcChannels } from '../../desktop/ipc/channels'

/**
 * 更新提示的三条通道。
 *
 * **开发态只注册 `get-state`**：另外两条根本不注册，不是「注册了再返回不可用」。
 * 不存在的通道发不出请求——「零出网」由「没有那条路」保证，不靠调用方自觉。
 * `get-state` 必须留，否则界面拿不到「开发态」这个值，只能靠猜。
 *
 * 载荷一律为空：`open-link` 的地址由主进程常量拼出，处理器**连地址参数都不接**，
 * 让「传地址」在类型层就不存在，而不是靠调用方守规矩。
 */
export type UpdateCheckIpcPorts = Readonly<{
  mode: 'packaged' | 'development'
  getProjection: () => UpdateCheckProjection
  checkNow: () => Promise<UpdateCheckProjection>
  /** `destination` 由渲染层传入，可能是任何东西——处理器原样交给端口，由端口做封闭校验。 */
  openUpdateLink: (destination: unknown) => Promise<{ ok: boolean }>
}>

export function registerUpdateCheckIpc(ipcMain: Pick<IpcMain, 'handle'>, ports: UpdateCheckIpcPorts): void {
  ipcMain.handle(IpcChannels.updatesGetState, () => ports.getProjection())

  // 开发态到此为止：下面两条通道在源码启动时不存在。
  if (ports.mode !== 'packaged') return

  ipcMain.handle(IpcChannels.updatesCheckNow, () => ports.checkNow())
  ipcMain.handle(IpcChannels.updatesOpenLink, (_event, destination: unknown) => ports.openUpdateLink(destination))
}
