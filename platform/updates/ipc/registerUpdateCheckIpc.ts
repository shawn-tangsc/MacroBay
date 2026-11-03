import type { IpcMain } from 'electron'

import type { StructuredTextNode } from '@platform/contracts/structuredText'

import type { UpdateCheckProjection } from '../contracts/updateCheck'
import { IpcChannels } from '../../desktop/ipc/channels'

/**
 * 更新提示的三条通道。
 *
 * **两种模式注册同一套通道**（11-03 用户改的口径）：开发态也要能点出结果——手动查真的发请求、
 * 界面那颗按钮点下去只打开浏览器里的下载页（dmg 不会自己装，文案也这么写）。
 * 旧写法「开发态只注册 `get-state`、另两条不注册」已作废。
 *
 * 所以「开发版不会自己联网」这件事**不靠通道缺席**，靠 `mode` 只决定「启动后挂不挂自动检查」
 * （见 `updateCheckService` 的 `perform` 与组合根的 `startAutomaticCheck`）。
 * 这也意味着零出网必须被**测试断言**（自动阶段 0 次请求），不能再靠「那条路不存在」。
 *
 * 载荷一律为空：`open-link` 的地址由主进程常量拼出，处理器**连地址参数都不接**，
 * 让「传地址」在类型层就不存在，而不是靠调用方守规矩。
 */
export type UpdateCheckIpcPorts = Readonly<{
  getProjection: () => UpdateCheckProjection
  checkNow: () => Promise<UpdateCheckProjection>
  /** `destination` 由渲染层传入，可能是任何东西——处理器原样交给端口，由端口做封闭校验。 */
  openUpdateLink: (destination: unknown) => Promise<{ ok: boolean }>
  /** 说明正文：成功给版本与节点，失败或冷却期一律 `{ ok: false }`（没有这一块）。 */
  getReleaseNotes: () => Promise<{ ok: boolean; version?: string; nodes?: StructuredTextNode[]; truncated?: boolean }>
}>

export function registerUpdateCheckIpc(ipcMain: Pick<IpcMain, 'handle'>, ports: UpdateCheckIpcPorts): void {
  ipcMain.handle(IpcChannels.updatesGetState, () => ports.getProjection())
  ipcMain.handle(IpcChannels.updatesCheckNow, () => ports.checkNow())
  ipcMain.handle(IpcChannels.updatesOpenLink, (_event, destination: unknown) => ports.openUpdateLink(destination))
  ipcMain.handle(IpcChannels.updatesGetReleaseNotes, () => ports.getReleaseNotes())
}
