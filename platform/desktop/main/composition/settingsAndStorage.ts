import type { IpcMain } from 'electron'

import type { SettingsIpcPorts } from '../ipc/settingsIpc'
import { registerSettingsIpc } from '../ipc/settingsIpc'
import type { StorageIpcPorts } from '../ipc/storageIpc'
import { registerStorageIpc } from '../ipc/storageIpc'

/**
 * 设置与存储两片 IPC 的装配（设置 2 个 handler、存储 8 个）。
 *
 * 两片写在一个文件里，是因为它们**共用同一类状态**：都只读设置、从不广播通道——
 * 与 `agent` / `model` 那两片不同，那两个各自要往外推事件。放在一起能让「谁不推事件」看得见。
 *
 * 状态读法逐条：
 *
 * | 端口 | 谁提供 | 什么时候读 | 为什么是这个时机 |
 * |---|---|---|---|
 * | `settings`（`settingsStore`） | 组合根 | 每次 handler | 设置随时被保存，快照会读到上一版 |
 * | `ensureDefaultAssistantSeed` | 组合根 | 首次引导完成时 | 内置助手只该存在一次，重复调用不得新增 |
 * | `refreshBuiltinSeedCopy` | 组合根 | 语言变更时 | 内置文案要跟着语言重建，读的时候不缓存 |
 * | `refreshShellTimeZone` | **本模块包一层** | 时区变更后 | 时区改动要立刻影响排程与日界，**不必等重启**；这里只负责在保存后触发 |
 * | `notifyPreferencesChanged` | **本模块包一层** | 外观/偏好变更后 | 目标工作区对象可被销毁重建，所以每次现取，持有旧引用会把通知发给已销毁的宿主 |
 * | `cacheGovernance` | 组合根 | 每次缓存操作 | 治理器持有索引，不重新构造 |
 * | `summarizeProducts` | **本模块包一层** | 产品清单查询时 | 清单在启动时定下，这里只按当前清单汇总，不在调用点现拼 |
 *
 * 一条**不许在这里判断**的事：**哪些设置项需要重启才生效**由各自的消费者决定，不在这里维护名单。
 */
export type SettingsCompositionPorts = Omit<
  SettingsIpcPorts,
  'refreshShellTimeZone' | 'notifyPreferencesChanged'
> &
  Readonly<{
    /**
     * 设置里的时区改动要立刻生效：保存后触发一次刷新。
     * **返回 Promise 并被 await**：保存流程用完它再应用会话代理，早返回会让那一步拿到旧时区。
     */
    refreshTimeZone: () => Promise<unknown>
    /** 偏好变更通知的接收方；每次现取，工作区对象可被销毁重建。 */
    getWorkspaceForNotify: () => { notifyPreferencesChanged: () => void } | null
  }>

export type StorageCompositionPorts = Omit<StorageIpcPorts, 'summarizeProducts'> &
  Readonly<{
    /** 当前产品清单；启动时定下，这里只转给汇总函数。 */
    summarizeProducts: () => ReturnType<StorageIpcPorts['summarizeProducts']>
  }>

export function composeSettingsIpc(ipcMain: Pick<IpcMain, 'handle'>, ports: SettingsCompositionPorts): void {
  const { refreshTimeZone, getWorkspaceForNotify, ...rest } = ports
  registerSettingsIpc(ipcMain, {
    ...rest,
    // 时区与偏好通知都要「每次现取目标」：一个要立刻影响排程，另一个的宿主可被销毁重建。
    refreshShellTimeZone: () => refreshTimeZone(),
    notifyPreferencesChanged: () => getWorkspaceForNotify()?.notifyPreferencesChanged()
  })
}

export function composeStorageIpc(ipcMain: Pick<IpcMain, 'handle'>, ports: StorageCompositionPorts): void {
  registerStorageIpc(ipcMain, { ...ports })
}
