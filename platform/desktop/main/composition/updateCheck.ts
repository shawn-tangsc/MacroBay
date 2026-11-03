import type { IpcMain } from 'electron'

import { createJsonFileStorage } from '../../../storage/jsonFileStorage'
import type { UpdateCheckProjection } from '../../../updates/contracts/updateCheck'
import { registerUpdateCheckIpc } from '../../../updates/ipc/registerUpdateCheckIpc'
import { openUpdateLink } from '../../../updates/runtime/openUpdateLink'
import { autoCheckDelayMs, createUpdateCheckService } from '../../../updates/runtime/updateCheckService'
import { createEmptyUpdateCheckState } from '../../../updates/runtime/updateCheckState'
import { parseReleaseNotes } from '../../../updates/contracts/releaseNotes'
import { createReleaseNotesService } from '../../../updates/runtime/releaseNotesService'

/**
 * 更新检查的装配：建服务、注册三条通道、把自动检查排到主界面之后。
 *
 * 为什么单独一片而不是塞回 `app.ts`：`app.ts` 是受保护接缝、而且是体积基线文件（只减不增）。
 * 这里只做接线，**不含任何判断**；判断全在 `platform/updates/**` 里。
 * **没有「开发态 / 打包态」这条分支**（11-03 用户定的）：两边逻辑一模一样，区别只由服务里的
 * 「同一个 UTC 自然日最多一次」承担。这个文件**不读任何应用级事实**（数据目录、应用名、装没装
 * 都从入参来），有守卫用例盯着。
 */
export type UpdateCheckCompositionPorts = Readonly<{
  ipcMain: Pick<IpcMain, 'handle'>
  currentVersion: string
  platform: string
  /** `userData/platform/updates/state.json`：日桶、上次结论、上次手动检查都记在这里。 */
  stateFilePath: string
  /** `userData/platform/updates/release-notes.json`：按版本号缓存的说明正文（原文只在主进程）。 */
  releaseNotesFilePath: string
  fetch: typeof fetch
  now: () => Date
  isCheckEnabled: () => Promise<boolean>
  openExternal: (url: string) => Promise<void>
  /** Main → 渲染层：结论落定后广播投影。由组合根给（主窗 + 通道名都在那里定）。 */
  broadcast: (projection: UpdateCheckProjection) => void
  log: (level: 'info' | 'warn', event: string, fields?: Record<string, unknown>) => void
}>

export type UpdateCheckComposition = Readonly<{
  getProjection: () => UpdateCheckProjection
  /** 主界面出来之后调用一次：延迟 15 秒的单次自动检查。不在退出链上，一次性定时器没有清理义务。 */
  startAutomaticCheck: () => void
}>

/**
 * 交付门：**源码启动没有更新能力，安装版/目录版才有**。
 *
 * 只收一个布尔值，不读 `app`——`isPackaged` 由组合根在接缝之后读一次传进来。
 * 上锁后开发版连 `check-now` / `open-link` / `release-notes` 三条通道都不注册，
 * 零出网由「没有那条路」保证，不靠调用方自觉。**改这一行等于开/关能力**，
 * 验收必须同时覆盖 `packaged` 与 `development` 两侧。
 */
export async function composeUpdateCheck(ports: UpdateCheckCompositionPorts): Promise<UpdateCheckComposition> {
  const service = await createUpdateCheckService({
    currentVersion: ports.currentVersion,
    platform: ports.platform,
    storage: createJsonFileStorage(ports.stateFilePath, createEmptyUpdateCheckState()),
    fetch: ports.fetch,
    now: ports.now,
    isCheckEnabled: ports.isCheckEnabled,
    onSettled: ports.broadcast,
    log: ports.log
  })

  const notesService = createReleaseNotesService({
    storage: createJsonFileStorage(ports.releaseNotesFilePath, { version: '', fetchedAt: '', text: '' }),
    fetch: ports.fetch,
    now: ports.now,
    log: ports.log
  })

  registerUpdateCheckIpc(ports.ipcMain, {
    getProjection: service.getProjection,
    checkNow: () => service.checkNow('manual'),
    getReleaseNotes: async () => {
      // 版本由主进程自己的结论取：渲染层不传版本号，也拿不到原文。
      const projection = service.getProjection()
      if (projection.state !== 'available') return { ok: false }
      const body = await notesService.getBody(projection.latestVersion)
      if (body === null) return { ok: false }
      const parsed = parseReleaseNotes(body)
      return parsed === null
        ? { ok: false }
        : { ok: true, version: projection.latestVersion, nodes: parsed.nodes, truncated: parsed.truncated }
    },
    openUpdateLink: (destination) =>
      openUpdateLink(destination, {
        openExternal: ports.openExternal,
        log: ports.log
      })
  })

  return {
    getProjection: service.getProjection,
    startAutomaticCheck: () => {
      /**
       * **源码启动与装好的包走同一条路**（11-03 用户定的）：不再有「开发态不挂定时器」这种分支。
       *
       * 唯一的风险是「开发版每次启动都发一次请求」，由服务里那道**同一个 UTC 自然日最多一次**挡着：
       * 每台开发机每天最多一次，不会变成每开一次窗就打一发。闸门只在服务里一处，这里只负责
       * 「首屏之后试一次」。
       */
      setTimeout(() => {
        void service.checkNow('auto').catch(() => undefined)
      }, autoCheckDelayMs)
    }
  }
}
