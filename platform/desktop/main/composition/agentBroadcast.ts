import type { BrowserWindow } from 'electron'

import type { AgentStoreState } from '@platform/ai/agent-platform/store/agentStore'
import { IpcChannels } from '../../ipc/channels'

/**
 * 智能体三条状态广播的**唯一出处**。
 *
 * 这三条原本在 `app.ts` 里各写一遍（`agentsStateChanged` 一处就写了 5 遍），于是「哪条状态走哪个通道」
 * 长在组合根上，读 `app.ts` 的人必须逐个记住。现在只在下面这张表里出现一次。
 *
 * 三条的区别不是命名问题，是**收件人不同**：
 *
 * | 通道 | 载的是什么 | 谁会用 |
 * |---|---|---|
 * | `agentsStateChanged` | 智能体/会话的完整状态（增删改之后） | 侧栏列表、会话头、工具栏 |
 * | `agentsRuntimeStateChanged` | 运行时快照（回合进行中的进度） | 正在跑的那一屏 |
 * | `agentsChannelRuntimeStateChanged` | 通道运行时快照 | 通道设置页 |
 *
 * 状态读法：**每次发送前现取窗口**。主窗可被销毁重建，持有旧引用会把事件发进死窗口，
 * 而那种失败在界面上表现为「状态一直不更新」，不报错。
 */
export type AgentBroadcastPorts = Readonly<{
  getMainWindow: () => BrowserWindow | null
}>

export type AgentBroadcasts = Readonly<{
  stateChanged: (state: AgentStoreState) => void
  runtimeStateChanged: (snapshot: unknown) => void
  channelRuntimeStateChanged: (snapshot: unknown) => void
}>

export function createAgentBroadcasts(ports: AgentBroadcastPorts): AgentBroadcasts {
  const send = (channel: string, payload: unknown): void => {
    ports.getMainWindow()?.webContents.send(channel, payload)
  }

  return {
    stateChanged: (state) => send(IpcChannels.agentsStateChanged, state),
    runtimeStateChanged: (snapshot) => send(IpcChannels.agentsRuntimeStateChanged, snapshot),
    channelRuntimeStateChanged: (snapshot) => send(IpcChannels.agentsChannelRuntimeStateChanged, snapshot)
  }
}
