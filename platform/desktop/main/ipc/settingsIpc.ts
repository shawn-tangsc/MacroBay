import type { IpcMain, IpcMainInvokeEvent } from 'electron'

import { applySessionProxySettings } from '../../../network/applySessionProxySettings'
import { assertProxySettingsPatchAccepted } from '../../../network/proxySettingsGuard'
import type { AppLanguage, AppSettings, AppSettingsPatch } from '../../../settings/schema/appSettings'
import type { SettingsStartupReadState } from '../../../settings/store/settingsStore'
import { IpcChannels } from '../../ipc/channels'

/**
 * 设置读写的注册点。这一步只是搬家：两个 handler 的行为逐字未动。
 *
 * 它不属于窗口模块，正因为它同时牵着四个域：设置存储、助手种子文案、会话代理应用、
 * 工作区面板的偏好通知。端口就按这四个域各给一条，模块名与职责对得上。
 */
export type SettingsIpcPorts = Readonly<{
  settings: Readonly<{
    get: () => Promise<AppSettings>
    update: (patch: AppSettingsPatch) => Promise<AppSettings>
    /** 提交后清空待通知内容，避免重复通知。 */
    notifyCommitted: () => void
    /** 启动期读取：读不到用默认值并记状态（不抛）。 */
    readStartup: () => Promise<AppSettings>
    startupState: () => SettingsStartupReadState
    retryStartupRead: () => Promise<SettingsStartupReadState>
    /** 读者显式「重置设置」：唯一会在读不到之后写盘的地方。 */
    resetAfterUnreadable: () => Promise<AppSettings>
  }>
  /** 保存成功后的副作用：内置助手种子与多语言文案。 */
  ensureDefaultAssistantSeed: () => Promise<void>
  refreshBuiltinSeedCopy: (language: AppLanguage) => Promise<void>
  /** 设置里的时区改动要立刻影响后续排期/日界，不必等重启。 */
  refreshShellTimeZone: () => Promise<unknown>
  /** PLAT-32/S1：偏好的唯一对账点（通知自身绝不 reject）。 */
  notifyPreferencesChanged: () => void
}>

export function registerSettingsIpc(
  ipcMain: Pick<IpcMain, 'handle'>,
  ports: SettingsIpcPorts
): void {
  ipcMain.handle(IpcChannels.settingsGet, () => ports.settings.get())
  /**
   * 一次设置变更之后的全部副作用（保存与「重置设置」共用）：
   * 内置种子、文案重建、时区刷新、会话代理、偏好通知。
   */
  async function applyCommittedSideEffects(next: AppSettings): Promise<void> {
    await ports.ensureDefaultAssistantSeed()
    // 内置 Agent/会话文案按 id 重新解析到新语言；用户改过的字段不动，也不写任何迁移标记。
    await ports.refreshBuiltinSeedCopy(next.language)
    await ports.refreshShellTimeZone()
    await applySessionProxySettings(next.network)
    // PLAT-32/S1：偏好的**唯一对账点** = 这条显式通知（受控读取不再带副作用；通知自身绝不 reject）
    ports.notifyPreferencesChanged()
  }

  ipcMain.handle(IpcChannels.settingsUpdate, async (_event: IpcMainInvokeEvent, patch: AppSettingsPatch) => {
    // 非法代理地址必须在这里就被拒：校验先于落盘，settings.json 一个字都不写。
    assertProxySettingsPatchAccepted(patch, (await ports.settings.get()).network)
    const next = await ports.settings.update(patch)
    await applyCommittedSideEffects(next)
    ports.settings.notifyCommitted()
    return next
  })

  /**
   * 启动期读设置失败后的恢复面。三个动作都是显式的：
   * `state` 只读、`retry` 再读一次（失败不抛）、`reset` 由读者确认后重建文件。
   * 降级本身绝不写盘——坏文件与副本都留在原地当证据。
   */
  ipcMain.handle(IpcChannels.settingsRecovery, async (_event: IpcMainInvokeEvent, action: unknown) => {
    if (action === 'state') return ports.settings.startupState()
    if (action === 'retry') return ports.settings.retryStartupRead()
    if (action === 'reset') {
      const next = await ports.settings.resetAfterUnreadable()
      await applyCommittedSideEffects(next)
      ports.settings.notifyCommitted()
      return ports.settings.startupState()
    }
    throw new Error('settings-recovery-unknown-action')
  })
}
