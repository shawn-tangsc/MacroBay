import type { IpcRenderer } from 'electron'

import { IpcChannels } from '../ipc/channels'
import { unwrapTaskIpc } from '../ipc/taskIpcEnvelope'

/**
 * Agent 与 Assistant 两个 preload 命名空间。
 *
 * 为什么单独一个文件：它们是**受保护接缝**（渲染层拿到智能体/助手能力的唯一入口），内容一直在长，
 * 而 `preload/index.ts` 是体积基线文件（只减不增）。搬出来只是换位置：
 *
 * - **方法名与签名逐字不动**，`PlatformApi['agents' | 'assistants']` 的形状由 `typeof` 推出来，与拆分前一致；
 * - **不给工厂写返回类型标注**：一旦手写 `Record<string, (...) => any>`，那两个命名空间整个退回 `any`，
 *   正好抵消「跨进程返回值必须有类型」这条（今晚 8 条重复频道就是没类型害的）。让推断走；
 * - 工厂只收 `ipcRenderer`，不碰 `api` 的其它成员、不共享模块状态——所以搬走不影响 `index.ts` 里的
 *   产品事件桥与其它命名空间。
 *
 * `appIpcSurface.test.ts` 按源码文本核对这条接缝：它现在读「preload 分片」的合并文本，
 * 所以这里的 `IpcChannels.*` 仍被同一批断言盯着，搬文件不等于丢接线。
 */

/** `api.agents`：智能体、任务、会话、运行时命令。 */
export function createAgentsNamespace(ipcRenderer: IpcRenderer) {
  return {
    getState: () => ipcRenderer.invoke(IpcChannels.agentsGetState),
    getRuntimeSnapshot: () => ipcRenderer.invoke(IpcChannels.agentsGetRuntimeSnapshot),
    getChannelRuntimeSnapshot: (options?: unknown) =>
      ipcRenderer.invoke(IpcChannels.agentsGetChannelRuntimeSnapshot, options),
    restartChannelRuntime: (channelId: string) =>
      ipcRenderer.invoke(IpcChannels.agentsRestartChannelRuntime, channelId),
    listToolApprovals: () => ipcRenderer.invoke(IpcChannels.agentsListToolApprovals),
    resolveToolApproval: (approvalId: string, decision: unknown) =>
      ipcRenderer.invoke(IpcChannels.agentsResolveToolApproval, approvalId, decision),
    listAgents: (query?: unknown) => ipcRenderer.invoke(IpcChannels.agentsListAgents, query),
    createAgent: (input: unknown) => ipcRenderer.invoke(IpcChannels.agentsCreateAgent, input),
    listTasks: async (agentId: string, query?: unknown) => unwrapTaskIpc(await ipcRenderer.invoke(IpcChannels.agentsListTasks, agentId, query)),
    getTaskLogs: async (agentId: string, taskId: string, query?: unknown) =>
      unwrapTaskIpc(await ipcRenderer.invoke(IpcChannels.agentsGetTaskLogs, agentId, taskId, query)),
    previewTaskSchedule: async (input: unknown) => unwrapTaskIpc(await ipcRenderer.invoke(IpcChannels.agentsPreviewTaskSchedule, input)),
    listTaskPage: async (query?: unknown) => unwrapTaskIpc(await ipcRenderer.invoke(IpcChannels.agentsListTaskPage, query)),
    getTaskDeliveryAttempts: async (agentId: string, runLogId: string, query?: unknown) =>
      unwrapTaskIpc(await ipcRenderer.invoke(IpcChannels.agentsGetTaskDeliveryAttempts, agentId, runLogId, query)),
    retryTaskDelivery: async (agentId: string, runLogId: string, attemptId: string) =>
      unwrapTaskIpc(await ipcRenderer.invoke(IpcChannels.agentsRetryTaskDelivery, agentId, runLogId, attemptId)),
    listTaskMutationAudits: async (query: unknown) => unwrapTaskIpc(await ipcRenderer.invoke(IpcChannels.agentsListTaskMutationAudits, query)),
    getTaskAutomationPolicy: async () => unwrapTaskIpc(await ipcRenderer.invoke(IpcChannels.agentsGetTaskAutomationPolicy)),
    updateTaskAutomationPolicy: async (input: unknown) => unwrapTaskIpc(await ipcRenderer.invoke(IpcChannels.agentsUpdateTaskAutomationPolicy, input)),
    getTaskDeliveryReadiness: async (agentId: string, taskId: string) =>
      unwrapTaskIpc(await ipcRenderer.invoke(IpcChannels.agentsGetTaskDeliveryReadiness, agentId, taskId)),
    createTask: async (agentId: string, input: unknown) => unwrapTaskIpc(await ipcRenderer.invoke(IpcChannels.agentsCreateTask, agentId, input)),
    updateTask: async (agentId: string, taskId: string, request: unknown) =>
      unwrapTaskIpc(await ipcRenderer.invoke(IpcChannels.agentsUpdateTask, agentId, taskId, request)),
    deleteTask: async (agentId: string, taskId: string, request: unknown) =>
      unwrapTaskIpc(await ipcRenderer.invoke(IpcChannels.agentsDeleteTask, agentId, taskId, request)),
    runTask: async (agentId: string, taskId: string, request: unknown) =>
      unwrapTaskIpc(await ipcRenderer.invoke(IpcChannels.agentsRunTask, agentId, taskId, request)),
    cancelTaskRun: async (runLogId: string) => unwrapTaskIpc(await ipcRenderer.invoke(IpcChannels.agentsCancelTaskRun, runLogId)),
    listSessions: (query?: unknown) => ipcRenderer.invoke(IpcChannels.agentsListSessions, query),
    listSessionMessages: (sessionId: string, query?: unknown) =>
      ipcRenderer.invoke(IpcChannels.agentsListSessionMessages, sessionId, query),
    createSession: (input: unknown) => ipcRenderer.invoke(IpcChannels.agentsCreateSession, input),
    updateAgent: (agentId: string, patch: unknown) => ipcRenderer.invoke(IpcChannels.agentsUpdateAgent, agentId, patch),
    deleteAgent: (agentId: string) => ipcRenderer.invoke(IpcChannels.agentsDeleteAgent, agentId),
    reorderAgents: (orderedAgentIds: string[]) => ipcRenderer.invoke(IpcChannels.agentsReorderAgents, orderedAgentIds),
    selectAgent: (agentId: string) => ipcRenderer.invoke(IpcChannels.agentsSelectAgent, agentId),
    updateSession: (sessionId: string, patch: unknown) =>
      ipcRenderer.invoke(IpcChannels.agentsUpdateSession, sessionId, patch),
    deleteSessions: (sessionIds: string[]) => ipcRenderer.invoke(IpcChannels.agentsDeleteSessions, sessionIds),
    reorderSessions: (orderedSessionIds: string[]) => ipcRenderer.invoke(IpcChannels.agentsReorderSessions, orderedSessionIds),
    setSessionAgent: (sessionId: string, agentId: string | null) =>
      ipcRenderer.invoke(IpcChannels.agentsSetSessionAgent, sessionId, agentId),
    setSessionWorkspace: (sessionId: string, source: unknown) =>
      ipcRenderer.invoke(IpcChannels.agentsSetSessionWorkspace, sessionId, source),
    setSessionWorkspaceByPath: (sessionId: string, path: string) =>
      ipcRenderer.invoke(IpcChannels.agentsSetSessionWorkspaceByPath, sessionId, path),
    switchSessionPinState: (sessionId: string) => ipcRenderer.invoke(IpcChannels.agentsSwitchSessionPinState, sessionId),
    selectSession: (sessionId: string) => ipcRenderer.invoke(IpcChannels.agentsSelectSession, sessionId),
    clearSessionMessages: (sessionId: string) => ipcRenderer.invoke(IpcChannels.agentsClearSessionMessages, sessionId),
    deleteSessionMessage: (sessionId: string, messageId: string) =>
      ipcRenderer.invoke(IpcChannels.agentsDeleteSessionMessage, sessionId, messageId),
    replaceState: (state: unknown) => ipcRenderer.invoke(IpcChannels.agentsReplaceState, state),
    sendMessage: (request: unknown) => ipcRenderer.invoke(IpcChannels.agentsSendMessage, request),
    cancelMessage: (runId: string) => ipcRenderer.invoke(IpcChannels.agentsCancelMessage, runId),
    cancelSession: (sessionId: string) => ipcRenderer.invoke(IpcChannels.agentsCancelSession, sessionId),
    refreshMcpTools: (serverId: string) => ipcRenderer.invoke(IpcChannels.agentsRefreshMcpTools, serverId),
    getRuntimeCompatibility: (providerId: string, modelId: string, runtimeId: string) =>
      ipcRenderer.invoke(IpcChannels.agentsGetRuntimeCompatibility, providerId, modelId, runtimeId),
    probeRuntimeCompatibility: (providerId: string, modelId: string, runtimeId: string) =>
      ipcRenderer.invoke(IpcChannels.agentsProbeRuntimeCompatibility, providerId, modelId, runtimeId),
    getModelGatewayStatus: () => ipcRenderer.invoke(IpcChannels.agentsGetModelGatewayStatus),
    startModelGateway: (providerId?: string, modelId?: string) =>
      ipcRenderer.invoke(IpcChannels.agentsStartModelGateway, providerId, modelId),
    stopModelGateway: () => ipcRenderer.invoke(IpcChannels.agentsStopModelGateway),
    setModelGatewayEnabled: (enabled: boolean) =>
      ipcRenderer.invoke(IpcChannels.agentsSetModelGatewayEnabled, enabled),
    executeRuntimeCommand: (input: unknown) => ipcRenderer.invoke(IpcChannels.agentsExecuteRuntimeCommand, input),
    productTools: {
      listPackages: (agentId: string) => ipcRenderer.invoke(IpcChannels.agentsListProductToolPackages, agentId),
      updatePackageBinding: (
        agentId: string,
        productId: string,
        permissionMode: 'allow-read-only' | 'prompt' | 'disabled'
      ) => ipcRenderer.invoke(IpcChannels.agentsUpdateProductToolPackageBinding, agentId, productId, permissionMode),
      listCallTracePage: (query?: unknown) => ipcRenderer.invoke(IpcChannels.agentsListProductToolCallTracePage, query),
      getCallTrace: (toolCallId: string) => ipcRenderer.invoke(IpcChannels.agentsGetProductToolCallTrace, toolCallId)
    },
    skills: {
      list: (query?: unknown) => ipcRenderer.invoke(IpcChannels.agentsSkillsList, query),
      getRuntime: (agentId: string) => ipcRenderer.invoke(IpcChannels.agentsSkillsGetRuntime, agentId),
      search: (query: string) => ipcRenderer.invoke(IpcChannels.agentsSkillsSearch, query),
      install: (options: unknown) => ipcRenderer.invoke(IpcChannels.agentsSkillsInstall, options),
      installFromZip: (options: unknown) => ipcRenderer.invoke(IpcChannels.agentsSkillsInstallFromZip, options),
      installFromDirectory: (options: unknown) => ipcRenderer.invoke(IpcChannels.agentsSkillsInstallFromDirectory, options),
      uninstall: (skillId: string) => ipcRenderer.invoke(IpcChannels.agentsSkillsUninstall, skillId),
      toggle: (options: unknown) => ipcRenderer.invoke(IpcChannels.agentsSkillsToggle, options),
      readFile: (skillId: string, filename: string) => ipcRenderer.invoke(IpcChannels.agentsSkillsReadFile, skillId, filename),
      listFiles: (skillId: string) => ipcRenderer.invoke(IpcChannels.agentsSkillsListFiles, skillId),
      listLocal: (workdir: string) => ipcRenderer.invoke(IpcChannels.agentsSkillsListLocal, workdir)
    },
    onStateChanged: (callback: (state: unknown) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, state: unknown) => callback(state)
      ipcRenderer.on(IpcChannels.agentsStateChanged, listener)
      return () => {
        ipcRenderer.removeListener(IpcChannels.agentsStateChanged, listener)
      }
    },
    onRuntimeStateChanged: (callback: (state: unknown) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, state: unknown) => callback(state)
      ipcRenderer.on(IpcChannels.agentsRuntimeStateChanged, listener)
      return () => {
        ipcRenderer.removeListener(IpcChannels.agentsRuntimeStateChanged, listener)
      }
    },
    onChannelRuntimeStateChanged: (callback: (state: unknown) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, state: unknown) => callback(state)
      ipcRenderer.on(IpcChannels.agentsChannelRuntimeStateChanged, listener)
      return () => {
        ipcRenderer.removeListener(IpcChannels.agentsChannelRuntimeStateChanged, listener)
      }
    }
  }
}

/** `api.assistants`：助手库、话题、消息流。 */
export function createAssistantsNamespace(ipcRenderer: IpcRenderer) {
  return {
    list: () => ipcRenderer.invoke(IpcChannels.assistantsList),
    get: (assistantId: string) => ipcRenderer.invoke(IpcChannels.assistantsGet, assistantId),
    create: (input: unknown) => ipcRenderer.invoke(IpcChannels.assistantsCreate, input),
    update: (assistantId: string, patch: unknown) => ipcRenderer.invoke(IpcChannels.assistantsUpdate, assistantId, patch),
    delete: (assistantId: string) => ipcRenderer.invoke(IpcChannels.assistantsDelete, assistantId),
    reorder: (orderedIds: string[]) => ipcRenderer.invoke(IpcChannels.assistantsReorder, orderedIds),
    listTopics: (query?: unknown) => ipcRenderer.invoke(IpcChannels.assistantsListTopics, query),
    createTopic: (input: unknown) => ipcRenderer.invoke(IpcChannels.assistantsCreateTopic, input),
    updateTopic: (topicId: string, patch: unknown) => ipcRenderer.invoke(IpcChannels.assistantsUpdateTopic, topicId, patch),
    deleteTopic: (topicId: string) => ipcRenderer.invoke(IpcChannels.assistantsDeleteTopic, topicId),
    pinTopic: (topicId: string) => ipcRenderer.invoke(IpcChannels.assistantsPinTopic, topicId),
    unpinTopic: (topicId: string) => ipcRenderer.invoke(IpcChannels.assistantsUnpinTopic, topicId),
    listTopicMessages: (topicId: string, nodeId?: string | null) =>
      ipcRenderer.invoke(IpcChannels.assistantsListTopicMessages, topicId, nodeId),
    setActiveNode: (topicId: string, nodeId: string | null) =>
      ipcRenderer.invoke(IpcChannels.assistantsSetActiveNode, topicId, nodeId),
    renameTopic: (topicId: string, name: string, isNameManuallyEdited?: boolean) =>
      ipcRenderer.invoke(IpcChannels.assistantsRenameTopic, topicId, name, isNameManuallyEdited),
    createMessageSibling: (messageId: string, dto: unknown) =>
      ipcRenderer.invoke(IpcChannels.assistantsCreateMessageSibling, messageId, dto),
    editAndResendUserMessage: (input: unknown) =>
      ipcRenderer.invoke(IpcChannels.assistantsEditAndResendUserMessage, input),
    clearTopicMessages: (topicId: string) => ipcRenderer.invoke(IpcChannels.assistantsClearTopicMessages, topicId),
    searchTopicMessages: (topicId: string, query: string, limit?: number) =>
      ipcRenderer.invoke(IpcChannels.assistantsSearchTopicMessages, topicId, query, limit),
    deleteMessage: (messageId: string, options?: unknown) =>
      ipcRenderer.invoke(IpcChannels.assistantsDeleteMessage, messageId, options),
    streamOpen: (request: unknown) => ipcRenderer.invoke(IpcChannels.assistantsStreamOpen, request),
    streamAttach: (topicId: string) => ipcRenderer.invoke(IpcChannels.assistantsStreamAttach, topicId),
    streamAbort: (topicId: string) => ipcRenderer.invoke(IpcChannels.assistantsStreamAbort, topicId),
    streamGetStatus: (topicId: string) => ipcRenderer.invoke(IpcChannels.assistantsStreamGetStatus, topicId),
    library: {
      listTemplates: (query?: unknown, language?: string) =>
        ipcRenderer.invoke(IpcChannels.assistantsLibraryListTemplates, query, language),
      getTemplate: (templateId: string, language?: string) =>
        ipcRenderer.invoke(IpcChannels.assistantsLibraryGetTemplate, templateId, language),
      installTemplate: (input: unknown, language?: string) =>
        ipcRenderer.invoke(IpcChannels.assistantsLibraryInstallTemplate, input, language),
      listGroups: (language?: string) => ipcRenderer.invoke(IpcChannels.assistantsLibraryListGroups, language),
      createAssistant: (input: unknown) =>
        ipcRenderer.invoke(IpcChannels.assistantsLibraryCreateAssistant, input)
    },
    onStreamChunk: (callback: (payload: unknown) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload)
      ipcRenderer.on(IpcChannels.assistantsStreamChunk, listener)
      return () => ipcRenderer.removeListener(IpcChannels.assistantsStreamChunk, listener)
    },
    onStreamDone: (callback: (payload: unknown) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload)
      ipcRenderer.on(IpcChannels.assistantsStreamDone, listener)
      return () => ipcRenderer.removeListener(IpcChannels.assistantsStreamDone, listener)
    },
    onStreamError: (callback: (payload: unknown) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload)
      ipcRenderer.on(IpcChannels.assistantsStreamError, listener)
      return () => ipcRenderer.removeListener(IpcChannels.assistantsStreamError, listener)
    },
    onStreamStatusChanged: (callback: (snapshot: unknown) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, snapshot: unknown) => callback(snapshot)
      ipcRenderer.on(IpcChannels.assistantsStreamStatusChanged, listener)
      return () => ipcRenderer.removeListener(IpcChannels.assistantsStreamStatusChanged, listener)
    }
  }
}
