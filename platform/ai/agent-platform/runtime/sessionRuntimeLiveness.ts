import type { AgentSessionRuntimeState } from './runtimeTypes'

/**
 * 这个会话在本进程里有没有**活着的运行**。
 *
 * 只用于「同进程卡死」那一半判据：某个会话有 `pending` 消息，但它的运行不在本进程的运行表里，
 * 说明那次运行已经没了（不是别的窗口的——运行归主进程 runtime，窗口只是订阅者）。
 * 跨进程那一半用 `ownerBootId`，两者别混。
 */
export function isSessionTurnLive(state: AgentSessionRuntimeState | undefined): boolean {
  if (!state) return false
  if (state.turnState === 'queued' || state.turnState === 'running' || state.turnState === 'stopping') return true
  return state.inflightRequestCount > 0
}
