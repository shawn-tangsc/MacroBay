import type { BrowserWindow, IpcMain } from 'electron'

import type { AgentStoreState } from '@platform/ai/agent-platform/store/agentStore'
import { IpcChannels } from '../../ipc/channels'
import { registerAgentIpc } from '../ipc/agentIpc'

/**
 * 智能体**会话/运行时**那一半 IPC 的装配（36 个 handler）。
 *
 * 和 `agentTools` 那片相邻，共用 `agentIpcHandlers` 与 `getState`：两片分开写是为了让
 * 「会话运行时」和「工具/MCP」各自能单独回退——它们今天由两个不同的改动面驱动。
 *
 * 状态读法逐条：
 *
 * | 端口 | 谁提供 | 什么时候读 | 为什么是这个时机 |
 * |---|---|---|---|
 * | `getState` | 组合根（`agentStore`） | 每次 handler | 运行态随时在变，快照会读到上一个回合 |
 * | `syncAfterMutation` | 组合根 | 每次异步改状态后 | 它内部含调度同步与广播，**不许在这里另做一次**，否则同一变更广播两遍 |
 * | `broadcastStateChanged` | **本模块拼**，窗口由调用方给 | 每次状态替换后 | 目标窗口可被销毁重建，所以每次现取，持有旧引用会把事件发进死窗 |
 * | `replaceState` | 组合根 | 每次替换 | 状态替换只有一个入口，不在这里写第二份 |
 * | `cancelMessage` | 组合根 | 用户点停止时 | 取消要落在真正持有运行句柄的那个服务上 |
 *
 * 一条**不许在这里判断**的事：**哪些消息算终态**由运行时决定，不在这里判——这里只把通道接上。
 */
export type AgentCompositionPorts = Readonly<{
  agentIpcHandlers: ReturnType<typeof import('../agentIpcHandlers').createAgentIpcHandlers>
  getState: () => Promise<AgentStoreState>
  syncAfterMutation: (previousState: AgentStoreState) => Promise<unknown>
  replaceState: (state: AgentStoreState) => unknown
  cancelMessage: (runId: string) => unknown
  /** 状态变更要广播到哪个窗口；每次现取，窗口可能已经重建。 */
  getMainWindow: () => BrowserWindow | null
}>

export function composeAgentIpc(ipcMain: Pick<IpcMain, 'handle'>, ports: AgentCompositionPorts): void {
  registerAgentIpc(ipcMain, {
    agentIpcHandlers: ports.agentIpcHandlers,
    getState: ports.getState,
    syncAfterMutation: ports.syncAfterMutation,
    // 广播的通道名与目标窗口都在这里定；`app.ts` 不再知道 `agentsStateChanged` 这个名字。
    broadcastStateChanged: (state) => {
      ports.getMainWindow()?.webContents.send(IpcChannels.agentsStateChanged, state)
    },
    replaceState: ports.replaceState,
    cancelMessage: ports.cancelMessage
  })
}
