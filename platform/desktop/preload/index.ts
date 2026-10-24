import { contextBridge, ipcRenderer } from 'electron'

import { IpcChannels } from '../ipc/channels'
import { unwrapTaskIpc } from '../ipc/taskIpcEnvelope'
import type { ModelDetectionMode, ModelDetectionResult } from '../../ai/providers/modelDetection/types'

type ProductEventPayload = {
  productId?: string
  event?: string
  data?: unknown
}

type ProductEventSubscriber = (data: unknown) => void

const productEventSubscribers = new Map<string, Set<ProductEventSubscriber>>()
let productEventBridgeListener:
  | ((event: Electron.IpcRendererEvent, payload: ProductEventPayload) => void)
  | null = null

function productEventKey(productId: string, event: string): string {
  return `${productId}::${event}`
}

function ensureProductEventBridge(): void {
  if (productEventBridgeListener) return
  productEventBridgeListener = (_ipcEvent, payload) => {
    const productId = payload?.productId
    const event = payload?.event
    if (!productId || !event) return
    const subscribers = productEventSubscribers.get(productEventKey(productId, event))
    if (!subscribers?.size) return
    for (const subscriber of subscribers) {
      subscriber(payload.data)
    }
  }
  ipcRenderer.on(IpcChannels.productIpcEvent, productEventBridgeListener)
}

function releaseProductEventBridgeIfIdle(): void {
  if (!productEventBridgeListener || productEventSubscribers.size > 0) return
  ipcRenderer.removeListener(IpcChannels.productIpcEvent, productEventBridgeListener)
  productEventBridgeListener = null
}

const api = {
  app: {
    getInfo: () => ipcRenderer.invoke(IpcChannels.appInfo),
    getProductSummaries: () => ipcRenderer.invoke(IpcChannels.productSummaries),
    openExternal: (url: string) => ipcRenderer.invoke(IpcChannels.shellOpenExternal, url),
    openPath: (path: string) => ipcRenderer.invoke(IpcChannels.shellOpenPath, path),
    openFileWithApp: (request: unknown) => ipcRenderer.invoke(IpcChannels.shellOpenFileWithApp, request),
    quoteToMainWindow: (text: string) => ipcRenderer.invoke(IpcChannels.appQuoteToMain, text),
    listExternalApps: () => ipcRenderer.invoke(IpcChannels.externalAppsListInstalled),
    launchExternalAppWorkspace: (request: unknown) =>
      ipcRenderer.invoke(IpcChannels.externalAppsLaunchWorkspace, request),
    selectDirectory: () => ipcRenderer.invoke(IpcChannels.dialogSelectDirectory),
    selectFiles: () => ipcRenderer.invoke(IpcChannels.dialogSelectFiles),
    readTextFile: (path: string) => ipcRenderer.invoke(IpcChannels.appReadTextFile, path),
    saveClipboardImage: (data: Uint8Array, mimeType: string) =>
      ipcRenderer.invoke(IpcChannels.appSaveClipboardImage, { data, mimeType }),
    onQuotedToMain: (callback: (text: string) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, text: string) => callback(text)
      ipcRenderer.on(IpcChannels.appQuoteToMain, listener)
      return () => {
        ipcRenderer.removeListener(IpcChannels.appQuoteToMain, listener)
      }
    }
  },
  settings: {
    get: () => ipcRenderer.invoke(IpcChannels.settingsGet),
    update: (patch: unknown) => ipcRenderer.invoke(IpcChannels.settingsUpdate, patch)
  },
  channels: {
    catalog: () => ipcRenderer.invoke(IpcChannels.channelsCatalog),
    list: () => ipcRenderer.invoke(IpcChannels.channelsList),
    get: (id: string) => ipcRenderer.invoke(IpcChannels.channelsGet, id),
    create: (input: unknown) => ipcRenderer.invoke(IpcChannels.channelsCreate, input),
    update: (input: unknown) => ipcRenderer.invoke(IpcChannels.channelsUpdate, input),
    disable: (input: unknown) => ipcRenderer.invoke(IpcChannels.channelsDisable, input),
    requestEnable: (input: unknown) => ipcRenderer.invoke(IpcChannels.channelsRequestEnable, input),
    restart: (input: unknown) => ipcRenderer.invoke(IpcChannels.channelsRestart, input),
    remove: (input: unknown) => ipcRenderer.invoke(IpcChannels.channelsDelete, input),
    beginCredential: (input: unknown) => ipcRenderer.invoke(IpcChannels.channelsCredentialBegin, input),
    submitCredential: (input: unknown) => ipcRenderer.invoke(IpcChannels.channelsCredentialSubmit, input),
    rotateCredential: (input: unknown) => ipcRenderer.invoke(IpcChannels.channelsCredentialRotate, input),
    beginPolicy: (input: unknown) => ipcRenderer.invoke(IpcChannels.channelsPolicyBegin, input),
    createPolicy: (input: unknown) => ipcRenderer.invoke(IpcChannels.channelsPolicyCreate, input),
    listAudits: (input: unknown) => ipcRenderer.invoke(IpcChannels.channelsListAudits, input),
    runtimeStatus: (input: unknown) => ipcRenderer.invoke(IpcChannels.channelsRuntimeStatus, input),
    listDeliveryAttempts: (input: unknown) => ipcRenderer.invoke(IpcChannels.channelsListDeliveryAttempts, input),
    listDeliveryAudits: (input: unknown) => ipcRenderer.invoke(IpcChannels.channelsListDeliveryAudits, input),
    listPolicies: (input: unknown) => ipcRenderer.invoke(IpcChannels.channelsListPolicies, input),
    deletePolicy: (input: unknown) => ipcRenderer.invoke(IpcChannels.channelsDeletePolicy, input),
    listConversations: (input: unknown) => ipcRenderer.invoke(IpcChannels.channelsListConversations, input),
    setTarget: (input: unknown) => ipcRenderer.invoke(IpcChannels.channelsSetTarget, input),
    listCandidates: (input: unknown) => ipcRenderer.invoke(IpcChannels.channelsListCandidates, input),
    allowCandidate: (input: unknown) => ipcRenderer.invoke(IpcChannels.channelsAllowCandidate, input),
    ignoreCandidate: (input: unknown) => ipcRenderer.invoke(IpcChannels.channelsIgnoreCandidate, input)
  },
  modelProviders: {
    list: () => ipcRenderer.invoke(IpcChannels.modelProvidersList),
    upsert: (provider: unknown) => ipcRenderer.invoke(IpcChannels.modelProvidersUpsert, provider),
    remove: (providerId: string) => ipcRenderer.invoke(IpcChannels.modelProvidersRemove, providerId),
    setEnabled: (providerId: string, enabled: boolean) => ipcRenderer.invoke(IpcChannels.modelProvidersSetEnabled, providerId, enabled),
    addOrUpdateModel: (providerId: string, model: unknown) => ipcRenderer.invoke(IpcChannels.modelProvidersAddOrUpdateModel, providerId, model),
    removeModel: (providerId: string, modelId: string) => ipcRenderer.invoke(IpcChannels.modelProvidersRemoveModel, providerId, modelId),
    setDefaultChatModel: (providerId: string, modelId: string) => ipcRenderer.invoke(IpcChannels.modelProvidersSetDefaultChatModel, providerId, modelId),
    testConnection: (
      providerId: string,
      options?: {
        modelId?: string
        apiKey?: string
        /** PLAT-61 代理自检（同一通道的 additive 参数；无鉴权 GET，走当前 session 代理）。 */
        proxyProbeUrl?: string
        /** PLAT-63 单端点测试（同一通道的 additive 参数；主进程解析 Key，渲染层不持有凭据）。 */
        endpointTest?: { kind: string; baseUrl: string }
      }
    ) => ipcRenderer.invoke(IpcChannels.modelProvidersTestConnection, providerId, options),
    runRuntimeChecks: (
      providerId: string,
      options?: { modelId?: string; apiKey?: string; runtimeId?: string; checkGateway?: boolean }
    ) => ipcRenderer.invoke(IpcChannels.modelProvidersRunRuntimeChecks, providerId, options),
    getRuntimeCheckReport: (providerId: string, modelId: string, runtimeId?: string) =>
      ipcRenderer.invoke(IpcChannels.modelProvidersGetRuntimeCheckReport, providerId, modelId, runtimeId),
    previewModelSync: (providerId: string) => ipcRenderer.invoke(IpcChannels.modelProvidersPreviewModelSync, providerId),
    applyModelSync: (providerId: string, plan: unknown) => ipcRenderer.invoke(IpcChannels.modelProvidersApplyModelSync, providerId, plan),
    /**
     * T1–T3：图像生成 / 编辑（同一条通道；`operation:'edit'` 是 additive 参数）。
     * 渲染层只给 prompt/size/count/topicId 与原图引用，Key 由主进程解析；
     * 返回 `{ok:true,messageId,images:[{kind,mime,fileName,byteLength,width?,height?}]}`（引用，不是 base64）。
     */
    generateImage: (input: {
      providerId: string
      modelId: string
      prompt: string
      topicId: string
      size?: string
      count?: number
      operation?: 'generate' | 'edit'
      /** 会话图片只传文件名；上传图片传字节（主进程落盘后再出站）。 */
      sourceImage?: { fileName: string } | { mime: string; bytes: Uint8Array }
    }) =>
      ipcRenderer.invoke(IpcChannels.modelProvidersGenerateImage, input.providerId, {
        modelId: input.modelId,
        prompt: input.prompt,
        topicId: input.topicId,
        size: input.size,
        count: input.count,
        ...(input.operation === 'edit' ? { operation: 'edit' } : {}),
        ...(input.sourceImage === undefined ? {} : { sourceImage: input.sourceImage })
      }),
    /**
     * PLAT-82：开始一次「检测模型」（联通性 / 协议支持，可多选）。
     * 结果不落库：进度经 `onModelDetectionProgress` 逐模型推送，结束经 `onModelDetectionDone`。
     */
    detectModels: (providerId: string, options: { modes: ModelDetectionMode[]; runId: string }) =>
      ipcRenderer.invoke(IpcChannels.modelProvidersDetectModels, providerId, options),
    /** 取消一次检测；未知 runId 幂等成功。 */
    cancelModelDetection: (runId: string) => ipcRenderer.invoke(IpcChannels.modelProvidersCancelModelDetection, runId),
    /** 订阅单模型结果（完整 `ModelDetectionResult`，一条模型一条事件）。返回取消订阅函数。 */
    onModelDetectionProgress: (callback: (result: ModelDetectionResult) => void) => {
      const listener = (_event: unknown, result: ModelDetectionResult): void => callback(result)
      ipcRenderer.on(IpcChannels.modelProvidersDetectionProgress, listener)
      return () => ipcRenderer.removeListener(IpcChannels.modelProvidersDetectionProgress, listener)
    },
    /** 订阅 run 结束（runId + 是否被用户停止）。返回取消订阅函数。 */
    onModelDetectionDone: (callback: (runId: string, payload: { stopped: boolean }) => void) => {
      const listener = (_event: unknown, runId: string, payload: { stopped: boolean }): void =>
        callback(runId, payload)
      ipcRenderer.on(IpcChannels.modelProvidersDetectionDone, listener)
      return () => ipcRenderer.removeListener(IpcChannels.modelProvidersDetectionDone, listener)
    },
    /** PLAT-58：只读、按需读取已保存的完整 Key（产品 owner 决定，交互侧负责 30s/失焦回掩码）。 */
    revealApiKey: (providerId: string) => ipcRenderer.invoke(IpcChannels.modelProvidersRevealApiKey, providerId),
    setCustomHeaders: (providerId: string, headers: unknown) =>
      ipcRenderer.invoke(IpcChannels.modelProvidersSetCustomHeaders, providerId, headers),
    /** 显式读取自定义头明文；交互侧负责 30s/失焦/卸载清除。 */
    revealCustomHeaders: (providerId: string) =>
      ipcRenderer.invoke(IpcChannels.modelProvidersRevealCustomHeaders, providerId)
  },
  agents: {
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
  },
  assistants: {
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
  },
  webSearch: {
    listProviders: () => ipcRenderer.invoke(IpcChannels.webSearchListProviders),
    getSettings: () => ipcRenderer.invoke(IpcChannels.webSearchGetSettings),
    updateSettings: (patch: unknown) => ipcRenderer.invoke(IpcChannels.webSearchUpdateSettings, patch),
    updateProvider: (input: unknown) => ipcRenderer.invoke(IpcChannels.webSearchUpdateProvider, input),
    revealApiKey: (providerId: unknown) => ipcRenderer.invoke(IpcChannels.webSearchRevealProviderApiKey, providerId),
    checkProvider: (input: unknown) => ipcRenderer.invoke(IpcChannels.webSearchCheckProvider, input),
    searchKeywords: (input: unknown) => ipcRenderer.invoke(IpcChannels.webSearchSearchKeywords, input),
    fetchUrls: (input: unknown) => ipcRenderer.invoke(IpcChannels.webSearchFetchUrls, input)
  },
  storage: {
    listCaches: () => ipcRenderer.invoke(IpcChannels.storageListCaches),
    inspectCache: (cacheId: string) => ipcRenderer.invoke(IpcChannels.storageInspectCache, cacheId),
    clearCache: (input: unknown) => ipcRenderer.invoke(IpcChannels.storageClearCache, input),
    compactCache: (input: unknown) => ipcRenderer.invoke(IpcChannels.storageCompactCache, input),
    listCacheOperations: (query?: unknown) => ipcRenderer.invoke(IpcChannels.storageListCacheOperations, query)
  },
  /** 产品模块 IPC：platform 只做路由，语义由各 product 的 service/bootstrap 注册。 */
  products: {
    invoke: (productId: string, method: string, payload?: unknown) =>
      ipcRenderer.invoke(IpcChannels.productIpcInvoke, productId, method, payload),
    onEvent: (productId: string, event: string, callback: (data: unknown) => void) => {
      ensureProductEventBridge()
      const key = productEventKey(productId, event)
      const subscribers = productEventSubscribers.get(key) ?? new Set<ProductEventSubscriber>()
      subscribers.add(callback)
      productEventSubscribers.set(key, subscribers)
      return () => {
        const currentSubscribers = productEventSubscribers.get(key)
        if (!currentSubscribers) return
        currentSubscribers.delete(callback)
        if (currentSubscribers.size === 0) {
          productEventSubscribers.delete(key)
        }
        releaseProductEventBridgeIfIdle()
      }
    }
  },
  notifications: {
    list: (query?: unknown) => ipcRenderer.invoke(IpcChannels.notificationsList, query),
    getUnreadCount: (input?: { productId?: string }) => ipcRenderer.invoke(IpcChannels.notificationsGetUnreadCount, input),
    markRead: (id: string) => ipcRenderer.invoke(IpcChannels.notificationsMarkRead, { id }),
    acknowledge: (id: string) => ipcRenderer.invoke(IpcChannels.notificationsAcknowledge, { id }),
    dismiss: (id: string) => ipcRenderer.invoke(IpcChannels.notificationsDismiss, { id }),
    snooze: (id: string, until: string) => ipcRenderer.invoke(IpcChannels.notificationsSnooze, { id, until }),
    requestDesktopPermission: () => ipcRenderer.invoke(IpcChannels.notificationsRequestDesktopPermission)
  },
  jobs: {
    getRun: (runId: string) => ipcRenderer.invoke(IpcChannels.jobsGetRun, runId),
    listRunPage: (query?: unknown) => ipcRenderer.invoke(IpcChannels.jobsListRunPage, query),
    /** 只读：注册任务调度投影（`jobRuntime.listSchedules()`），没有写入口。 */
    listSchedules: () => ipcRenderer.invoke(IpcChannels.jobsListSchedules)
  },
  window: {
    minimize: () => ipcRenderer.invoke(IpcChannels.windowMinimize),
    toggleMaximize: () => ipcRenderer.invoke(IpcChannels.windowMaximize),
    close: () => ipcRenderer.invoke(IpcChannels.windowClose),
    isMaximized: () => ipcRenderer.invoke(IpcChannels.windowIsMaximized),
    setMinimumSize: (width: number, height: number) => ipcRenderer.invoke(IpcChannels.windowSetMinimumSize, width, height),
    resetMinimumSize: () => ipcRenderer.invoke(IpcChannels.windowResetMinimumSize),
    onMaximizedChange: (callback: (isMaximized: boolean) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, isMaximized: boolean) => callback(isMaximized)
      ipcRenderer.on(IpcChannels.windowMaximizedChanged, listener)
      return () => {
        ipcRenderer.removeListener(IpcChannels.windowMaximizedChanged, listener)
      }
    }
  },
  /**
   * 受控 workspace 命名空间：8 个具名方法，**没有**任意 channel/URL/路径/BrowserWindow 入口。
   * 身份与权限完全由 Main 从 `event.sender` + 窗口 registry 推导，renderer 参数里没有 token/owner capability。
   * P2-03 新增的三个 `tabs*` 方法是 `.tabs.*`（一级菜单页 Tab runtime）的受控入口，准入姿态与面板命令同构；
   * Tab 的**事件**复用同一个 `onEvent` 订阅（不新增事件通道，也不扩事件词汇）。
   */
  workspace: {
    getHostContext: () => ipcRenderer.invoke(IpcChannels.workspaceGetHostContext),
    getSnapshot: () => ipcRenderer.invoke(IpcChannels.workspaceGetSnapshot),
    command: (request: unknown) => ipcRenderer.invoke(IpcChannels.workspaceCommand, request),
    hostLifecycle: (request: unknown) => ipcRenderer.invoke(IpcChannels.workspaceHostLifecycle, request),
    tabsGetSnapshot: () => ipcRenderer.invoke(IpcChannels.workspaceTabsGetSnapshot),
    tabsCommand: (request: unknown) => ipcRenderer.invoke(IpcChannels.workspaceTabsCommand, request),
    tabsHostLifecycle: (request: unknown) => ipcRenderer.invoke(IpcChannels.workspaceTabsHostLifecycle, request),
    onEvent: (callback: (event: unknown) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, event: unknown) => callback(event)
      ipcRenderer.on(IpcChannels.workspaceEvent, listener)
      return () => {
        ipcRenderer.removeListener(IpcChannels.workspaceEvent, listener)
      }
    }
  }
}

contextBridge.exposeInMainWorld('platform', api)

export type PlatformApi = typeof api
