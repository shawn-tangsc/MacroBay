import type { IpcMain } from 'electron'

import { registerModelIpc, type ModelIpcPorts } from '../ipc/modelIpc'

/**
 * 模型服务 IPC 的装配。
 *
 * **这份文件的重点不是“搬了 10 个键”，是把这个域隐式依赖的状态读法写下来**——搬家最容易丢的
 * 就是这类“代码里没写、但所有行为都依赖”的约定。逐条列清，下一刀才敢重排：
 *
 * | 端口 | 谁提供 | 什么时候读 | 为什么是这个时机 |
 * |---|---|---|---|
 * | `providerStore` | 组合根建的唯一实例 | 每次调用读 `getState()` | 设置保存后立刻生效，不缓存快照 |
 * | `getPlatformFetch` | 组合根 | 每次出网前取 | 代理设置可变，取一次会绕过之后改的代理 |
 * | `getMainWindow` | 组合根 | 每次推送前取 | 主窗可被销毁重建，持有旧引用会把事件发进死窗 |
 * | `invalidateModelCompatibilityCache` | 组合根包一层 | 探测结果变化时 | 与智能体线共用同一份兼容性缓存，必须走同一个失效入口 |
 * | `agentRuntimeProbeSnapshotStore` | 组合根 | 探测写入时 | 内存态，不落库；进程内唯一 |
 * | `syncInUseModelPatrolScheduleFromState` | 组合根 | 菜单开关变化后 | 定时任务注册由它收敛，IPC 不直接排程 |
 * | `inUseModelPatrol` | 组合根 | 开关读写时 | 运行态对象，`enabled` 由设置投影，不在这里判断 |
 * | `providerRuntimeCheckService` | 组合根 | 每次检查时 | 检查结果要能取消，服务持有取消句柄 |
 * | `assistantImageMessages` | 组合根 | 生成图落库时 | 与助手会话共用一份消息存储，不另开实例 |
 * | `generatedImageStorage` | 组合根 | 读图 / 落图时 | 目录在启动时可配，实例只建一次 |
 *
 * 两条**不许在这里判断**的事（判断留在原处，搬家不改语义）：
 * - 「默认模型是哪一个」由设置读，不在这里拍；
 * - 「凭据能不能用」由 `providerStore` 的状态判，不在这里读 key。
 *
 * 另记一个拆分期反复咬人的坑：**别按名字猜路径**——`configureNotificationRuntime` 不在
 * `runtime/`，在 `ipc/registerNotificationIpc`。`grep -rn "export function <名字>"` 一次就知道。
 */
export type ModelIpcCompositionPorts = Omit<
  ModelIpcPorts,
  'invalidateModelCompatibilityCache'
> & Readonly<{
  /** 组合根手里那份「让兼容性缓存失效」的入口；本模块只把 providerId 转过去。 */
  invalidateAgentModelCompatibilityCache: (providerId?: string) => void
}>

export function composeModelIpc(ipcMain: Pick<IpcMain, 'handle'>, ports: ModelIpcCompositionPorts): void {
  registerModelIpc(ipcMain, {
    providerStore: ports.providerStore,
    getPlatformFetch: ports.getPlatformFetch,
    getMainWindow: ports.getMainWindow,
    // 与智能体线共用同一份兼容性缓存：失效必须走同一个入口，不在这里另建判断。
    invalidateModelCompatibilityCache: (providerId) => ports.invalidateAgentModelCompatibilityCache(providerId),
    agentRuntimeProbeSnapshotStore: ports.agentRuntimeProbeSnapshotStore,
    syncInUseModelPatrolScheduleFromState: ports.syncInUseModelPatrolScheduleFromState,
    inUseModelPatrol: ports.inUseModelPatrol,
    providerRuntimeCheckService: ports.providerRuntimeCheckService,
    assistantImageMessages: ports.assistantImageMessages,
    generatedImageStorage: ports.generatedImageStorage
  })
}
