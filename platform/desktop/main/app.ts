import { app, BrowserWindow, ipcMain, Menu, nativeTheme, protocol, safeStorage, session, shell, type IpcMainInvokeEvent, type Tray } from 'electron'
import { mkdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { release } from 'node:os'
import { join, resolve } from 'node:path'

import type { AgentChatRuntimeRequest, AgentChatRuntimeResult } from '../../ai/agent-platform/runtime/agentChatRuntime'
import { AgentSessionRuntimeService } from '../../ai/agent-platform/runtime/AgentSessionRuntimeService'
import { createAgentRuntimeConsoleTraceRecorder } from '../../ai/agent-platform/runtime/AgentRuntimeOpenTelemetryTraceRecorder'
import { AgentRuntimeCompositionService } from '../../ai/agent-platform/runtime/AgentRuntimeCompositionService'
import { resolveEffectiveAgentModel } from '../../ai/agent-platform/runtime/effectiveAgentModel'
import { APP_ACCEPTANCE_NAME, APP_BUNDLE_ID, APP_INTERNAL_NAME } from '../appIdentity'
import {
  AgentTaskDispatchService,
  AgentTaskExecutionCoordinator,
  AgentTaskSchedulerRuntimeService,
  TaskManagementToolRuntimeService
} from '../../ai/agent-platform/runtime/tasks'
import {
  registerChannelMaintenanceJobHandlers,
  scheduleChannelMaintenanceJobs
} from '../../ai/agent-platform/channels'
import { createElectronChannelCredentialVault } from '../../secrets/channels'
import { createAssistantImageMessageService } from '../../ai/assistant-platform/images/assistantImageMessageService'
import { createGeneratedImageStorage } from '../../storage/generatedImageStorage'
import { registerGeneratedImageProtocol, registerGeneratedImageScheme } from './generatedImageProtocol'
import { resolveImageEditSource } from './providerImageSource'
import { ClaudeCodeRuntimeDriver } from '../../ai/agent-platform/runtime/drivers/claudeCode'
import { RuntimeDriverRegistry } from '../../ai/agent-platform/runtime/RuntimeDriverRegistry'
import { ToolApprovalRegistry } from '../../ai/agent-platform/runtime/policy'
import { createAgentPlatformServices } from '../../ai/agent-platform/services'
import { McpRuntimeService } from '../../ai/agent-platform/mcp'
import { mergeAgentRuntimeSessionState, reconcileStalePendingMessages, type AgentStoreState } from '../../ai/agent-platform/store/agentStore'
import { createAgentPlatformDatabase } from '../../ai/agent-platform/db/createAgentPlatformDatabase'
import { createAssistantPlatformDatabase } from '../../ai/assistant-platform/db/createAssistantPlatformDatabase'
import { createAssistantPlatformRepositories } from '../../ai/assistant-platform/repositories/createAssistantPlatformRepositories'
import { createAssistantChatRuntimeService } from '../../ai/assistant-platform/runtime/AssistantChatRuntimeService'
import { createWebSearchCredentialStore } from '../../ai/web-search/runtime/WebSearchCredentialStore'
import { createWebSearchService } from '../../ai/web-search/runtime/WebSearchService'
import { AssistantTemplateRegistry } from '../../ai/assistant-platform/library/AssistantTemplateRegistry'
import { AssistantLibraryService } from '../../ai/assistant-platform/library/AssistantLibraryService'
import { platformAssistantTemplates } from '../../ai/assistant-platform/library/platformAssistantTemplates'
import { createAssistantTemplateRegistrationsFromManifests } from '../../ai/assistant-platform/library/assistantTemplateManifestAdapter'
import { AssistantTopicNamingService } from '../../ai/assistant-platform/naming/AssistantTopicNamingService'
import {
  buildDefaultAssistantLocalizationPatch,
  createDefaultAssistantSeed
} from '../../ai/assistant-platform/seeds/defaultAssistantSeed'
import { getPlatformFetch } from '../../network/platformFetch'
import { createAgentPlatformRepositories } from '../../ai/agent-platform/repositories/createAgentPlatformRepositories'
import { createAgentSqliteStoreWithOptions } from '../../ai/agent-platform/store/agentSqliteStore'
import { createDefaultAgentPersistentState, mergeAgentStoreSeeds } from '../../ai/agent-platform/store/agentPersistentStore'
import type {
  SkillInstallFromDirectoryOptions,
  SkillInstallFromZipOptions,
  SkillInstallOptions,
  SkillToggleOptions
} from '../../ai/agent-platform/schemas/skillSchemas'
import { syncBuiltinSkillsFromResource } from '../../ai/agent-platform/skills/builtinSkillSync'
import { createSkillSearchService } from '../../ai/agent-platform/skills/skillSearchService'
import { createSkillService } from '../../ai/agent-platform/skills/skillService'
import { SkillsRuntimeService } from '../../ai/agent-platform/skills/SkillsRuntimeService'
import { buildAgentSkillsRuntimeCatalog } from '../../ai/agent-platform/skills/skillRuntimeInspector'
import { ToolRegistry } from '../../ai/agent-platform/tools'
import type { ModelDefinition, ModelProviderInput, ProviderState, SafeModelProvider } from '../../ai/providers/modelProviderTypes'
import { probeProviderProxyTarget, testModelProviderConnection } from '../../ai/providers/providerConnection'
import { createInUseModelPatrolRuntime } from '../../ai/providers/inUseModelPatrolRuntime'
import {
  registerInUseModelPatrolHandler,
  syncInUseModelPatrolSchedule
} from '../../ai/providers/registerInUseModelPatrolJob'
import { isEndpointProbeKind, probeProviderEndpoint } from '../../ai/providers/providerEndpointProbe'
import { generateProviderImages, validateImageGenerationInput } from '../../ai/providers/providerImageGeneration'
import {
  editProviderImages,
  validateImageEditInput,
  type ImageEditSourceMime
} from '../../ai/providers/providerImageEdit'
import type { StoredGeneratedImage } from '../../storage/generatedImageStorage'
import { createModelProviderDetectionService } from './modelProviderDetectionService'
import type { ModelDetectionMode } from '../../ai/providers/modelDetection/types'
import {
  normalizeModelSyncPlan,
  previewProviderModelSync,
  toModelSyncFailure,
  type ModelSyncApplyOutcome
} from '../../ai/providers/providerModelSync'
import { createProviderStore } from '../../ai/providers/providerStore'
import { createProviderSqliteStorage } from '../../ai/providers/storage/providerSqliteStorage'
import { createElectronSecretVault } from '../../secrets'
import { summarizeProductManifests, type ProductManifest } from '../../product-manifest'
import {
  createPlatformAgentSeed,
  localizeBuiltinSeedCopy,
  mergeAgentSeeds,
  type BuiltinSeedLanguageVariant
} from '../../ai/agent-platform/seeds'
import type { ProductAgentSeedFactory } from '../../ai/agent-platform/seeds/mergeAgentSeeds'
import type { AgentSessionEntity, AgentSessionMessageEntity, CreateAgentSessionDto, CreateAgentSessionMessagesDto, UpdateAgentSessionDto } from '../../ai/agent-platform/schemas/sessionSchemas'
import type { AgentEntity, UpdateAgentDto } from '../../ai/agent-platform/schemas/agentSchemas'
import type { ProductAgentToolHandlerRegistration } from '../../ai/agent-platform/productTools/productAgentToolBootstrapContracts'
import {
  ProductAgentToolRegistry,
  ProductAgentToolRuntimeService,
  buildProductAgentToolPackageEditorView,
  upsertAgentProductToolPackageBinding
} from '../../ai/agent-platform/productTools'
import type {
  ProductAgentToolInvokeInput,
  ProductAgentToolInvokeResult
} from '../../ai/agent-platform/productTools/productAgentToolSchemas'
import { createSqliteProductAgentToolTraceRepository } from '../../ai/agent-platform/productTools/createSqliteProductAgentToolTraceRepository'
import type { AppLanguage, AppSettingsPatch, ModelDefaultsSettings, NetworkSettings } from '../../settings/schema/appSettings'
import { createDefaultAppSettings, supportedLanguages } from '../../settings/schema/appSettings'
import { createSettingsStore, type SettingsCommittedListener } from '../../settings/store/settingsStore'
import { applySessionProxySettings } from '../../network/applySessionProxySettings'
import { assertProxySettingsPatchAccepted } from '../../network/proxySettingsGuard'
import { DIRECT_PROBE_ENDPOINTS, isLoopbackProxyEndpoint, isProxyEndpointReachable, parseResolvedProxy, probeDirectEgress } from '../../network/proxySelfTest'
import { createShellTimeZoneProvider } from './shellTimeZone'
import { createTaskIpcScheduleValidationOptions } from './taskScheduleValidationOptions'
import { createJsonFileStorage } from '../../storage/jsonFileStorage'
import { composeUpdateCheck } from './composition/updateCheck'
import { IpcChannels } from '../ipc/channels'
import { assertBoolean } from '../../ai/agent-platform/channels/ChannelManagementContracts'
import { createProductIpcRegistry, type ProductIpcMethod } from '../ipc/productIpcRegistry'
import { createProductIpcInvoker } from './productIpcInvoker'
import { registerWindowIpc } from './ipc/windowIpc'
import { registerWebIpc } from './ipc/webIpc'
import { registerChannelIpc } from './ipc/channelIpc'
import { registerAssistantIpc } from './ipc/assistantIpc'
import { createMainWindowHost } from './window/mainWindow'
import { createQuitOrchestrator, createRuntimeDisposer } from './lifecycle/quit'
import { registerPlatformRetentionJobs } from './platformRetentionJobs'
import { composeNotificationRuntimeForApp } from './composition/notifications'
import { composeModelIpc } from './composition/model'
import { composeAgentToolsIpc } from './composition/agentTools'
import { composeAgentIpc } from './composition/agent'
import { composeSettingsIpc, composeStorageIpc } from './composition/settingsAndStorage'
import { createAssistantStreamSink } from './assistantStreamBroadcast'
import { createAgentBroadcasts } from './composition/agentBroadcast'
import { runProductBootstrap } from './productBootstrap'
import { showBootFailurePage } from './bootFailureWindow'
import { registerProductIpcEventSender } from '../ipc/productIpcEventBridge'
import { createJobRunQueryService, createJobRunSqliteStore, createJobRuntime, createJobScheduleQueryService, scheduleJobRunRetention, type JobRuntime } from '../../jobs'
import { registerNotificationIpcHandlers } from '../../notifications/ipc/notificationIpcHandlers'
import { configureNotificationRuntime, getNotificationRuntime } from '../../notifications/ipc/registerNotificationIpc'
import { wireTaskFailureNotifier } from '../../notifications/producers/wireTaskFailureNotifier'
import { registerEventBusIpcHandlers } from '../../message-bus/ipc/eventBusIpcHandlers'
import { getEventBusRuntime } from '../../message-bus/ipc/registerEventBusIpc'
import { buildAppMenu } from '../menu/appMenu'
import { createAppTray } from '../tray/appTray'
import { createMainWindow, loadMainWindowRenderer } from '../window/createMainWindow'
import { wireRendererProcessDiagnostics } from '../window/rendererProcessDiagnostics'
import { createRendererProcessLog } from '../window/rendererProcessLog'
import { createAppLog } from '../../observability/logging/appLog'
import { redactText } from '../../secrets/redaction/redactText'
import { composePanelWorkspace } from './workspace/composePanelWorkspace'
import { createDetachedWindowFactory } from './workspace/panelDetachedWindowFactory'
import { createPanelDetachedWindowHost } from './workspace/panelDetachedWindowHost'
import { readWorkspaceContextTheme, readWorkspaceContextTimeZone } from './workspace/panelWorkspaceRuntimePreferences'
import {
  reportPanelWorkspaceDispose,
  reportPanelWorkspaceFlush,
  reportPanelWorkspaceStart
} from './workspace/panelWorkspaceStartupReport'
import { createWorkspaceWindowRegistry } from './workspace/workspaceWindowRegistry'
import { MAIN_WINDOW_PRELOAD_PATH, createSecureWindowSecurity } from '../window/createMainWindow'
import { screen } from 'electron'
import { pathToFileURL } from 'node:url'
import { safeSendToMainWindow, wireRendererSendGuard } from '../window/safeRendererSend'
import { wireWindowChromeState } from '../window/windowChrome'
import { createAgentIpcHandlers } from './agentIpcHandlers'
import { ExternalAppsService } from './externalApps/ExternalAppsService'
import { validateLaunchExternalAppRequest } from './externalApps/externalAppLauncher'
import { registerAgentTaskIpcHandlers } from './registerAgentTaskIpcHandlers'
import { createAssistantIpcHandlers } from './assistantIpcHandlers'
import { createCacheGovernanceIpcHandlers } from './cacheGovernanceIpcHandlers'
import { createWebSearchIpcHandlers } from './webSearchIpcHandlers'
import { createAgentStateCoordinator, type ReplaceAgentStateOptions } from './agentStateCoordinator'
import { createAgentTaskJobBridge } from './agentTaskJobBridge'
import { createAgentTaskRunController } from './agentTaskRunController'
import { registerJobIpcHandlers } from './jobIpcHandlers'
import { createMcpRuntimeServerHostFactory } from './mcpRuntimeServerHostFactory'
import { createSkillRuntimeCapabilityResolver, createSkillRuntimeToolsResolver } from './skillRuntimeCapabilities'
import { createSkillRuntimeToolHost } from './skillRuntimeToolHost'
import { persistSkillRowChanges } from './skillRowPersistence'
import { scheduleTaskAutomationMaintenance } from './taskAutomationMaintenance'
import { configureTaskAutomationSmokeProfile } from './taskAutomationSmokeProfile'
import { configureProductAcceptanceProfile, resolveProductAcceptanceProfileOptIn } from './productAcceptanceProfile'
import {
  appendWorkspaceTestFixtureManifests,
  createWorkspaceTestFixtureAgentSeed,
  createWorkspaceTestStreamDriver,
  installWorkspaceTestFixtureHandle,
  resolveWorkspaceTestFixtures
} from './workspaceTestFixtures'
import {
  createTaskAutomationSmokeDriver,
  createTaskAutomationSmokeSeed
} from './taskAutomationSmokeFixture'
import {
  createClaudeAgentSdkRuntime,
  createClaudeSdkPreferredExecutor,
  createClaudeCodeRuntimeDriverDependencies
} from './claudeCodeRuntimeDependencies'
import { createAgentModelRuntimeProbeService } from './agentModelCompatibility/AgentModelRuntimeProbeService'
import { createAgentRuntimeProbeSnapshotStore } from './agentModelCompatibility/AgentRuntimeProbeSnapshotStore'
import { createProviderRuntimeCheckService } from './agentModelCompatibility/ProviderRuntimeCheckService'
import { createAgentModelCompatibilityControl } from './agentModelCompatibility/createAgentModelCompatibilityControl'
import { createAgentModelGatewayService } from './agentModelGateway/AgentModelGatewayService'
import { createSqliteCacheOperationAuditRepository } from '../../storage/cache-governance/CacheOperationAuditRepository'
import { CacheGovernanceService } from '../../storage/cache-governance/CacheGovernanceService'
import { CacheRegistry } from '../../storage/cache-governance/CacheRegistry'
import { registerPlatformCacheProviders } from '../../storage/cache-governance/platformCacheProviders'
import { createProductCacheRegistrar } from '../../storage/cache-governance/productCacheRegistrar'
import { createProductServiceDisposerRegistry } from '../../product-registry/productServiceDisposerRegistry'
import { getAgentTaskExecutionCoordinator, getAgentTaskExecutionCoordinatorOrNull, getAgentTaskRunController, getDisposeChannelMaintenanceJobs, getDisposeJobRunRetention, getDisposeTaskAutomationMaintenance, getInstalledProductManifestIds, getJobRuntimeForDisposal, getPanelWorkspaceForDisposal, getProductIpcRegistryForDisposal, setAgentTaskExecutionCoordinator, setAgentTaskRunController, setDisposeChannelMaintenanceJobs, setDisposeJobRunRetention, setDisposeTaskAutomationMaintenance, setInstalledProductManifestIds, setJobRuntimeForDisposal, setPanelWorkspaceForDisposal, setProductIpcRegistryForDisposal } from './composition/slots'
import { bindReplaceAgentState } from './composition/agentStateBridge'
import { createPlatformCore } from './composition/platformCore'
import { createRepositories } from './composition/repositories'
import { createAgentRuntime, platformRuntimesDisposed } from './composition/agentRuntime'
import { createChannelsAndJobs } from './composition/channelsAndJobs'

// 构造期之前绑定：切片构造时拿到的是转发函数，未绑定即调用会抛 replace-agent-state-before-bind。
bindReplaceAgentState(replaceAgentState)


let tray: Tray | null = null
let agentTaskJobBridge: ReturnType<typeof createAgentTaskJobBridge> | null = null
let agentStateCoordinator: ReturnType<typeof createAgentStateCoordinator> | null = null
// `app.getPath('userData')` below is derived from the application name. Set the stable name
// before the first path read so development runs do not fall back to a shared Chromium profile.
// The acceptance profile may override both the name and the userData path afterwards.
app.setName(APP_INTERNAL_NAME)
// 本地 dev 的 userData 默认放在仓库 `.devdata/`（launcher 注入）；打包产物不受影响。
// 这是为了绕开 Windows 受限会话里 Electron 低完整性进程写不了 %APPDATA% 的问题。
const devUserDataOverride = process.env.MACROBAY_USER_DATA?.trim()
if (!app.isPackaged && devUserDataOverride) {
  const resolvedUserData = resolve(devUserDataOverride)
  mkdirSync(resolvedUserData, { recursive: true })
  app.setPath('userData', resolvedUserData)
}
// Windows derives notification identity and taskbar grouping from the AppUserModelID.
// Without it the packaged app shows up as a generic Electron process.
if (process.platform === 'win32') app.setAppUserModelId(APP_BUNDLE_ID)
const productAcceptanceRequested = resolveProductAcceptanceProfileOptIn({
  environment: process.env,
  argv: process.argv
})
const taskAutomationSmokeProfile = configureTaskAutomationSmokeProfile({
  environment: productAcceptanceRequested ? {} : process.env,
  app
})
const productAcceptanceProfile = configureProductAcceptanceProfile({
  environment: process.env,
  argv: process.argv,
  app
})
/**
 * PLAT-33（一等 **test-only** seam）：只有 `DSH_WORKSPACE_TEST_FIXTURES`（绝对路径 JSON）命中时才注入
 * 「受控 fixture 清单 + 受控流源驱动桩」；**未设置时**本对象是冻结的 disabled 对象，且 seam 自身
 * **不触碰文件系统、不注册任何东西** ⇒ 下列三个注入点逐字退化为原行为（生产零影响）。
 * 命中但 fixture 非法 ⇒ `resolveWorkspaceTestFixtures` 构造期抛错（fail closed，绝不半开注入）。
 * PLAT-38（安全硬化）：`app.isPackaged === true` ⇒ seam **整体忽略**该 env（不读文件、不注入）⇒ 打包态没有后门；
 * 开发/测试态（`isPackaged === false`）行为与 PLAT-33 逐字相同。
 */
const workspaceTestFixtures = resolveWorkspaceTestFixtures(process.env, { isPackaged: app.isPackaged })
const platformCore = createPlatformCore({
  userDataPath: app.getPath('userData'),
  appVersion: app.getVersion(),
  platform: process.platform,
  workspaceTestFixtures
})
const {
  platformDataDirectory,
  settingsStore,
  shellTimeZone,
  providerSecretVault,
  providerStore,
  appLog,
  rendererProcessLog,
  mainWindowHost,
  taskIpcScheduleValidationOptions
} = platformCore
async function refreshTaskStateAfterCommit(): Promise<void> {
  const state = await agentServices.state.getState()
  agentTaskSchedulerRuntimeService.syncFromState(state)
  agentBroadcasts.stateChanged(state)
}
const webSearchCredentialStore = createWebSearchCredentialStore(
  createJsonFileStorage(join(app.getPath('userData'), 'platform', 'web-search-credentials.json'), { providers: {} })
)
  registerGeneratedImageScheme()
  const repositories = createRepositories({
    userDataPath: app.getPath('userData'),
    core: platformCore,
    taskAutomationSmokeProfile
  })
  const {
    legacyAgentStorage,
    agentDatabase,
    assistantDatabase,
    agentRepositories,
    assistantRepositories,
    generatedImagesDirectory,
    generatedImageStorage,
    assistantImageMessages,
    channelInboundRepository,
    channelDeliveryRepository,
    channelManagementRepository,
    channelAdapterRegistry,
    channelAcceptance,
    telegramOffsetRepository,
    slackRuntimeRepository,
    larkRuntimeRepository,
    qqRuntimeRepository,
    discordRuntimeRepository,
    wechatEnrollmentRepository,
    wechatRuntimeRepository,
    jobRunStore,
    channelCredentialVault,
    channelManagementService,
    agentStore,
    inUseModelPatrol,
    agentServices,
  } = repositories

  const agentRuntime = createAgentRuntime({
    userDataPath: app.getPath('userData'),
    tempPath: app.getPath('temp'),
    core: platformCore,
    repositories,
    hooks: {
      getAgentTaskExecutionCoordinator, getAgentTaskExecutionCoordinatorOrNull, setAgentTaskExecutionCoordinator,
      getAgentTaskRunController, setAgentTaskRunController,
      getJobRuntimeForDisposal, setJobRuntimeForDisposal,
      getPanelWorkspaceForDisposal, setPanelWorkspaceForDisposal,
      getProductIpcRegistryForDisposal, setProductIpcRegistryForDisposal,
      getDisposeTaskAutomationMaintenance, setDisposeTaskAutomationMaintenance,
      getDisposeJobRunRetention, setDisposeJobRunRetention,
      getDisposeChannelMaintenanceJobs, setDisposeChannelMaintenanceJobs,
      getInstalledProductManifestIds, setInstalledProductManifestIds
    }
  })
  const {
    skillsRoot,
    skillRuntimeCapabilityResolver,
    skillRuntimeToolsResolver,
    skillService,
    skillSearchService,
    agentSystemWorkspacesRoot,
    runtimeDriverRegistry,
    toolApprovalRegistry,
    toolRegistry,
    productAgentToolRegistry,
    productAgentToolRuntimeService,
    mcpRuntimeService,
    skillsRuntimeService,
    taskManagementToolRuntimeService,
    agentRuntimeCompositionService,
    agentRuntimeService,
  registerProductAgentToolHandler,
  syncInUseModelPatrolScheduleFromState
  } = agentRuntime

/** 退出清理的唯一实现（顺序由 lifecycle/quit.ts 决定）；这里只提供端口。 */
const runtimeDisposer = createRuntimeDisposer({
  markProductIpcClosed: () => getProductIpcRegistryForDisposal()?.markClosed(),
  flushPanelWorkspaceLayout: async () => {
    // 绝不抛：flushLayout 内部已把异常收敛成 failed，这里只负责把受控报告落日志
    const workspace = getPanelWorkspaceForDisposal()
    if (workspace === null) return
    reportPanelWorkspaceFlush({ report: await workspace.flushLayout() })
  },
  disposeMaintenanceTimers: [
    () => {
      getDisposeTaskAutomationMaintenance()?.()
      setDisposeTaskAutomationMaintenance(null)
    },
    () => {
      getDisposeJobRunRetention()?.()
      setDisposeJobRunRetention(null)
    },
    () => {
      getDisposeChannelMaintenanceJobs()?.()
      setDisposeChannelMaintenanceJobs(null)
    }
  ],
  // Abort every adapter lifetime before the shared SQLite fence closes all owners.
  disposeAdapters: [
    () => telegramRuntimeManager.dispose(),
    () => slackRuntimeManager.dispose(),
    () => larkRuntimeManager.dispose(),
    () => qqRuntimeManager.dispose(),
    () => discordRuntimeManager.dispose(),
    () => wechatRuntimeManager.dispose()
  ],
  fenceChannels: () => channelManagementRepository.fenceAllForQuit(new Date().toISOString()),
  stopTaskScheduler: () => agentTaskSchedulerRuntimeService.stop(),
  stopJobs: () => getJobRuntimeForDisposal()?.stopAll(),
  disposeProductServices: () => productServiceDisposerRegistry.disposeAll(),
  disposeAgentRuntimes: [() => agentRuntimeService.dispose(), () => mcpRuntimeService.dispose()],
  disposeWorkspace: async () => getPanelWorkspaceForDisposal()?.dispose(),
  reportWorkspaceDispose: (report) => reportPanelWorkspaceDispose({ report }),
  closeJobRunStore: () => jobRunStore.close()
})
async function disposePlatformRuntimes(): Promise<void> {
  await runtimeDisposer.dispose()
}
// 两条纯闭包（唯一依赖是接缝之后就绪的 `mainWindowHost`）提到通道构造之前：行为不变——发送那一刻
// 仍然现取主窗。通道运行时快照的广播就是这个出口，而通道构造仍在它原本的位置。
const getMainWindow = (): BrowserWindow | null => mainWindowHost.getMainWindow()
const agentBroadcasts = createAgentBroadcasts({ getMainWindow: () => getMainWindow() })

/**
 * 通道与任务作业的构造。**退出链没有搬**：`markClosed → flush 布局 → 8 个维护定时器 → 6 个
 * adapter dispose → fenceAllForQuit → jobs stopAll` 仍在下面的 `createRuntimeDisposer` 里，
 * 那条链错位在退出瞬间静默出错，全量测试看不见。
 */
const channelsAndJobs = createChannelsAndJobs({
  settingsStore,
  agentBroadcasts,
  agentRuntimeService,
  repositories: {
    agentDatabase,
    agentRepositories,
    agentServices,
    agentStore,
    channelInboundRepository,
    channelDeliveryRepository,
    channelManagementRepository,
    channelCredentialVault,
    channelManagementService,
    telegramOffsetRepository,
    slackRuntimeRepository,
    larkRuntimeRepository,
    qqRuntimeRepository,
    discordRuntimeRepository,
    wechatEnrollmentRepository,
    wechatRuntimeRepository
  }
})
const {
  channelRuntimeSupervisor,
  channelInboundService,
  channelInboundExecutionRunner,
  channelDeliveryMaintenance,
  deliverTaskResultToChannels,
  taskAutomationMaintenance,
  telegramRuntimeManager,
  slackRuntimeManager,
  larkRuntimeManager,
  qqRuntimeManager,
  discordRuntimeManager,
  wechatRuntimeManager,
  telegramRuntimeMaintenance,
  slackRuntimeMaintenance,
  larkRuntimeMaintenance,
  qqRuntimeMaintenance,
  discordRuntimeMaintenance,
  wechatRuntimeMaintenance
} = channelsAndJobs
const agentTaskDispatchService = new AgentTaskDispatchService({
  services: agentServices,
  runtime: agentRuntimeService,
  timeZone: () => shellTimeZone.get(),
  getJobBridge: () => agentTaskJobBridge,
  readHeartbeat: readHeartbeatFileFromWorkspace,
  deliverTaskResult: deliverTaskResultToChannels.deliver,
  onStateChanged: async () => {
    const nextState = await agentStore.getState()
    agentTaskSchedulerRuntimeService.syncFromState(nextState)
    agentBroadcasts.stateChanged(nextState)
  }
})
const agentTaskSchedulerRuntimeService = new AgentTaskSchedulerRuntimeService({
  startupAt: new Date().toISOString(),
  getAgentState: () => agentStore.getState(),
  enqueueDueTask: async (task) => {
    await getAgentTaskExecutionCoordinatorOrNull()?.enqueueDueTask(task.taskId)
  }
})
setAgentTaskExecutionCoordinator(new AgentTaskExecutionCoordinator({
  services: agentServices,
  dispatchQueuedRun: (input) => agentTaskDispatchService.dispatchQueuedRun(input)
}))
agentStateCoordinator = createAgentStateCoordinator({
  getState: () => agentStore.getState(),
  replaceState: (state) => agentStore.replace(state),
  enableBuiltinSkillsForNewAgents: skillService.enableBuiltinSkillsForNewAgents.bind(skillService),
  reconcileWorkspaceSkills: skillService.reconcileWorkspaceSkills.bind(skillService),
  syncSkillsRuntimeFromState,
  syncProductToolsRuntimeFromState: syncProductToolsRuntimeFromState,
  syncMcpRuntimeFromState: (state) => mcpRuntimeService.syncFromState(state),
  syncChannelsFromState: () => undefined,
  syncTaskSchedulerFromState: (state) => agentTaskSchedulerRuntimeService.syncFromState(state),
  emitStateChanged: (state) => {
    agentBroadcasts.stateChanged(state)
  }
})
const agentModelGatewayService = createAgentModelGatewayService({
  fetch: getPlatformFetch(),
  getUpstreamApiKey: async (providerId) => {
    const provider = await providerStore.resolveRuntimeProvider(providerId)
    return provider?.apiKey?.trim() || null
  }
})
const agentModelRuntimeProbeService = createAgentModelRuntimeProbeService({
  fetch: getPlatformFetch(),
  getGatewaySnapshot: () => agentModelGatewayService.getSnapshot(),
  getGatewayAuthToken: () => agentModelGatewayService.getAuthToken()
})
const agentRuntimeProbeSnapshotStore = createAgentRuntimeProbeSnapshotStore({
  userDataPath: app.getPath('userData')
})
const providerRuntimeCheckService = createProviderRuntimeCheckService({
  getProviderState: providerStore.getState,
  probeService: agentModelRuntimeProbeService,
  gatewayService: agentModelGatewayService,
  snapshotStore: agentRuntimeProbeSnapshotStore,
  fetch: getPlatformFetch()
})
const webSearchService = createWebSearchService({
  getSettings: async () => (await settingsStore.get()).webSearch,
  updateSettings: async (webSearch) => {
    await settingsStore.update({ webSearch })
  },
  credentialStore: webSearchCredentialStore,
  fetch: getPlatformFetch()
})
const webSearchIpcHandlers = createWebSearchIpcHandlers(webSearchService)
const cacheRegistry = new CacheRegistry()
registerPlatformCacheProviders({
  registry: cacheRegistry,
  agentModelRuntimeProbeService,
  agentRuntimeProbeSnapshotStore
})
const cacheGovernanceService = new CacheGovernanceService({
  registry: cacheRegistry,
  auditRepository: createSqliteCacheOperationAuditRepository(
    join(app.getPath('userData'), 'platform', 'cache-governance.sqlite')
  )
})
const cacheGovernanceIpcHandlers = createCacheGovernanceIpcHandlers(cacheGovernanceService)
const registerProductCache = createProductCacheRegistrar(cacheRegistry)
const productServiceDisposerRegistry = createProductServiceDisposerRegistry()
const agentModelCompatibilityControl = createAgentModelCompatibilityControl({
  getProviderState: providerStore.getState,
  probeService: agentModelRuntimeProbeService,
  gatewayService: agentModelGatewayService,
  snapshotStore: agentRuntimeProbeSnapshotStore
})
const claudeCodeRuntimeDependencies = createClaudeCodeRuntimeDriverDependencies({
  getProviderState: providerStore.getState,
  refreshRuntimeCheck: async (providerId, modelId, checkGateway) => providerRuntimeCheckService.runChecks({
    providerId,
    modelId,
    runtimeId: 'claude-code',
    checkGateway
  }),
  gatewayService: agentModelGatewayService,
  snapshotStore: agentRuntimeProbeSnapshotStore,
  systemWorkspaceRoot: agentSystemWorkspacesRoot
})
const isAgentWebSearchProviderReady = async (): Promise<boolean> => {
  const [settings, providers] = await Promise.all([webSearchService.getSettings(), webSearchService.listProviderViews()])
  const search = providers.find((provider) => provider.id === settings.defaultSearchProviderId)
  const fetch = providers.find((provider) => provider.id === settings.defaultFetchProviderId)
  return Boolean(search?.enabled && (search.id === 'fetch' || search.hasApiKey) && fetch?.enabled)
}
const platformAgentWebSearchBridge = {
  search: async (request: Readonly<{ query: string; maxResults?: number }>, options?: Readonly<{ signal?: AbortSignal }>) => {
    const response = await webSearchService.searchKeywords(
      { keywords: [request.query] },
      { ...(options?.signal ? { signal: options.signal } : {}), consumer: { kind: 'agent' } }
    )
    return request.maxResults ? { ...response, results: response.results.slice(0, request.maxResults) } : response
  },
  isReady: isAgentWebSearchProviderReady
}
const claudeAgentSdkRuntime = createClaudeAgentSdkRuntime({
  loadClaudeSdkModule: claudeCodeRuntimeDependencies.loadClaudeSdkModule,
  getProviderState: providerStore.getState,
  getAgentState: () => agentStore.getState(),
  saveAgentState: async (state, options) => {
    if (options?.mergeSessionId) {
      await mergeAndReplaceAgentSessionState(state, options.mergeSessionId)
      return
    }
    await replaceAgentState(state)
  },
  platformWebSearchBridge: platformAgentWebSearchBridge,
  productAgentToolBridge: {
    registry: productAgentToolRegistry,
    runtime: productAgentToolRuntimeService,
    getAgentState: () => agentStore.getState()
  },
  skillToolBridge: {
    runtime: skillsRuntimeService,
    getAgentState: () => agentStore.getState()
  },
  taskManagementToolBridge: {
    runtime: taskManagementToolRuntimeService,
    commands: agentServices.taskCommands,
    getAgentState: () => agentStore.getState(),
    getTaskRunController: () => getAgentTaskRunController()
  }
})
const claudeCodeRuntimeDriver = new ClaudeCodeRuntimeDriver({
  ...claudeCodeRuntimeDependencies,
  emitChunk: (chunk) => agentRuntimeService.emitChunk?.(chunk),
  requestToolApproval: (input) => agentRuntimeService.requestToolApproval(input),
  prewarmSession: (input) => claudeAgentSdkRuntime.prewarmSession(input),
  executeTurn: createClaudeSdkPreferredExecutor({
    sdkRuntime: claudeAgentSdkRuntime,
    platformWebSearchBridge: platformAgentWebSearchBridge,
    loadClaudeSdkModule: claudeCodeRuntimeDependencies.loadClaudeSdkModule,
    getProviderState: providerStore.getState,
    getAgentState: () => agentStore.getState(),
    saveAgentState: async (state, options) => {
      if (options?.mergeSessionId) {
        await mergeAndReplaceAgentSessionState(state, options.mergeSessionId)
        return
      }
      await replaceAgentState(state)
    }
  })
})
if (workspaceTestFixtures.enabled && workspaceTestFixtures.streamStub !== null) {
  /**
   * PLAT-33（test-only）：受控**流源驱动桩**经**既有注册点**替换 claude-code 驱动（与 task smoke 同一姿态，
   * 不新增 AgentType、不写假 provider、不发网络请求）。块间延迟让真机能在**流仍 in-flight** 时 detach/redock；
   * send/emit 计数只经 seam 自装的 `globalThis` 钩子暴露给同进程 harness。
   */
  const streamStub = createWorkspaceTestStreamDriver({
    getState: () => agentStore.getState(),
    saveState: async (state, sessionId) => {
      await mergeAndReplaceAgentSessionState(state, sessionId)
    },
    emitChunk: (chunk) => agentRuntimeService.emitChunk(chunk),
    chunkCount: workspaceTestFixtures.streamStub.chunkCount,
    chunkIntervalMs: workspaceTestFixtures.streamStub.chunkIntervalMs,
    finalText: workspaceTestFixtures.streamStub.finalText
  })
  runtimeDriverRegistry.register('claude-code', streamStub.driver)
  installWorkspaceTestFixtureHandle({ target: globalThis as unknown as Record<string, unknown>, fixtures: workspaceTestFixtures, streamStub: streamStub.stats })
} else if (taskAutomationSmokeProfile.enabled) {
  runtimeDriverRegistry.register(
    'claude-code',
    createTaskAutomationSmokeDriver({
      getState: () => agentStore.getState(),
      saveState: async (state, sessionId) => {
        await mergeAndReplaceAgentSessionState(state, sessionId)
      },
      taskTools: taskManagementToolRuntimeService
    })
  )
} else {
  runtimeDriverRegistry.register('claude-code', claudeCodeRuntimeDriver)
}
const agentIpcHandlers = createAgentIpcHandlers(
  agentServices,
  agentRuntimeService,
  {
    runTask: (agentId: string, taskId: string, expectedRevision: number) =>
      getAgentTaskExecutionCoordinator().enqueueManualRun({
        agentId,
        taskId,
        expectedRevision,
        actor: { kind: 'user', source: 'renderer-agent-drawer' }
      })
        .then((runLog) => ({ taskId, runLogId: runLog.id }))
  },
  {
    cancelTaskRun: (runLogId: string) => {
      const controller = getAgentTaskRunController()
      if (!controller) {
        throw new Error('Agent task run controller is not available.')
      }
      return controller.cancelTaskRun(runLogId)
    }
  },
  {
    getSkillRuntime: async (agentId: string) =>
      buildAgentSkillsRuntimeCatalog(skillsRuntimeService.getAgentRuntime(await agentStore.getState(), agentId))
  },
  {
    listProductToolPackages: async (agentId: string) => {
      const state = await agentStore.getState()
      return productAgentToolRegistry.listPackages(getInstalledProductManifestIds()).map((pkg) =>
        buildProductAgentToolPackageEditorView({
          package: pkg,
          binding: (state.agentProductToolPackages ?? []).find(
            (item) => item.agentId === agentId && item.productId === pkg.productId
          ),
          installedProductIds: getInstalledProductManifestIds()
        })
      )
    },
    updateProductToolPackageBinding: async (
      agentId: string,
      productId: string,
      permissionMode: 'allow-read-only' | 'prompt' | 'disabled'
    ) => {
      const nextState = await agentStore.update((state) => ({
        ...state,
        agentProductToolPackages: upsertAgentProductToolPackageBinding(state.agentProductToolPackages ?? [], {
          agentId,
          productId,
          permissionMode,
          updatedAt: new Date().toISOString()
        })
      }))
      syncProductToolsRuntimeFromState(nextState)
      agentBroadcasts.stateChanged(nextState)
      return nextState
    },
    listProductToolCallTracePage: async (query: {
      agentSessionId?: string
      productId?: string
      consumerProductId?: string
      cursor?: string
      limit?: number
    }) => agentRepositories.productToolTraces.listPage(query),
    getProductToolCallTrace: async (toolCallId: string) => agentRepositories.productToolTraces.get(toolCallId)
  },
  {
    getChannelRuntimeSnapshot: () => channelRuntimeSupervisor.snapshot(),
    restartChannelRuntime: (channelId) => channelRuntimeSupervisor.restart(channelId)
  },
  agentModelCompatibilityControl,
  {
    compose: (input) => agentRuntimeCompositionService.compose(input)
  },
  {
    retryTaskDelivery: (agentId, runLogId, attemptId) => deliverTaskResultToChannels.retry(agentId, runLogId, attemptId)
  }
)

function invalidateAgentModelCompatibilityCache(providerId?: string): void {
  if (providerId) {
    agentModelRuntimeProbeService.invalidateProvider(providerId)
    void agentRuntimeProbeSnapshotStore.invalidateProvider(providerId)
    return
  }
  agentModelRuntimeProbeService.invalidateAll()
  void agentRuntimeProbeSnapshotStore.clear()
}

const assistantTopicNamingService = new AssistantTopicNamingService({
  isEnabled: async () => (await settingsStore.get()).assistant.topicNamingEnabled,
  getLanguage: async () => (await settingsStore.get()).language,
  getNamingPrompt: async () => (await settingsStore.get()).assistant.topicNamingPrompt,
  getNamingModelId: async () => (await settingsStore.get()).assistant.topicNamingModelId,
  getProviderState: providerStore.getState,
  fetch: getPlatformFetch(),
  renameTopic: async (topicId, name) => {
    assistantRepositories.topics.update(topicId, { name, isNameManuallyEdited: false })
  }
})

const assistantChatRuntime = createAssistantChatRuntimeService({
  repos: assistantRepositories,
  getProviderState: providerStore.getState,
  fetch: getPlatformFetch(),
  webSearchService,
  topicNaming: assistantTopicNamingService,
  getTopicNamingModelId: async () => (await settingsStore.get()).assistant.topicNamingModelId,
  getDefaultAssistantModelId: async () => (await settingsStore.get()).modelDefaults.assistantModelId,
  logContextPlan: (summary) =>
    appLog.log('info', 'assistant.context-plan', { ...summary }),
  // 流式广播的装配只有这一行：通道名与窗口都在 assistantStreamBroadcast 里，
  // 组合根不再出现任何一个 assistantsStream* 的名字。
  // 传 thunk 而不是引用：`getMainWindow` 在本文件更靠后声明，直接取值会撞 TDZ（tsc 2448）。
  // 而它本来就应该在**发送那一刻**取窗口——所以延迟取值正是我们想要的行为。
  events: createAssistantStreamSink({ getMainWindow: () => getMainWindow() })
})
const assistantTemplateRegistry = new AssistantTemplateRegistry()
assistantTemplateRegistry.registerMany(platformAssistantTemplates)
const assistantLibraryService = new AssistantLibraryService({
  registry: assistantTemplateRegistry,
  repos: assistantRepositories
})
const assistantIpcHandlers = createAssistantIpcHandlers(
  assistantRepositories,
  assistantChatRuntime,
  assistantLibraryService
)

async function ensureDefaultAssistantSeed(): Promise<void> {
  const language = (await settingsStore.get()).language
  const seed = createDefaultAssistantSeed({ language })
  const existing = assistantRepositories.assistants.getById(seed.id)
  if (!existing) {
    assistantRepositories.assistants.create(seed)
    return
  }

  const localizationPatch = buildDefaultAssistantLocalizationPatch(existing, language)
  if (localizationPatch) {
    assistantRepositories.assistants.update(existing.id, localizationPatch)
  }
}


const resolveInvokingWindow = (event: IpcMainInvokeEvent): BrowserWindow | null =>
  mainWindowHost.resolveInvokingWindow(event)

async function replaceAgentState(state: AgentStoreState, options?: ReplaceAgentStateOptions): Promise<AgentStoreState> {
  if (!agentStateCoordinator) {
    throw new Error('Agent state coordinator is not available.')
  }
  return agentStateCoordinator.replaceState(state, options)
}

async function replaceAgentStateAfterSkillMutation(
  previousState: AgentStoreState,
  nextState: AgentStoreState
): Promise<AgentStoreState> {
  return replaceAgentState(nextState, {
    persist: { skipSkillRowMirror: true },
    beforePersist: (coordinatorPreviousState, coordinatorNextState) => {
      persistSkillRowChanges({
        previousState: coordinatorPreviousState,
        nextState: coordinatorNextState,
        repositories: agentRepositories
      })
    },
    previousState
  })
}

async function mergeAndReplaceAgentSessionState(
  runtimeSnapshot: AgentStoreState,
  sessionId: string
): Promise<AgentStoreState> {
  const nextState = await agentStore.update((current) => mergeAgentRuntimeSessionState(current, runtimeSnapshot, sessionId))
  syncSkillsRuntimeFromState(nextState)
  syncProductToolsRuntimeFromState(nextState)
  mcpRuntimeService.syncFromState(nextState)
  agentTaskSchedulerRuntimeService.syncFromState(nextState)
  agentBroadcasts.stateChanged(nextState)
  return nextState
}

function syncSkillsRuntimeFromState(state: AgentStoreState): void {
  for (const agent of state.agents) {
    skillsRuntimeService.syncAgentTools(state, agent.id)
  }
}

function syncProductToolsRuntimeFromState(state: AgentStoreState): void {
  for (const agent of state.agents) {
    productAgentToolRuntimeService.syncAgentTools(state, agent.id)
  }
}

async function syncAgentStateAfterMutation(previousState: AgentStoreState): Promise<AgentStoreState> {
  if (!agentStateCoordinator) {
    throw new Error('Agent state coordinator is not available.')
  }
  return agentStateCoordinator.syncAfterMutation(previousState)
}

export type DesktopAppBootstrapOptions = {
  productManifests?: readonly ProductManifest[]
  productAgentSeedFactories?: readonly ProductAgentSeedFactory[]
  /**
   * 由 generated/productServices 模块注入。
   * 各产品在 service/bootstrap 中注册 IPC 与 job handlers，platform 不包含产品域逻辑。
   */
  registerProductServices?: (deps: {
    register: ReturnType<typeof createProductIpcRegistry>['register']
    jobRuntime: JobRuntime
    eventBusRuntime: ReturnType<typeof getEventBusRuntime>
    getProviderState: () => Promise<ProviderState>
    getAppLanguage: () => Promise<'zh-CN' | 'en-US'>
    /** 模型服务页「默认模型」投影；产品只读，不能写回设置。 */
    getModelDefaults: () => Promise<ModelDefaultsSettings>
    getNetworkSettings: () => Promise<NetworkSettings>
    /** 主进程唯一的读者时区来源（产品侧的日报日界、日历月份）。 */
    getTimeZone?: () => string
    onSettingsCommitted?: (listener: SettingsCommittedListener) => () => void
    platformFetch: typeof fetch
    secretVault: ReturnType<typeof createElectronSecretVault>
    registerProductAgentToolHandler: (registration: ProductAgentToolHandlerRegistration) => void
    registerProductCache: ReturnType<typeof createProductCacheRegistrar>
    registerProductDisposer: ReturnType<typeof createProductServiceDisposerRegistry>['register']
    getAgentState?: () => Promise<AgentStoreState>
    createAgentSession?: (input: CreateAgentSessionDto) => Promise<AgentSessionEntity>
    sendAgentMessage?: (request: AgentChatRuntimeRequest) => Promise<AgentChatRuntimeResult>
    cancelAgentSession?: (sessionId: string) => Promise<void> | void
    appendAgentSessionMessages?: (input: CreateAgentSessionMessagesDto) => Promise<AgentSessionMessageEntity[]>
    updateAgentSession?: (sessionId: string, patch: UpdateAgentSessionDto) => Promise<AgentSessionEntity>
    deleteAgentSessions?: (sessionIds: string[]) => Promise<unknown>
    updateAgent?: (agentId: string, patch: UpdateAgentDto) => Promise<AgentEntity>
    isWebSearchProviderReady?: () => Promise<boolean>
    invokeProductAgentTool?: (
      state: AgentStoreState,
      input: ProductAgentToolInvokeInput
    ) => Promise<ProductAgentToolInvokeResult>
    invokeProductIpc?: (productId: string, method: string, payload?: unknown) => Promise<unknown>
  }) => void | Promise<void>
}

function resolveBootstrapProductManifests(
  productManifests: readonly ProductManifest[],
  taskSmokeEnabled: boolean
): readonly ProductManifest[] {
  if (taskSmokeEnabled) return []
  return productManifests
}

function expectedProductIpcMethods(productManifests: readonly ProductManifest[]): readonly ProductIpcMethod[] {
  return productManifests.flatMap((manifest) =>
    manifest.serviceRoutes.map(({ method }) => ({ productId: manifest.id, method }))
  )
}

function requestRuntimeSingleInstanceLock(productAcceptanceEnabled: boolean): boolean {
  if (productAcceptanceEnabled) return true
  return app.requestSingleInstanceLock()
}

function reportProductAcceptanceRegistration(input: {
  productIds: readonly string[]
  productIpcMethodCount: number
}): void {
  console.log(`[product-acceptance] products: ${input.productIds.join(',') || '(none)'}`)
  console.log(`[product-acceptance] product IPC handlers: ${input.productIpcMethodCount}`)
}

function registerIpcHandlers(
  productManifests: readonly ProductManifest[],
  productIpcRegistry: ReturnType<typeof createProductIpcRegistry>,
  jobRunQueryService: ReturnType<typeof createJobRunQueryService>,
  jobScheduleQueryService: ReturnType<typeof createJobScheduleQueryService>,
  refreshBuiltinSeedCopy: (language: AppLanguage) => Promise<void>
): void {
  /**
   * PLAT-27：外部应用枚举/启动的唯一实现（平台已有，此前无人接线）。枚举来源是 OS 的协议处理器查询
   * （macOS/Windows）；不可用（例如 Linux）时逐项 fail closed ⇒ 空列表，绝不假装已安装、绝不崩溃。
   */
  const externalAppsService = new ExternalAppsService({
    getApplicationInfoForProtocol: async (protocol) => (
      typeof app.getApplicationInfoForProtocol === 'function'
        ? await app.getApplicationInfoForProtocol(protocol)
        : {}
    ),
    openExternal: async (url) => { await shell.openExternal(url) }
  })

  // 窗口/应用/外壳/对话框类 16 个 handler 搬到 ipc/windowIpc.ts：运行期状态只经两个端口进来。
  registerWindowIpc(ipcMain, { getMainWindow, resolveInvokingWindow })

  // 存储/缓存 + 外部应用 + 产品清单摘要 8 个 handler 搬到 ipc/storageIpc.ts。
  composeStorageIpc(ipcMain, {
    cacheGovernance: cacheGovernanceIpcHandlers,
    externalApps: externalAppsService,
    summarizeProducts: () => summarizeProductManifests(productManifests)
  })

  // 设置读写两个 handler 搬到 ipc/settingsIpc.ts：端口按「设置存储 / 助手种子 / 时区 / 工作区通知」四个域给。
  // 设置与存储两片：端口与状态读法在 composition/settingsAndStorage.ts。
  composeSettingsIpc(ipcMain, {
    settings: settingsStore,
    ensureDefaultAssistantSeed,
    refreshBuiltinSeedCopy,
    refreshTimeZone: () => shellTimeZone.refresh(),
    getWorkspaceForNotify: () => getPanelWorkspaceForDisposal()
  })
  // 渠道管理 / 入站两个服务共 25 个 handler 搬到 ipc/channelIpc.ts；
  // 退出链（dispose 五步、维护定时器、adapter dispose、fenceAllForQuit）仍留在本文件。
  registerChannelIpc(ipcMain, { channelManagementService, channelInboundService })

  // 模型服务 19 个 handler（含检测事件推送）在 ipc/modelIpc.ts；端口与其状态读法在 composition/model.ts。
  composeModelIpc(ipcMain, {
    providerStore,
    getPlatformFetch,
    getMainWindow,
    invalidateAgentModelCompatibilityCache,
    agentRuntimeProbeSnapshotStore,
    syncInUseModelPatrolScheduleFromState,
    inUseModelPatrol,
    providerRuntimeCheckService,
    assistantImageMessages,
    generatedImageStorage
  })

  // Web Search 8 个 handler 搬到 ipc/webIpc.ts；缓存 5 个已在 storageIpc 那一处接线。
  registerWebIpc(ipcMain, { webSearch: webSearchIpcHandlers })

  // 智能体会话/运行时 36 个 handler 搬到 ipc/agentIpc.ts。
  // 智能体会话/运行时 36 个 handler；广播通道与目标窗口都在 composition/agent.ts 里定。
  composeAgentIpc(ipcMain, {
    agentIpcHandlers,
    getState: () => agentStore.getState(),
    syncAfterMutation: (previousState) => syncAgentStateAfterMutation(previousState),
    replaceState: (state) => replaceAgentState(state),
    cancelMessage: (runId) => agentRuntimeService.cancelMessage(runId),
    getMainWindow
  })
  // 任务排程的 15 个 handler 仍由它自己的注册函数负责。
  registerAgentTaskIpcHandlers(ipcMain, agentIpcHandlers, {
    getScheduleValidationOptions: taskIpcScheduleValidationOptions,
    afterCommit: refreshTaskStateAfterCommit
  })

  // 智能体工具那一半 16 个 handler 搬到 ipc/agentToolsIpc.ts。
  // 智能体工具那一半 16 个 handler；MCP 刷新的「读→刷→写回」链在 composition/agentTools.ts 里拼。
  composeAgentToolsIpc(ipcMain, {
    agentIpcHandlers,
    getState: () => agentStore.getState(),
    skillService,
    skillSearchService,
    mcpRefreshDependencies: {
      getState: () => agentStore.getState(),
      refreshServerTools: mcpRuntimeService.refreshServerTools.bind(mcpRuntimeService),
      replaceAgentState
    },
    replaceAgentStateAfterSkillMutation
  })

  // 助手域 29 个 handler 搬到 ipc/assistantIpc.ts；流事件广播仍在上面那个构造里。
  registerAssistantIpc(ipcMain, {
    assistantIpcHandlers,
    getLanguage: async () => (await settingsStore.get()).language
  })

  // 通知运行时的端口在 composition 里定义；这里只给设置、时区、产品声明与日志出口。
  composeNotificationRuntimeForApp({ getSettings: settingsStore.get, timeZone: () => shellTimeZone.get(), manifests: productManifests, settingsStore, log: appLog })
  registerNotificationIpcHandlers()
  registerEventBusIpcHandlers()
  registerJobIpcHandlers(ipcMain, jobRunQueryService, jobScheduleQueryService)

  // 产品 IPC 统一入口：renderer 通过 preload.products.invoke 调用
  // 退出/重启期 DB 已关闭时返回结构化 `platform-unavailable`，不把 DB 异常变成 handler rejection。
  const invokeProductIpc = createProductIpcInvoker({
    registry: productIpcRegistry,
    isRuntimeClosed: () => platformRuntimesDisposed
  })
  ipcMain.handle(
    IpcChannels.productIpcInvoke,
    (_event: IpcMainInvokeEvent, productId: string, method: string, payload?: unknown) =>
      invokeProductIpc(productId, method, payload)
  )
}

async function readHeartbeatFileFromWorkspace(workspacePath: string): Promise<string | null> {
  const heartbeatPath = resolve(workspacePath, 'heartbeat.md')
  const normalizedWorkspacePath = resolve(workspacePath)
  if (!heartbeatPath.startsWith(`${normalizedWorkspacePath}/`) && heartbeatPath !== normalizedWorkspacePath) {
    return null
  }

  try {
    const content = await readFile(heartbeatPath, 'utf8')
    const trimmed = content.trim()
    return trimmed ? trimmed : null
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      return null
    }
    throw error
  }
}

async function createAndLoadMainWindow(): Promise<void> {
  await mainWindowHost.createAndLoad()
}

async function syncBuiltinSkills(): Promise<void> {
  let nextState = await agentStore.getState()
  for (const resourceSkillsRoot of getBuiltinSkillResourceRoots()) {
    nextState = await syncBuiltinSkillsFromResource({
      state: nextState,
      service: skillService,
      resourceSkillsRoot,
      appVersion: app.getVersion()
    })
  }
  await agentStore.replace(nextState)
}

function getBuiltinSkillResourceRoots(): string[] {
  return [
    join(app.getAppPath(), 'resources', 'skills'),
    join(process.resourcesPath, 'skills')
  ]
}

export async function bootstrapDesktopApp(options: DesktopAppBootstrapOptions = {}): Promise<void> {
  // PLAT-33：既有解析入口**逐字不动**（未命中 seam 时恒为原数组身份 ⇒ 生产零影响）；受控 fixture 清单
  // 只在 seam 命中时经纯函数追加（零长度短路 ⇒ 不复制数组）。
  const productManifests = appendWorkspaceTestFixtureManifests(
    resolveBootstrapProductManifests(options.productManifests ?? [], taskAutomationSmokeProfile.enabled),
    workspaceTestFixtures.productManifests
  )
  setInstalledProductManifestIds(productManifests.map((manifest) => manifest.id))
  assistantTemplateRegistry.clear()
  assistantTemplateRegistry.registerMany(platformAssistantTemplates)
  assistantTemplateRegistry.registerMany(createAssistantTemplateRegistrationsFromManifests(productManifests))
  productAgentToolRuntimeService.loadManifestRegistrations(productManifests)
  const gotLock = requestRuntimeSingleInstanceLock(productAcceptanceProfile.enabled)
  if (!gotLock) {
    app.quit()
    return
  }

  if (productAcceptanceProfile.enabled) app.setName(APP_ACCEPTANCE_NAME)
  registerProductIpcEventSender((productId, event, data) => {
    safeSendToMainWindow(getMainWindow, IpcChannels.productIpcEvent, { productId, event, data })
  })
  const productIpcRegistry = createProductIpcRegistry()
  setProductIpcRegistryForDisposal(productIpcRegistry)
  // 第一个真实通知来源：任务最终失败。装配在这，通知语义不进平台。
  const onRunTerminal = wireTaskFailureNotifier({
    submit: (request) => getNotificationRuntime().submit(request),
    listDefinitions: () => jobRuntime.listSchedules(),
    dayToken: (instant) => new Intl.DateTimeFormat('en-CA', { timeZone: shellTimeZone.get() }).format(new Date(instant))
  })
  const jobRuntime = createJobRuntime({ store: jobRunStore, onRunTerminal })
  setJobRuntimeForDisposal(jobRuntime)
  jobRuntime.recover()
  const jobRunQueryService = createJobRunQueryService({ runtime: jobRuntime })
  const jobScheduleQueryService = createJobScheduleQueryService({ runtime: jobRuntime })
  agentTaskJobBridge = createAgentTaskJobBridge({ jobRuntime })
  setAgentTaskRunController(createAgentTaskRunController({
    jobs: jobRunQueryService,
    jobRuntime
  }))
  /**
   * 内置 Agent / 会话文案的语言解析入口。
   *
   * 种子（平台 + 产品）是这些文案**唯一**的定义来源；SQLite 里那一行只是上一次解析的结果。
   * 字段仍等于任一语言原版（或为空）时换成当前语言，用户改过的字段保持原样 ⇒ 切语言不需要
   * 任何一次性迁移，切回去也能自动对齐。
   */
  const builtinSeedFactories = (options.productAgentSeedFactories ?? []).filter((factory) =>
    productManifests.some((manifest) => manifest.id === factory.productId)
  )
  const buildBuiltinSeedVariants = (providers: SafeModelProvider[]): BuiltinSeedLanguageVariant[] =>
    supportedLanguages.map((language) => ({
      language,
      seed: mergeAgentSeeds(
        createPlatformAgentSeed(providers, { locale: language }),
        ...builtinSeedFactories.map((factory) => factory.create(providers, { language }))
      )
    }))
  const refreshBuiltinSeedCopy = async (language: AppLanguage): Promise<void> => {
    const providers = await providerStore.list()
    const currentState = await agentStore.getState()
    const localizedState = localizeBuiltinSeedCopy(
      currentState,
      language,
      buildBuiltinSeedVariants(providers)
    )
    if (localizedState === currentState) return
    await replaceAgentState(localizedState)
  }
  registerIpcHandlers(
    productManifests,
    productIpcRegistry,
    jobRunQueryService,
    jobScheduleQueryService,
    refreshBuiltinSeedCopy
  )
  registerPlatformRetentionJobs({ jobRuntime, assistantDatabase, notificationRuntime: getNotificationRuntime(), timeZone: () => shellTimeZone.get() })

  // 开发期按「能力开」传死值：源码启动也能真查、真开下载页，否则没法联调。版本号 / 出网 / 时钟都在这里注入。
  const updateCheck = await composeUpdateCheck({
    ipcMain, mode: 'packaged', // DEV-GATE: 交付前必须改成 app.isPackaged ? 'packaged' : 'development'
    currentVersion: app.getVersion(), platform: process.platform,
    stateFilePath: join(platformDataDirectory, 'updates', 'state.json'), fetch: getPlatformFetch(),
    now: () => new Date(), isCheckEnabled: async () => (await settingsStore.get()).updates.checkEnabled,
    openExternal: (url) => shell.openExternal(url), log: appLog.log
  })

  if (!productAcceptanceProfile.enabled) app.on('second-instance', () => {
    const window = getMainWindow()
    if (!window) return
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  })

  await app.whenReady()
  appLog.log('info', 'app.ready')
  // 提供者默认拿运行时系统时区；显式设置的时区要在任何消费者构造之前解析一次。
  await shellTimeZone.refresh()
  // T1：`app-image://` 只读协议只在这里 handle 一次；scheme 已在模块加载时注册为特权 scheme。
  registerGeneratedImageProtocol(generatedImagesDirectory)

  /**
   * PLAT-26（D5 根因）：**先注册受控通道、再建窗**。`createMainWindow()` 只加载 about:blank，但 preload 已挂，
   * 任何在 `start()`（注册 + 恢复）之前被驱动的窗口都可能打出面板/`.tabs.*` 通道的 `No handler registered`。
   * 因此把「注册 handler」与「恢复布局」拆成两个入口：这里只注册（注册内容与准入链逐字不变），
   * 恢复仍由产品注册 seal 之后的 `start()` 单点执行。
   *
   * P1-06d：独立面板窗口宿主（P1-04）+ 窗口工厂接线。registry 必须是 compose 用的同一实例，
   * 否则宿主预留的窗口身份与 compose 的事务目标身份会分叉；宿主事件/原生关闭/外部销毁回流到 compose。
   */
  const workspaceWindowRegistry = createWorkspaceWindowRegistry()
  const workspaceRendererDevUrl = process.env.ELECTRON_RENDERER_URL
  const workspaceRendererRootUrl = pathToFileURL(join(__dirname, '../renderer')).toString()
  const workspaceDetachedEntryUrl = workspaceRendererDevUrl
    ?? pathToFileURL(join(__dirname, '../renderer/index.html')).toString()
  const workspaceDetachedDevOrigins = workspaceRendererDevUrl === undefined ? [] : [workspaceRendererDevUrl]
  // compose 建立之前宿主还没有事件接收方：先晚绑定，接线后原样转发（顺序与 app 启动顺序一致）
  let panelWorkspaceMainHostBridge: ReturnType<typeof composePanelWorkspace>['mainHostBridge'] = null
  const panelDetachedWindowFactory = createDetachedWindowFactory({
    appRoot: workspaceRendererRootUrl,
    entryUrl: workspaceDetachedEntryUrl,
    devOrigins: workspaceDetachedDevOrigins,
    // 外链出口与主窗同源：独立窗的 window.open 一律 deny，只有 http(s) 交给系统浏览器
    openExternal: (url) => void shell.openExternal(url),
    onNativeClose: (input) => { void panelWorkspaceMainHostBridge?.nativeClose(input).catch(() => undefined) },
    onWindowDestroyed: (input) => { void panelWorkspaceMainHostBridge?.windowDestroyed(input).catch(() => undefined) },
    // P1-06m：退出期标记注入 —— 退出期间 close 绝不 preventDefault（否则 app.quit() 被取消、主进程残留）
    isAppQuitting: () => quitOrchestrator.isQuitting()
  })
  const panelDetachedWindowHost = createPanelDetachedWindowHost({
    entryUrl: workspaceDetachedEntryUrl,
    appRoot: workspaceRendererRootUrl,
    devOrigins: workspaceDetachedDevOrigins,
    createWindow: panelDetachedWindowFactory,
    // 与主窗逐字段同源的安全基线：preload 用同一个路径，外链出口复用同一 shell.openExternal
    security: createSecureWindowSecurity({
      preload: join(__dirname, MAIN_WINDOW_PRELOAD_PATH),
      openExternal: (url) => void shell.openExternal(url)
    }),
    registry: workspaceWindowRegistry,
    // 显示器工作区只作安置策略输入（DIP）；不读 profile/userData，不上抛到 renderer
    displays: () => screen.getAllDisplays().map((display) => ({
      id: String(display.id), workArea: display.workArea, scaleFactor: display.scaleFactor
    })),
    timers: { schedule: (delayMs, run) => { const timer = setTimeout(run, delayMs); return () => clearTimeout(timer) } },
    onEvent: (event) => { panelWorkspaceMainHostBridge?.publishHostEvent(event) }
  })

  // workspace：registry/handlers 由产品清单登记表建立（注册内容与准入链不变）；受控通道在**建窗之前**注册，
  // 恢复（有界加载 + 迟到 CAS）仍只在产品注册 seal 之后的 `start()` 里发生一次。
  const panelWorkspace = composePanelWorkspace({
    productManifests,
    ipcMain,
    layoutFilePath: join(platformDataDirectory, 'workspace', 'panel-layout.json'),
    // P1-06d：registry 必须是宿主用的同一实例；注入含 requestDetach 的完整宿主 ⇒ compose 启用真实 detach 编排
    windowRegistry: workspaceWindowRegistry,
    detachedHost: panelDetachedWindowHost,
    sendToHost: (webContentsId, event) => {
      const target = BrowserWindow.getAllWindows().find((window) => !window.isDestroyed() && window.webContents.id === webContentsId)
      if (!target) return false
      target.webContents.send(IpcChannels.workspaceEvent, event)
      return true
    },
    preferences: {
      getLanguage: async () => (await settingsStore.get()).language,
      getTheme: () => readWorkspaceContextTheme(settingsStore, nativeTheme), // P1-06h N3：与 shell 同源（settings.themeMode），只有 system 才回退 OS
      // 显示时区与 shell 同源（settings.timeZone），只有 system 才回退运行时 IANA 时区
      // 运行时 IANA 时区只在 shellTimeZone 提供者内部读取；这里只取它解析好的结果
      getTimeZone: () => readWorkspaceContextTimeZone(settingsStore, { timeZone: shellTimeZone.get() })
    }
  })
  // 宿主事件/原生关闭/外部销毁的接收方现在才存在：接线后所有宿主回调都回流到 compose
  panelWorkspaceMainHostBridge = panelWorkspace.mainHostBridge
  // PLAT-26：只注册（幂等，不恢复）——7 条受控通道此刻已在 ipcMain 上，随后创建的窗口一被驱动就有 handler
  panelWorkspace.registerChannels()

  await mainWindowHost.createAndWire()
  tray = createAppTray(getMainWindow)
  await applySessionProxySettings((await settingsStore.get()).network, {
    // 历史遗留的坏地址只可能是旧版本存进去的：退回直连，但要在日志里留一句，不许无声。
    onRejectedProxyConfig: (reason) => appLog.log('warn', 'app.proxy.invalid-config', { reason })
  })

  const productBootstrap = await runProductBootstrap({
      registerProductServices: taskAutomationSmokeProfile.enabled ? undefined : async () => options.registerProductServices?.({
              register: productIpcRegistry.register,
              jobRuntime,
              eventBusRuntime: getEventBusRuntime(),
              getProviderState: providerStore.getState,
              getAppLanguage: async () => {
                const settings = await settingsStore.get()
                return settings.language
              },
              getModelDefaults: async () => (await settingsStore.get()).modelDefaults,
              getNetworkSettings: async () => {
                const settings = await settingsStore.get()
                return settings.network
              },
              // 产品侧的「读者时区」也取自同一个提供者：日报的今天、日历月份都跟设置走。
              getTimeZone: () => shellTimeZone.get(),
              onSettingsCommitted: settingsStore.onCommitted,
              platformFetch: getPlatformFetch(),
              secretVault: providerSecretVault,
              registerProductAgentToolHandler,
              registerProductCache,
              registerProductDisposer: productServiceDisposerRegistry.register,
              getAgentState: () => agentStore.getState(),
              createAgentSession: (input) => agentServices.sessions.create(input),
              sendAgentMessage: (request) => agentRuntimeService.sendMessage(request),
              cancelAgentSession: (sessionId) => { agentRuntimeService.cancelSession(sessionId, { kind: 'runtime-stop', message: 'daily-brief-deadline' }) },
              appendAgentSessionMessages: (input) => agentServices.messages.saveMessages(input),
              updateAgentSession: (sessionId, patch) => agentServices.sessions.update(sessionId, patch),
              deleteAgentSessions: (sessionIds: string[]) => agentServices.sessions.deleteByIds(sessionIds),
              updateAgent: (agentId: string, patch) => agentServices.agents.update(agentId, patch),
              isWebSearchProviderReady: isAgentWebSearchProviderReady,
              invokeProductAgentTool: (state, input) => productAgentToolRuntimeService.invokeTool(state, input),
              invokeProductIpc: (productId, method, payload) => productIpcRegistry.invoke(productId, method, payload),
            }),
      sealIpcSurface: () => productIpcRegistry.seal(expectedProductIpcMethods(productManifests)),
      reportAcceptance: productAcceptanceProfile.enabled
        ? (methods) => reportProductAcceptanceRegistration({ productIds: productManifests.map((manifest) => manifest.id), productIpcMethodCount: methods.length })
        : undefined
    },
    { log: appLog, markUnavailable: () => productIpcRegistry.markUnavailable() })
  if (productBootstrap.ok === false) {
    const window = getMainWindow()
    if (window) showBootFailurePage(window, productBootstrap.failure)
    return
  }

  reportPanelWorkspaceStart({ report: await panelWorkspace.start() }) // P1-06h N4：恢复/降级原因必须运行期可观测，启动顺序与 fail-closed 语义不变
  setPanelWorkspaceForDisposal(panelWorkspace)
  /**
   * PLAT-32/S1（PM 裁决②）：OS 外观变化与「设置写入」走**同一条显式通知**。`themeMode==='system'` 时
   * `context.theme` 由 `nativeTheme.shouldUseDarkColors` 解析，用户在系统里切深浅色必须让已分离的页窗/面板窗
   * 跟随（旧实现只是在下一次任意窗口成功读取时顺带转发 ⇒ 读带副作用的副产物）；这里显式通知一次，
   * 通知本身不承载值、绝不 reject，且与设置写入共用同一对账入口（有界、主窗 0 条、无自持环）。
   */
  nativeTheme.on('updated', () => { void getPanelWorkspaceForDisposal()?.notifyPreferencesChanged() })
  // 主窗登记要早于 renderer 加载：首个 getHostContext 不能因为未登记而被拒
  const workspaceMainWindow = getMainWindow()
  if (workspaceMainWindow) {
    panelWorkspace.registerMainWindow({ webContentsId: workspaceMainWindow.webContents.id })
  }

  await ensureDefaultAssistantSeed()
  assistantChatRuntime.reconcileStalePending()
  await syncBuiltinSkills()
  const providers = await providerStore.list()
  const language = (await settingsStore.get()).language
  const productSeed = mergeAgentSeeds(
    ...builtinSeedFactories.map((factory) => factory.create(providers, { language }))
  )
  const seededState = mergeAgentStoreSeeds(await agentStore.getState(), productSeed)
  await replaceAgentState(
    reconcileStalePendingMessages(
      localizeBuiltinSeedCopy(seededState, language, buildBuiltinSeedVariants(providers))
    )
  )
  await getAgentTaskExecutionCoordinatorOrNull()?.recoverAfterRestart()
  await channelManagementService.recover()
  for (const { channelId, generation, token } of channelManagementRepository.activeRuntimeChannels(new Date().toISOString())) {
    const type = channelManagementRepository.channelType(channelId)
    // A persisted active row never bypasses the registry when another adapter has evidence.
    if (!type || !channelAdapterRegistry.canEnable(type)) {
      channelManagementRepository.disableRuntimeGeneration(channelId, generation, new Date().toISOString())
      if (type === 'slack') slackRuntimeRepository.auditBootstrapFenced(channelId, 'slack-runtime-evidence-missing')
      // Lark's audit gate is intentionally active-generation-only; after fencing this transition has no runtime audit.
      else if (type === 'telegram') telegramOffsetRepository.auditBootstrapFenced(channelId, 'telegram-runtime-evidence-missing')
      continue
    }
    const started = type === 'slack'
      ? await slackRuntimeManager.start(channelId, generation, token)
      : type === 'feishu'
        ? await larkRuntimeManager.start(channelId, generation, token)
        : type === 'qq'
          ? await qqRuntimeManager.start(channelId, generation, token)
          : type === 'discord'
            ? await discordRuntimeManager.start(channelId, generation, token)
            : type === 'wechat'
              ? await wechatRuntimeManager.start(channelId, generation, token)
            : await telegramRuntimeManager.start(channelId, generation, token)
    if (!started) {
      channelManagementRepository.disableRuntimeGeneration(channelId, generation, new Date().toISOString())
      if (type === 'slack') slackRuntimeRepository.auditBootstrapFenced(channelId, 'slack-runtime-start-failed')
      // The Lark current-generation gate rejects post-fence writes, preserving delete/runtime isolation.
      else if (type === 'feishu') void 0
      else if (type === 'qq') void 0
      else telegramOffsetRepository.auditBootstrapFenced(channelId, 'telegram-runtime-start-failed')
    }
  }
  await channelManagementService.resumeRequested()
  taskAutomationMaintenance.recoverAfterRestart()
  setDisposeTaskAutomationMaintenance(scheduleTaskAutomationMaintenance(taskAutomationMaintenance))
  setDisposeJobRunRetention(scheduleJobRunRetention(jobRunStore))
  registerInUseModelPatrolHandler(jobRuntime, { patrol: inUseModelPatrol })
  await syncInUseModelPatrolSchedule(jobRuntime, {
    isReady: async () => {
      const providers = (await providerStore.getState()).providers
      return providers.some((provider) => provider.enabled && Boolean(provider.apiKeyRef))
    }
  })
  const channelMaintenanceJobDeps = {
    deliveryCleanup: () => channelDeliveryMaintenance.runSlice(),
    deliveryRetry: () => channelDeliveryMaintenance.runRetrySlice(),
    inboundRecovery: () => channelInboundExecutionRunner.recoverOnce(),
    adapterMaintenance: {
      telegram: () => telegramRuntimeMaintenance.runOnce(),
      slack: () => slackRuntimeMaintenance.runOnce(),
      lark: () => larkRuntimeMaintenance.runOnce(),
      qq: () => qqRuntimeMaintenance.runOnce(),
      discord: () => discordRuntimeMaintenance.runOnce(),
      wechat: () => wechatRuntimeMaintenance.runOnce()
    }
  }
  registerChannelMaintenanceJobHandlers(jobRuntime, channelMaintenanceJobDeps)
  setDisposeChannelMaintenanceJobs(scheduleChannelMaintenanceJobs(jobRuntime, channelMaintenanceJobDeps))
  syncProductToolsRuntimeFromState(await agentStore.getState())
  mcpRuntimeService.syncFromState(await agentStore.getState())
  agentTaskSchedulerRuntimeService.syncFromState(await agentStore.getState())
  agentTaskSchedulerRuntimeService.start()
  agentRuntimeService.subscribe((snapshot) => {
    agentBroadcasts.runtimeStateChanged(snapshot)
  })
  buildAppMenu(getMainWindow)
  await mainWindowHost.loadAndMount()

  // 自动检查：主界面出来之后才排，一次性、延迟 15 秒；闸门与静默都在服务里。
  updateCheck.startAutomaticCheck()

  // 挂载：退订旧 listener → 直发 current snapshot → 续增量（Main 侧顺序由 router 保证）
  if (workspaceMainWindow) {
    panelWorkspace.attachMainWindow({ webContentsId: workspaceMainWindow.webContents.id })
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createAndLoadMainWindow()
    } else {
      getMainWindow()?.show()
    }
  })
}

/**
 * P1-06m 退出编排（真机 P1-07R 阻塞项：已提交独立窗存在时优雅退出无法完成）。
 *
 * 单点：`before-quit` 先置退出期标记（派生窗 close 从此不再 preventDefault），再**挂起本轮退出**直到
 * `disposePlatformRuntimes()` 落定（其中有界 flush 待写布局 + 撤销 owner + 销毁全部派生窗），最后放行一次
 * `app.quit()` —— 此刻已无窗口可关，退出必然完成，绝不残留主进程。
 * `window-all-closed` 不再自己发起清理（那会让两条链并发、退出可能早于 flush），只负责非 darwin 的托盘收尾。
 * 有界逃逸：清理再慢也最多挂起 `QUIT_DISPOSE_BUDGET_MS`，绝不因为某个消费者挂住就永远退不出去。
 */
const quitOrchestrator = createQuitOrchestrator({ dispose: disposePlatformRuntimes, quit: () => app.quit() })
app.on('before-quit', (event) => quitOrchestrator.handleBeforeQuit(event))

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    tray?.destroy()
    tray = null
    // 只发起退出：清理编排归 before-quit 单点（并发两条链会让进程早于 flush 退出）
    app.quit()
  }
})

/**
 * P1-06m：`SIGTERM`/`SIGINT` 也走同一条优雅退出编排。
 * Electron 的信号默认路径不保证经过 `before-quit`，跳过它就等于跳过退出 flush 与派生窗销毁
 * （真机 P1-07R `82-a-p06-sigterm-flush.json`：变更后立即退出，文档仍是旧值、savedAt 未变）。
 * 有界：`before-quit` 的 `QUIT_DISPOSE_BUDGET_MS` 逃逸仍然兜底，绝不因为清理挂住而拒绝退出；
 * 原本的 Node 默认「立即终止」语义只在清理异常时被这 15s 上界替代。
 */
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => { app.quit() })
}
