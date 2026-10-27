/**
 * 示例模式的装配点：bootstrap 只调这一处，拿到「包装注册表」和「注册控制方法」两个动作。
 *
 * 这样 bootstrap 的改动控制在五六十行以内，而示例模式自己的策略（默认拒绝、占位符、暂停/恢复）
 * 全部留在这个目录里，和采集、存储、分析代码互不纠缠。
 */

import type { JobRuntime } from '@platform/jobs'
import type { ProductIpcRegistrar } from '@platform/desktop/ipc/productIpcRegistry'

import { buildSampleModeCatalog, loadSampleModeCatalog } from './demoCatalog'
import { readSampleModeFilesFromDisk } from './demoCatalogDisk'
import { registerSampleModeIpc } from './demoIpc'
import { wrapProductRegistrar } from './demoOverlay'
import { createSampleModeRecorder, type SampleModeRecorder } from './demoRecorder'
import { createSampleModeSession, type SampleModeSession } from './demoSession'
import type { SampleModeLocale } from './demoScenario'

export type SampleModeRuntime = Readonly<{
  session: SampleModeSession
  recorder?: SampleModeRecorder
  /** 包住产品的 IPC 注册表：方法集合不变，只换执行。 */
  wrap: (register: ProductIpcRegistrar) => ProductIpcRegistrar
  registerIpc: (register: ProductIpcRegistrar) => void
}>

export type SampleModeRuntimeInput = Readonly<{
  productId: string
  jobRuntime: Pick<JobRuntime, 'listSchedules' | 'removeSchedule' | 'listRuns' | 'cancel'>
  getLanguage: () => Promise<SampleModeLocale>
  resumeWork: () => Promise<void>
  suspendWork?: () => Promise<void>
  /** 录制目录；只在 `MB_SAMPLE_RECORD=1` 且给了目录时才录。 */
  recorderDirectory?: string
  /** 开发期场景目录：给了就从磁盘读，改 JSON 不必重启主进程。 */
  scenarioDirectory?: string
  env?: Readonly<Record<string, string | undefined>>
  now?: () => Date
}>

export function createSampleModeRuntime(input: SampleModeRuntimeInput): SampleModeRuntime {
  const env = input.env ?? process.env
  const sessionId = `session-${(input.now ?? (() => new Date()))().toISOString().replace(/[:.]/gu, '-')}`
  const recorder = env.MB_SAMPLE_RECORD === '1' && input.recorderDirectory
    ? createSampleModeRecorder({
        directory: input.recorderDirectory,
        sessionId,
        now: input.now ?? (() => new Date())
      })
    : undefined
  // 开发期读磁盘（改数据只重进示例），打包后读构建期打平的 JSON。
  const loadCatalog = input.scenarioDirectory
    ? (locale: SampleModeLocale) => buildSampleModeCatalog({
        ...readSampleModeFilesFromDisk(input.scenarioDirectory!),
        locale
      })
    : loadSampleModeCatalog
  const session = createSampleModeSession({
    productId: input.productId,
    loadCatalog,
    getLanguage: input.getLanguage,
    jobs: input.jobRuntime,
    ...(input.suspendWork ? { suspendWork: input.suspendWork } : {}),
    resumeWork: input.resumeWork,
    ...(input.now ? { now: input.now } : {}),
    log: (line) => console.log(JSON.stringify(line))
  })
  return Object.freeze({
    session,
    ...(recorder ? { recorder } : {}),
    wrap: (register: ProductIpcRegistrar) => wrapProductRegistrar(register, session, recorder),
    registerIpc: (register: ProductIpcRegistrar) => registerSampleModeIpc(register, input.productId, session)
  })
}
