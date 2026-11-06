import type { IpcMain, IpcMainInvokeEvent } from 'electron'

import type { AgentChatRuntimeRequest } from '../../../ai/agent-platform/runtime/agentChatRuntime'
import type { AgentStoreState } from '../../../ai/agent-platform/store/agentStore'
import { IpcChannels } from '../../ipc/channels'

/**
 * 智能体域的会话/运行时一半（34 个 handler）：智能体 CRUD、会话与消息、运行时网关与命令、
 * 工具审批、选中的会话清理、发消息与取消。`app.ts` 只留装配与一行接线。
 *
 * 端口按实测闭包给（6 个），状态广播走端口，新模块不抓 `mainWindow`。
 * 任务排程那 15 个 handler 仍由 `registerAgentTaskIpcHandlers` 单独注册，留在 `app.ts`。
 */
export type AgentIpcPorts = Readonly<{
  agentIpcHandlers: ReturnType<typeof import('../agentIpcHandlers').createAgentIpcHandlers>
  getState: () => Promise<AgentStoreState>
  /** 状态被异步改过之后的重放器（内部含调度同步与广播）。 */
  syncAfterMutation: (previousState: AgentStoreState) => Promise<unknown>
  broadcastStateChanged: (state: AgentStoreState) => void
  replaceState: (state: AgentStoreState) => unknown
  cancelMessage: (runId: string) => unknown
}>

export function registerAgentIpc(
  ipcMain: Pick<IpcMain, 'handle'>,
  ports: AgentIpcPorts
): void {
  const { agentIpcHandlers, getState, syncAfterMutation, broadcastStateChanged, replaceState, cancelMessage } = ports

ipcMain.handle(IpcChannels.agentsGetState, () => agentIpcHandlers.getState())
ipcMain.handle(
  IpcChannels.agentsGetRuntimeCompatibility,
  (_event: IpcMainInvokeEvent, providerId: string, modelId: string, runtimeId: string) =>
    agentIpcHandlers.getRuntimeCompatibility(providerId, modelId, runtimeId as 'claude-code' | 'openai-agents')
)
ipcMain.handle(
  IpcChannels.agentsProbeRuntimeCompatibility,
  (_event: IpcMainInvokeEvent, providerId: string, modelId: string, runtimeId: string) =>
    agentIpcHandlers.probeRuntimeCompatibility(providerId, modelId, runtimeId as 'claude-code' | 'openai-agents')
)
ipcMain.handle(IpcChannels.agentsGetModelGatewayStatus, () => agentIpcHandlers.getModelGatewayStatus())
ipcMain.handle(
  IpcChannels.agentsStartModelGateway,
  (_event: IpcMainInvokeEvent, providerId?: string, modelId?: string) =>
    agentIpcHandlers.startModelGateway(providerId, modelId)
)
ipcMain.handle(IpcChannels.agentsStopModelGateway, () => agentIpcHandlers.stopModelGateway())
ipcMain.handle(IpcChannels.agentsSetModelGatewayEnabled, (_event: IpcMainInvokeEvent, enabled: boolean) =>
  agentIpcHandlers.setModelGatewayEnabled(enabled)
)
ipcMain.handle(IpcChannels.agentsExecuteRuntimeCommand, async (_event: IpcMainInvokeEvent, input: unknown) => {
  const result = await agentIpcHandlers.executeRuntimeCommand(
    input as Parameters<typeof agentIpcHandlers.executeRuntimeCommand>[0]
  )
  broadcastStateChanged(result.state)
  return result
})
ipcMain.handle(IpcChannels.agentsGetRuntimeSnapshot, () => agentIpcHandlers.getRuntimeSnapshot())
ipcMain.handle(IpcChannels.agentsGetChannelRuntimeSnapshot, (_event: IpcMainInvokeEvent, options?: unknown) =>
  agentIpcHandlers.getChannelRuntimeSnapshot(
    (options as Parameters<typeof agentIpcHandlers.getChannelRuntimeSnapshot>[0]) ?? undefined
  )
)
ipcMain.handle(IpcChannels.agentsRestartChannelRuntime, (_event: IpcMainInvokeEvent, channelId: string) =>
  agentIpcHandlers.restartChannelRuntime(channelId)
)
ipcMain.handle(IpcChannels.agentsListToolApprovals, () => agentIpcHandlers.listToolApprovals())
ipcMain.handle(IpcChannels.agentsResolveToolApproval, (_event: IpcMainInvokeEvent, approvalId: string, decision: unknown) =>
  agentIpcHandlers.resolveToolApproval(
    approvalId,
    decision as Parameters<typeof agentIpcHandlers.resolveToolApproval>[1]
  )
)
ipcMain.handle(IpcChannels.agentsListAgents, (_event: IpcMainInvokeEvent, query?: unknown) =>
  agentIpcHandlers.listAgents((query as Parameters<typeof agentIpcHandlers.listAgents>[0]) ?? {})
)
ipcMain.handle(IpcChannels.agentsCreateAgent, async (_event: IpcMainInvokeEvent, input: unknown) => {
  const previousState = await getState()
  const created = await agentIpcHandlers.createAgent(input as Parameters<typeof agentIpcHandlers.createAgent>[0])
  await syncAfterMutation(previousState)
  return created
})
// 频道设置页选文件夹：路径 → 工作区编号。写入由 `AgentWorkspaceService` 负责，这里不复制一份。
ipcMain.handle(IpcChannels.agentsEnsureWorkspace, (_event: IpcMainInvokeEvent, path: unknown) =>
  agentIpcHandlers.ensureWorkspace(path)
)
ipcMain.handle(IpcChannels.agentsListSessions, (_event: IpcMainInvokeEvent, query?: unknown) =>
  agentIpcHandlers.listSessions((query as Parameters<typeof agentIpcHandlers.listSessions>[0]) ?? {})
)
ipcMain.handle(
  IpcChannels.agentsListSessionMessages,
  (_event: IpcMainInvokeEvent, sessionId: string, query?: unknown) =>
    agentIpcHandlers.listSessionMessages(
      sessionId,
      (query as Parameters<typeof agentIpcHandlers.listSessionMessages>[1]) ?? {}
    )
)
ipcMain.handle(IpcChannels.agentsCreateSession, async (_event: IpcMainInvokeEvent, input: unknown) => {
  const previousState = await getState()
  const created = await agentIpcHandlers.createSession(input as Parameters<typeof agentIpcHandlers.createSession>[0])
  await syncAfterMutation(previousState)
  return created
})
ipcMain.handle(IpcChannels.agentsUpdateAgent, async (_event: IpcMainInvokeEvent, agentId: string, patch: unknown) => {
  const updated = await agentIpcHandlers.updateAgent(
    agentId,
    patch as Parameters<typeof agentIpcHandlers.updateAgent>[1]
  )
  broadcastStateChanged(await getState())
  return updated
})
ipcMain.handle(IpcChannels.agentsDeleteAgent, async (_event: IpcMainInvokeEvent, agentId: string) => {
  const previousState = await getState()
  await agentIpcHandlers.deleteAgent(agentId)
  return syncAfterMutation(previousState)
})
ipcMain.handle(IpcChannels.agentsReorderAgents, async (_event: IpcMainInvokeEvent, orderedAgentIds: string[]) => {
  const state = await agentIpcHandlers.reorderAgents(orderedAgentIds)
  broadcastStateChanged(state)
  return state
})
ipcMain.handle(IpcChannels.agentsSelectAgent, async (_event: IpcMainInvokeEvent, agentId: string) => {
  const state = await agentIpcHandlers.selectAgent(agentId)
  broadcastStateChanged(state)
  return state
})
ipcMain.handle(
  IpcChannels.agentsUpdateSession,
  async (_event: IpcMainInvokeEvent, sessionId: string, patch: unknown) => {
    const typedPatch = patch as Parameters<typeof agentIpcHandlers.updateSession>[1]
    const previousState = typedPatch.agentId === undefined ? null : await getState()
    const updated = await agentIpcHandlers.updateSession(sessionId, typedPatch)
    if (previousState) {
      await syncAfterMutation(previousState)
    } else {
      broadcastStateChanged(await getState())
    }
    return updated
  }
)
ipcMain.handle(IpcChannels.agentsDeleteSessions, async (_event: IpcMainInvokeEvent, sessionIds: string[]) => {
  const previousState = await getState()
  const result = await agentIpcHandlers.deleteSessions(sessionIds)
  await syncAfterMutation(previousState)
  return result
})
ipcMain.handle(IpcChannels.agentsReorderSessions, async (_event: IpcMainInvokeEvent, orderedSessionIds: string[]) => {
  const state = await agentIpcHandlers.reorderSessions(orderedSessionIds)
  broadcastStateChanged(state)
  return state
})
ipcMain.handle(IpcChannels.agentsSetSessionAgent, async (_event: IpcMainInvokeEvent, sessionId: string, agentId: string | null) => {
  const previousState = await getState()
  const session = await agentIpcHandlers.setSessionAgent(sessionId, agentId)
  await syncAfterMutation(previousState)
  return session
})
ipcMain.handle(IpcChannels.agentsSetSessionWorkspace, async (_event: IpcMainInvokeEvent, sessionId: string, source: unknown) => {
  const previousState = await getState()
  const session = await agentIpcHandlers.setSessionWorkspace(
    sessionId,
    source as Parameters<typeof agentIpcHandlers.setSessionWorkspace>[1]
  )
  await syncAfterMutation(previousState)
  return session
})
ipcMain.handle(IpcChannels.agentsSetSessionWorkspaceByPath, async (_event: IpcMainInvokeEvent, sessionId: string, path: string) => {
  const previousState = await getState()
  const session = await agentIpcHandlers.setSessionWorkspaceByPath(sessionId, path)
  await syncAfterMutation(previousState)
  return session
})
ipcMain.handle(IpcChannels.agentsSwitchSessionPinState, async (_event: IpcMainInvokeEvent, sessionId: string) => {
  const state = await agentIpcHandlers.toggleSessionPin(sessionId)
  broadcastStateChanged(state)
  return state
})
ipcMain.handle(IpcChannels.agentsSelectSession, async (_event: IpcMainInvokeEvent, sessionId: string) => {
  const state = await agentIpcHandlers.selectSession(sessionId)
  broadcastStateChanged(state)
  return state
})
ipcMain.handle(IpcChannels.agentsClearSessionMessages, async (_event: IpcMainInvokeEvent, sessionId: string) => {
  const state = await agentIpcHandlers.clearSessionMessages(sessionId)
  broadcastStateChanged(state)
  return state
})
ipcMain.handle(
  IpcChannels.agentsDeleteSessionMessage,
  async (_event: IpcMainInvokeEvent, sessionId: string, messageId: string) => {
    const state = await agentIpcHandlers.deleteSessionMessage(sessionId, messageId)
    broadcastStateChanged(state)
    return state
  }
)
ipcMain.handle(IpcChannels.agentsReplaceState, (_event: IpcMainInvokeEvent, state: AgentStoreState) => replaceState(state))
ipcMain.handle(IpcChannels.agentsSendMessage, async (_event: IpcMainInvokeEvent, request: AgentChatRuntimeRequest) => {
  const result = await agentIpcHandlers.sendMessage(request)
  broadcastStateChanged(result.state)
  return result
})
ipcMain.handle(IpcChannels.agentsCancelMessage, (_event: IpcMainInvokeEvent, runId: string) => cancelMessage(runId))
ipcMain.handle(IpcChannels.agentsCancelSession, (_event: IpcMainInvokeEvent, sessionId: string) =>
  agentIpcHandlers.cancelSession(sessionId)
)

}
