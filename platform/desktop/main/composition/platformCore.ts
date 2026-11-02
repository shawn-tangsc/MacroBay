import { mkdirSync } from 'node:fs'
import { safeStorage } from 'electron'
import { join } from 'node:path'

import { createElectronSecretVault } from '../../../secrets'
import { redactText } from '../../../secrets/redaction/redactText'
import { createAppLog } from '../../../observability/logging/appLog'
import { createSettingsStore } from '../../../settings/store/settingsStore'
import { createJsonFileStorage } from '../../../storage/jsonFileStorage'
import { createDefaultAppSettings } from '../../../settings/schema/appSettings'
import { createRendererProcessLog } from '../../window/rendererProcessLog'
import { createShellTimeZoneProvider } from '../shellTimeZone'
import { createProviderStore } from '../../../ai/providers/providerStore'
import { createProviderSqliteStorage } from '../../../ai/providers/storage/providerSqliteStorage'
import { createTaskIpcScheduleValidationOptions } from '../taskScheduleValidationOptions'
import { createMainWindowHost } from '../window/mainWindow'
import { createMainWindow, loadMainWindowRenderer } from '../../window/createMainWindow'
import { getPanelWorkspaceForDisposal } from './slots'

export type PlatformCorePorts = Readonly<{
  userDataPath: string
  appVersion: string
  platform: string
  workspaceTestFixtures: ReturnType<typeof import('../workspaceTestFixtures').resolveWorkspaceTestFixtures>
}>

export function createPlatformCore(ports: PlatformCorePorts) {
  const { userDataPath, appVersion, platform, workspaceTestFixtures } = ports

const platformDataDirectory = join(userDataPath, 'platform')
mkdirSync(platformDataDirectory, { recursive: true })
const settingsStore = createSettingsStore(
  createJsonFileStorage(join(userDataPath, 'platform', 'settings.json'), createDefaultAppSettings())
)
/** 主进程唯一的「读者时区」来源；任务排期、免打扰、日报调度、分析展示都从这里取。 */
const shellTimeZone = createShellTimeZoneProvider({ settings: settingsStore })
const providerSecretVault = createElectronSecretVault({
  directory: join(userDataPath, 'platform', 'secrets'),
  safeStorage
})
// PLAT-72：供应商/模型改为 SQLite 行级存储；旧的 `platform/model-providers.json` 已废弃，
// 代码不再读取、不删除、不改名 —— 原样留在磁盘上作为用户的备份（用户按需自行清理）。
const providerStore = createProviderStore(
  createProviderSqliteStorage({ path: join(userDataPath, 'platform', 'model-providers.sqlite') }),
  providerSecretVault
)
/** 唯一的日志落盘口：主进程与渲染层诊断共用 `userData/logs/app.log`，写入前统一脱敏。 */
const appLog = createAppLog({
  directory: join(userDataPath, 'logs'),
  redact: (text) => redactText(text).text
})
appLog.log('info', 'app.start', { version: appVersion, platform })
const rendererProcessLog = createRendererProcessLog(appLog)

/** 主窗持有者：建窗、窗口事件、两个取窗口函数（加载/挂载时机由它自己掌握）。 */
const mainWindowHost = createMainWindowHost({
  createWindow: () => createMainWindow(),
  loadRenderer: (window) => loadMainWindowRenderer(window),
  logRendererEvent: (event) => rendererProcessLog.write(event),
  getWorkspace: () => getPanelWorkspaceForDisposal()
})

const taskIpcScheduleValidationOptions = createTaskIpcScheduleValidationOptions({
  timeZone: () => shellTimeZone.get()
})

  return { platformDataDirectory, settingsStore, shellTimeZone, providerSecretVault, providerStore, appLog, rendererProcessLog, mainWindowHost, taskIpcScheduleValidationOptions, workspaceTestFixtures }
}
