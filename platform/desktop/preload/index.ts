import { contextBridge, ipcRenderer } from 'electron'

import { IpcChannels } from '../ipc/channels'
import { createNotificationsNamespace } from './namespaces/notifications'
import { createAgentsNamespace, createAssistantsNamespace } from './agentNamespaces'
import type {
  ChannelCandidateSafeView,
  ChannelConversationSafeView,
  ChannelDeliveryAttemptSafeView,
  ChannelDeliveryAuditSafeView,
  ChannelDeliveryTargetView,
  ChannelManagementAuditView,
  ChannelManagementCatalogEntry,
  ChannelManagementResult,
  ChannelManagementSafeView,
  ChannelPolicySafeView,
  ChannelRuntimeAuditPage,
  ChannelRuntimeSafeView,
  ChannelTestMessageReceipt,
  SecureHandoffBegin
} from '../../ai/agent-platform/channels'
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
    /** 重启应用：`needs-restart` 那类状态唯一能做的事。 */
    relaunch: () => ipcRenderer.invoke(IpcChannels.appRelaunch),
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
  /**
   * 更新提示：读一个状态、发两个动作。**没有地址参数**——载荷里能传地址，界面就等于能决定打开哪个页面。
   * 开发态只有 `getState` 在主进程有接收方，另外两个调用会以「没有 handler」reject；界面在开发态不渲染它们。
   */
  updates: {
    getState: () => ipcRenderer.invoke(IpcChannels.updatesGetState),
    getReleaseNotes: () => ipcRenderer.invoke(IpcChannels.updatesGetReleaseNotes),
    checkNow: () => ipcRenderer.invoke(IpcChannels.updatesCheckNow),
    openUpdateLink: (destination: unknown) => ipcRenderer.invoke(IpcChannels.updatesOpenLink, destination),
    /** 订阅「结论变了」。返回退订函数：拿不到退订等于每次挂载漏一个监听。 */
    onChanged: (callback: (projection: unknown) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, projection: unknown) => callback(projection)
      ipcRenderer.on(IpcChannels.updatesChanged, listener)
      return () => {
        ipcRenderer.removeListener(IpcChannels.updatesChanged, listener)
      }
    }
  },
  channels: {
    catalog: () => ipcRenderer.invoke(IpcChannels.channelsCatalog) as Promise<readonly ChannelManagementCatalogEntry[]>,
    // 返回形状写进类型：渲染层若按 `result.id` 去取（真实形状是 `result.channel.id`），typecheck 直接红。
    list: () => ipcRenderer.invoke(IpcChannels.channelsList) as Promise<readonly ChannelManagementSafeView[]>,
    /** 通知设置页的只读投影：可投递三档 + 绑定目标（0/1/多），不写任何通道配置。 */
    listDeliveryTargets: () => ipcRenderer.invoke(IpcChannels.channelsListDeliveryTargets) as Promise<{ channels: readonly ChannelDeliveryTargetView[] }>,
    get: (id: string) => ipcRenderer.invoke(IpcChannels.channelsGet, id) as Promise<ChannelManagementSafeView | null>,
    create: (input: unknown) => ipcRenderer.invoke(IpcChannels.channelsCreate, input) as Promise<ChannelManagementResult>,
    update: (input: unknown) => ipcRenderer.invoke(IpcChannels.channelsUpdate, input) as Promise<ChannelManagementResult>,
    disable: (input: unknown) => ipcRenderer.invoke(IpcChannels.channelsDisable, input) as Promise<ChannelManagementResult>,
    requestEnable: (input: unknown) => ipcRenderer.invoke(IpcChannels.channelsRequestEnable, input) as Promise<ChannelManagementResult>,
    restart: (input: unknown) => ipcRenderer.invoke(IpcChannels.channelsRestart, input) as Promise<ChannelManagementResult>,
    remove: (input: unknown) => ipcRenderer.invoke(IpcChannels.channelsDelete, input) as Promise<ChannelManagementResult>,
    beginCredential: (input: unknown) => ipcRenderer.invoke(IpcChannels.channelsCredentialBegin, input) as Promise<SecureHandoffBegin>,
    submitCredential: (input: unknown) => ipcRenderer.invoke(IpcChannels.channelsCredentialSubmit, input) as Promise<ChannelManagementResult>,
    rotateCredential: (input: unknown) => ipcRenderer.invoke(IpcChannels.channelsCredentialRotate, input) as Promise<ChannelManagementResult>,
    beginPolicy: (input: unknown) => ipcRenderer.invoke(IpcChannels.channelsPolicyBegin, input) as Promise<SecureHandoffBegin>,
    createPolicy: (input: unknown) => ipcRenderer.invoke(IpcChannels.channelsPolicyCreate, input),
    listAudits: (input: unknown) => ipcRenderer.invoke(IpcChannels.channelsListAudits, input) as Promise<readonly ChannelManagementAuditView[]>,
    runtimeStatus: (input: unknown) => ipcRenderer.invoke(IpcChannels.channelsRuntimeStatus, input) as Promise<ChannelRuntimeSafeView>,
    listDeliveryAttempts: (input: unknown) => ipcRenderer.invoke(IpcChannels.channelsListDeliveryAttempts, input) as Promise<readonly ChannelDeliveryAttemptSafeView[]>,
    listDeliveryAudits: (input: unknown) => ipcRenderer.invoke(IpcChannels.channelsListDeliveryAudits, input) as Promise<readonly ChannelDeliveryAuditSafeView[]>,
    /** 运行审计一页（只读）：`{ id, limit?, cursor? }`；游标形状 `{ createdAt, id }`。 */
    listRuntimeAudits: (input: unknown) => ipcRenderer.invoke(IpcChannels.channelsListRuntimeAudits, input) as Promise<ChannelRuntimeAuditPage>,
    /** 真发一条测试消息：`{ id, text }` → `{ state: 'accepted' | 'unconfirmed' | 'failed', … }`。 */
    sendTestMessage: (input: unknown) => ipcRenderer.invoke(IpcChannels.channelsSendTestMessage, input) as Promise<ChannelTestMessageReceipt>,
    listPolicies: (input: unknown) => ipcRenderer.invoke(IpcChannels.channelsListPolicies, input) as Promise<readonly ChannelPolicySafeView[]>,
    deletePolicy: (input: unknown) => ipcRenderer.invoke(IpcChannels.channelsDeletePolicy, input),
    listConversations: (input: unknown) => ipcRenderer.invoke(IpcChannels.channelsListConversations, input) as Promise<readonly ChannelConversationSafeView[]>,
    // 只有频道 id + 对话 id；主进程用完会话 id 就丢，回的是成败与原因。
    openConversation: (input: unknown) => ipcRenderer.invoke(IpcChannels.channelsOpenConversation, input) as Promise<{ ok: true } | { ok: false; code: string }>,
    setTarget: (input: unknown) => ipcRenderer.invoke(IpcChannels.channelsSetTarget, input),
    listCandidates: (input: unknown) => ipcRenderer.invoke(IpcChannels.channelsListCandidates, input) as Promise<readonly ChannelCandidateSafeView[]>,
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
    /** 全局巡检结论（调度在主进程的每日任务，界面只读）。 */
    getInUseRetired: () => ipcRenderer.invoke(IpcChannels.modelProvidersGetInUseRetired),
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
     * 进度经 `onModelDetectionProgress` 逐模型推送，结束经 `onModelDetectionDone`；
     * 可用性结论（ok/failed + 时间 + 配置指纹）由主进程落库。
     * `modelIds` 缺省 = 全部模型（自动检测只传新增/变更/过期的那几个）。
     */
    detectModels: (
      providerId: string,
      options: { modes: ModelDetectionMode[]; runId: string; modelIds?: string[] }
    ) => ipcRenderer.invoke(IpcChannels.modelProvidersDetectModels, providerId, options),
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
  agents: createAgentsNamespace(ipcRenderer),
  assistants: createAssistantsNamespace(ipcRenderer),
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
  notifications: createNotificationsNamespace(ipcRenderer),
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
    /**
     * 自绘标题栏的菜单条：`list` 只读应用菜单的顶层标签，`popup` 按索引弹出**既有**子菜单。
     * 没有任意命令/role/channel 入口；菜单内容与行为仍由 Main 的 `buildAppMenu` 唯一决定。
     */
    menu: {
      list: () => ipcRenderer.invoke(IpcChannels.windowMenuList),
      popup: (index: number, x: number, y: number) => ipcRenderer.invoke(IpcChannels.windowMenuPopup, index, x, y),
      /** 应用菜单被重建（新增/删除菜单）时重读顶层标签：渲染层不缓存、不自己维护菜单表。 */
      onChanged: (callback: () => void) => {
        const listener = (_event: Electron.IpcRendererEvent): void => callback()
        ipcRenderer.on(IpcChannels.windowMenuChanged, listener)
        return () => {
          ipcRenderer.removeListener(IpcChannels.windowMenuChanged, listener)
        }
      }
    },
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
