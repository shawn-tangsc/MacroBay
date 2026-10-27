import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, protocol, safeStorage, shell, type IpcMainInvokeEvent, type OpenDialogOptions, type Tray } from 'electron'
import { mkdirSync } from 'node:fs'
import { open, readFile, stat, writeFile } from 'node:fs/promises'
import { release } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

import type { AgentChatRuntimeRequest } from '../../ai/agent-platform/runtime/agentChatRuntime'
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
  ChannelInboundExecutionCoordinator,
  ChannelDispatchRunRepository,
  ChannelInboundExecutionRunner,
  ChannelInboundRepository,
  ChannelInboundService,
  ChannelDeliveryMaintenance,
  ChannelDeliveryRepository,
  ChannelDeliveryService,
  ChannelAdapterAcceptanceRegistry,
  ChannelAcceptanceService,
  ChannelManagementRepository,
  ChannelManagementService,
  ChannelSecureHandoff,
  TelegramOffsetRepository,
  TelegramDeliveryTransport,
  TelegramRuntimeManager,
  TelegramRuntimeMaintenance,
  SlackRuntimeRepository,
  SlackDeliveryTransport,
  SlackRuntimeManager,
  SlackRuntimeMaintenance,
  LarkRuntimeRepository,
  LarkDeliveryTransport,
  LarkRuntimeManager,
  LarkRuntimeMaintenance,
  QqRuntimeRepository,
  QqDeliveryTransport,
  QqRuntimeManager,
  QqRuntimeMaintenance,
  DiscordRuntimeRepository,
  DiscordDeliveryTransport,
  DiscordRuntimeManager,
  DiscordRuntimeMaintenance,
  WechatEnrollmentRepository,
  WechatRuntimeRepository,
  WechatDeliveryTransport,
  WechatRuntimeManager,
  WechatRuntimeMaintenance,
  ChannelDeliveryTransportRouter,
  ChannelRuntimeSupervisor
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
import { AssistantProgrammaticInvocationService } from '../../ai/assistant-platform/invocation/AssistantProgrammaticInvocationService'
import { platformAssistantTemplates } from '../../ai/assistant-platform/library/platformAssistantTemplates'
import { createAssistantTemplateRegistrationsFromManifests } from '../../ai/assistant-platform/library/assistantTemplateManifestAdapter'
import { AssistantTopicNamingService } from '../../ai/assistant-platform/naming/AssistantTopicNamingService'
import {
  buildDefaultAssistantLocalizationPatch,
  createDefaultAssistantSeed
} from '../../ai/assistant-platform/seeds/defaultAssistantSeed'
import { getPlatformFetch } from '../../network/platformFetch'
import { createPlatformWebSocketFactory } from '../../network/platformWebSocket'
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
import type { AgentSessionEntity, CreateAgentSessionDto } from '../../ai/agent-platform/schemas/sessionSchemas'
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
import { createSettingsStore } from '../../settings/store/settingsStore'
import { applySessionProxySettings } from '../../network/applySessionProxySettings'
import { createJsonFileStorage } from '../../storage/jsonFileStorage'
import { IpcChannels } from '../ipc/channels'
import { assertBoolean } from '../../ai/agent-platform/channels/ChannelManagementContracts'
import { createProductIpcRegistry, type ProductIpcMethod } from '../ipc/productIpcRegistry'
import { registerProductIpcEventSender } from '../ipc/productIpcEventBridge'
import { createJobRunQueryService, createJobRunSqliteStore, createJobRuntime, createJobScheduleQueryService, scheduleJobRunRetention, type JobRuntime } from '../../jobs'
import { registerNotificationIpcHandlers } from '../../notifications/ipc/notificationIpcHandlers'
import { configureNotificationRuntime } from '../../notifications/ipc/registerNotificationIpc'
import { registerEventBusIpcHandlers } from '../../message-bus/ipc/eventBusIpcHandlers'
import { getEventBusRuntime } from '../../message-bus/ipc/registerEventBusIpc'
import { buildAppMenu } from '../menu/appMenu'
import { createAppTray } from '../tray/appTray'
import { createMainWindow, loadMainWindowRenderer } from '../window/createMainWindow'
import { wireRendererProcessDiagnostics } from '../window/rendererProcessDiagnostics'
import { createRendererProcessLog } from '../window/rendererProcessLog'
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
import { refreshAgentMcpTools } from './agentMcpRefresh'
import { createMcpRuntimeServerHostFactory } from './mcpRuntimeServerHostFactory'
import { createSkillRuntimeCapabilityResolver, createSkillRuntimeToolsResolver } from './skillRuntimeCapabilities'
import { createSkillRuntimeToolHost } from './skillRuntimeToolHost'
import { persistSkillRowChanges } from './skillRowPersistence'
import { createTaskChannelDelivery } from './taskChannelDelivery'
import { createTaskAutomationMaintenance } from './taskAutomationMaintenance'
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
import {
  clampWindowSizeToMinimum,
  DEFAULT_MIN_WINDOW_HEIGHT,
  DEFAULT_MIN_WINDOW_WIDTH
} from '../../ui/window/windowSizing'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let agentTaskJobBridge: ReturnType<typeof createAgentTaskJobBridge> | null = null
let agentTaskExecutionCoordinator: AgentTaskExecutionCoordinator | null = null
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
const platformDataDirectory = join(app.getPath('userData'), 'platform')
mkdirSync(platformDataDirectory, { recursive: true })
const settingsStore = createSettingsStore(
  createJsonFileStorage(join(app.getPath('userData'), 'platform', 'settings.json'), createDefaultAppSettings())
)
const providerSecretVault = createElectronSecretVault({
  directory: join(app.getPath('userData'), 'platform', 'secrets'),
  safeStorage
})
// PLAT-72：供应商/模型改为 SQLite 行级存储；旧的 `platform/model-providers.json` 已废弃，
// 代码不再读取、不删除、不改名 —— 原样留在磁盘上作为用户的备份（用户按需自行清理）。
const providerStore = createProviderStore(
  createProviderSqliteStorage({ path: join(app.getPath('userData'), 'platform', 'model-providers.sqlite') }),
  providerSecretVault
)
const rendererProcessLog = createRendererProcessLog(
  join(app.getPath('userData'), 'platform', 'logs', 'renderer-lifecycle.ndjson')
)

/** 运行时 IANA 时区（设置项 `system` 的解析输入）；解析不出时由调用方回落到 `fallbackTimeZone`。 */
function systemTimeZoneSource(): { timeZone: string } {
  return { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }
}

function taskIpcScheduleValidationOptions(): { now: Date; defaultTimezone: string } {
  return {
    now: new Date(),
    defaultTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  }
}

// Channel management re-validates every field at its own contract boundary, so the
// IPC layer only proves that the payload is a plain object before handing it over.
function asChannelInput(input: unknown): any {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.getPrototypeOf(input) !== Object.prototype) {
    throw new Error('channel-input-invalid')
  }
  return input
}

function asChannelHandoff(value: unknown): { sessionId: string; rendererPublicJwk: JsonWebKey; iv: Uint8Array; ciphertext: Uint8Array } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('channel-handoff-invalid')
  const handoff = value as Record<string, unknown>
  if (
    typeof handoff.sessionId !== 'string' ||
    !handoff.sessionId.trim() ||
    handoff.sessionId.length > 128 ||
    !isP256PublicJwk(handoff.rendererPublicJwk) ||
    !(handoff.iv instanceof Uint8Array) ||
    !(handoff.ciphertext instanceof Uint8Array)
  ) throw new Error('channel-handoff-invalid')
  return { sessionId: handoff.sessionId, rendererPublicJwk: handoff.rendererPublicJwk as JsonWebKey, iv: handoff.iv, ciphertext: handoff.ciphertext }
}

/**
 * T1–T3：图像通道的 additive 参数（`operation` / `topicId` / `sourceImage`）。
 * 只做形状归一，不做业务校验（校验在 providerImageGeneration / providerImageEdit 里）。
 */
function readProviderImageChannelRequest(input: unknown): {
  operation: 'generate' | 'edit'
  topicId: string
} {
  const record = (input ?? {}) as Record<string, unknown>
  return {
    operation: record.operation === 'edit' ? 'edit' : 'generate',
    topicId: typeof record.topicId === 'string' ? record.topicId.trim() : ''
  }
}

function isP256PublicJwk(value: unknown): value is JsonWebKey {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return false
  const jwk = value as Record<string, unknown>
  return jwk.kty === 'EC' && jwk.crv === 'P-256' && typeof jwk.x === 'string' && jwk.x.length <= 128 && typeof jwk.y === 'string' && jwk.y.length <= 128
}

async function refreshTaskStateAfterCommit(): Promise<void> {
  const state = await agentServices.state.getState()
  agentTaskSchedulerRuntimeService.syncFromState(state)
  getMainWindow()?.webContents.send(IpcChannels.agentsStateChanged, state)
}
const webSearchCredentialStore = createWebSearchCredentialStore(
  createJsonFileStorage(join(app.getPath('userData'), 'platform', 'web-search-credentials.json'), { providers: {} })
)
const legacyAgentStorage = createJsonFileStorage<AgentStoreState>(
  join(app.getPath('userData'), 'platform', 'agents.json'),
  createDefaultAgentPersistentState()
)
const agentDatabase = createAgentPlatformDatabase(join(app.getPath('userData'), 'platform', 'agents.sqlite'))
const assistantDatabase = createAssistantPlatformDatabase(join(app.getPath('userData'), 'platform', 'assistants.sqlite'))
const agentRepositories = createAgentPlatformRepositories(agentDatabase)
const assistantRepositories = createAssistantPlatformRepositories(assistantDatabase)
/**
 * T1/T2：生成图片落 `userData/generated-images/`（文件名 = 内容 hash），消息只存引用；
 * 渲染层通过 `app-image://generated-images/<hash>.<ext>` 读图（协议见 generatedImageProtocol.ts）。
 */
const generatedImagesDirectory = join(app.getPath('userData'), 'generated-images')
const generatedImageStorage = createGeneratedImageStorage({ directory: generatedImagesDirectory })
const assistantImageMessages = createAssistantImageMessageService({
  repositories: assistantRepositories,
  storage: generatedImageStorage
})
// 特权 scheme 必须在 app ready 之前注册（window 创建后只做 protocol.handle）。
registerGeneratedImageScheme()
const channelInboundRepository = new ChannelInboundRepository(agentDatabase)
const channelDeliveryRepository = new ChannelDeliveryRepository(agentDatabase)
const channelManagementRepository = new ChannelManagementRepository(agentDatabase)
const channelAdapterRegistry = new ChannelAdapterAcceptanceRegistry()
const channelAcceptance = new ChannelAcceptanceService(agentDatabase)
channelAcceptance.load(channelAdapterRegistry)
const telegramOffsetRepository = new TelegramOffsetRepository(agentDatabase)
const slackRuntimeRepository = new SlackRuntimeRepository(agentDatabase)
const larkRuntimeRepository = new LarkRuntimeRepository(agentDatabase)
const qqRuntimeRepository = new QqRuntimeRepository(agentDatabase)
const discordRuntimeRepository = new DiscordRuntimeRepository(agentDatabase)
const wechatEnrollmentRepository = new WechatEnrollmentRepository(agentDatabase)
const wechatRuntimeRepository = new WechatRuntimeRepository(agentDatabase)
const jobRunStore = createJobRunSqliteStore(join(app.getPath('userData'), 'platform', 'jobs.sqlite'))
const channelCredentialVault = createElectronChannelCredentialVault({
  directory: join(app.getPath('userData'), 'platform', 'channel-secrets'),
  safeStorage
})
const channelManagementService = new ChannelManagementService({
  repository: channelManagementRepository,
  vault: channelCredentialVault,
  cipher: channelCredentialVault.payloadCipher,
  registry: channelAdapterRegistry,
  acceptance: channelAcceptance,
  handoff: new ChannelSecureHandoff()
})
const agentStore = createAgentSqliteStoreWithOptions(
  agentDatabase,
  taskAutomationSmokeProfile.enabled
    ? createTaskAutomationSmokeSeed('2026-07-17T00:00:00.000Z')
    : workspaceTestFixtures.enabled
      /* PLAT-33：只在 seam 命中时换上受控 agent/session 种子（受控流源桩需要归属）。 */
      ? createWorkspaceTestFixtureAgentSeed('2026-10-06T00:00:00.000Z')
      : createDefaultAgentPersistentState(),
  {
    legacyStateLoader: () => legacyAgentStorage.read()
  }
)
const agentServices = createAgentPlatformServices(agentStore, {
  taskAutomation: {
    getPolicyPreset: async () => (await settingsStore.get()).agent.taskAutomation.policyPreset,
    setPolicyPreset: async (policyPreset) => {
      await settingsStore.update({
        agent: {
          taskAutomation: { policyPreset }
        }
      })
    },
    hasEnabledDeliveryTarget: (channelId, agentId) => channelDeliveryRepository.hasEnabledTarget(channelId, agentId)
  },
  queries: {
    agents: {
      get: agentRepositories.agents.get,
      list: agentRepositories.agents.list
    },
    workspaces: {
      list: agentRepositories.workspaces.list,
      getById: agentRepositories.workspaces.getById,
      findByPath: agentRepositories.workspaces.findByPath
    },
    sessions: agentRepositories.sessions,
    messages: agentRepositories.messages,
    tasks: {
      get: agentRepositories.tasks.get,
      list: agentRepositories.tasks.list,
      listPage: agentRepositories.tasks.listPage,
      listLogs: agentRepositories.taskRunLogs.list,
      upsertLog: agentRepositories.taskRunLogs.upsert
    },
    taskRunLogs: {
      get: agentRepositories.taskRunLogs.get,
      getOwnerForTask: agentRepositories.taskRunLogs.getOwnerForTask
    },
    channelDeliveryAttempts: {
      listTaskAttempts: channelDeliveryRepository.listTaskAttempts.bind(channelDeliveryRepository)
    },
    channelDeliveryTargets: {
      hasEnabledTarget: channelDeliveryRepository.hasEnabledTarget.bind(channelDeliveryRepository)
    },
    taskMutationAudits: {
      listByTask: agentRepositories.taskMutationAudits.listByTask,
      listByAgent: agentRepositories.taskMutationAudits.listByAgent
    },
    channels: {
      list: agentRepositories.channels.list,
      findBySessionId: agentRepositories.channels.findBySessionId,
      listByTaskId: (taskId: string) => {
        const channelIds = new Set(
          agentRepositories.channelTaskSubscriptions.listByTaskId(taskId).map((item) => item.channelId)
        )
        return agentRepositories.channels.listAll().filter((channel) => channelIds.has(channel.id))
      },
      listTaskIdsByChannelId: (channelId: string) =>
        agentRepositories.channelTaskSubscriptions.listByChannelId(channelId).map((item) => item.taskId),
      upsert: agentRepositories.channels.upsert,
      delete: agentRepositories.channels.delete,
      replaceSubscriptionsForTask: agentRepositories.channelTaskSubscriptions.replaceForTask
    }
  }
})
const skillsRoot = join(app.getPath('userData'), 'platform', 'agents', 'Skills')
const skillRuntimeCapabilityResolver = createSkillRuntimeCapabilityResolver({
  skillsRoot
})
const skillRuntimeToolsResolver = createSkillRuntimeToolsResolver({
  skillsRoot
})
const skillService = createSkillService({
  paths: {
    skillsRoot,
    installTempRoot: join(app.getPath('temp'), 'ai-desktop-platform', 'skill-install')
  },
  queries: {
    list: agentRepositories.skills.list
  }
})
const skillSearchService = createSkillSearchService()
const TEXT_FILE_READ_LIMIT_BYTES = 128 * 1024
const agentSystemWorkspacesRoot = join(app.getPath('userData'), 'platform', 'agents', 'workspaces')
const runtimeDriverRegistry = new RuntimeDriverRegistry()
const toolApprovalRegistry = new ToolApprovalRegistry()
const toolRegistry = new ToolRegistry()
let installedProductManifestIds: string[] = []
const productAgentToolRegistry = new ProductAgentToolRegistry()
const productAgentToolRuntimeService = new ProductAgentToolRuntimeService({
  registry: productAgentToolRegistry,
  toolRegistry,
  traceRepository: createSqliteProductAgentToolTraceRepository(agentDatabase),
  installedProductIds: () => installedProductManifestIds
})
function registerProductAgentToolHandler(registration: ProductAgentToolHandlerRegistration): void {
  productAgentToolRegistry.registerHandler(registration)
}
const mcpRuntimeService = new McpRuntimeService({
  toolRegistry,
  createServerHost: createMcpRuntimeServerHostFactory({}),
  onServerToolsChanged: async (serverId) => {
    try {
      await refreshAgentMcpTools(
        {
          getState: () => agentStore.getState(),
          refreshServerTools: mcpRuntimeService.refreshServerTools.bind(mcpRuntimeService),
          replaceAgentState
        },
        serverId
      )
    } catch {
      // Keep the last written runtime status/tool catalog; renderer refresh affordances can retry explicitly.
    }
  }
})
const skillsRuntimeService = new SkillsRuntimeService({
  toolRegistry,
  getSkillTools: skillRuntimeToolsResolver,
  getSkillCapabilities: skillRuntimeCapabilityResolver,
  invokeSkillTool: createSkillRuntimeToolHost({
    skillsRoot,
    resolveCapabilities: skillRuntimeCapabilityResolver
  })
})
const taskManagementToolRuntimeService = new TaskManagementToolRuntimeService({
  store: agentStore,
  commands: agentServices.taskCommands,
  runTask: (input) => agentTaskExecutionCoordinator!.enqueueManualRun(input)
    .then((runLog) => ({ taskId: input.taskId, runLogId: runLog.id }))
})
const agentRuntimeCompositionService = new AgentRuntimeCompositionService({
  toolRegistry,
  mcpRuntime: mcpRuntimeService,
  skillsRuntime: skillsRuntimeService,
  productToolsRuntime: productAgentToolRuntimeService,
  taskManagementRuntime: taskManagementToolRuntimeService,
  resolveEffectiveModel: (agent) =>
    resolveEffectiveAgentModel({
      agent,
      getProviderState: providerStore.getState,
      getConfiguredDefaultModelId: async () => (await settingsStore.get()).modelDefaults.agentModelId
    })
})
const agentRuntimeService = new AgentSessionRuntimeService({
  getAgentState: () => agentStore.getState(),
  driverRegistry: runtimeDriverRegistry,
  compositionService: agentRuntimeCompositionService,
  toolApprovalRegistry,
  traceRecorder: createAgentRuntimeConsoleTraceRecorder()
})
let platformRuntimesDisposed = false
/**
 * P1-06m 退出期编排状态（真机 P1-07R runG/runI：已提交独立窗存在时优雅退出无法完成，窗口全销毁但主进程残留）：
 * - `appQuitting`：app 级退出期标记，`before-quit` 置位。派生窗工厂据此在退出期**不再** preventDefault
 *   （否则 Electron 的退出关窗相位被取消 ⇒ 进程残留）；退出期的派生窗销毁由宿主 `appExit` 统一执行。
 * - `quitDisposeStarted`：本轮退出的有界清理是否已启动（重复 `before-quit` 绝不并发第二条清理链）。
 * - `quitDisposeSettled`：清理已结束，退出可以真正放行（第二次 `app.quit()` 不再挂起）。
 */
let appQuitting = false
let quitDisposeStarted = false
let quitDisposeSettled = false
/** 退出清理挂起本轮退出的上界：清理再慢也绝不让进程永远退不出去（有界逃逸）。 */
const QUIT_DISPOSE_BUDGET_MS = 15_000
let jobRuntimeForDisposal: JobRuntime | null = null
/** workspace 组合体：只在产品注册 seal 之后建立，用于退出时的有界布局 flush。 */
let panelWorkspaceForDisposal: ReturnType<typeof composePanelWorkspace> | null = null
let disposeTaskAutomationMaintenance: (() => void) | null = null
let disposeJobRunRetention: (() => void) | null = null
let disposeChannelDeliveryMaintenance: (() => void) | null = null
let disposeChannelInboundRecovery: (() => void) | null = null
let disposeTelegramRuntimeMaintenance: (() => void) | null = null
let disposeSlackRuntimeMaintenance: (() => void) | null = null
let disposeLarkRuntimeMaintenance: (() => void) | null = null
let disposeQqRuntimeMaintenance: (() => void) | null = null
let disposeDiscordRuntimeMaintenance: (() => void) | null = null
let disposeWechatRuntimeMaintenance: (() => void) | null = null
/**
 * P1-06m：退出第一件事 —— 把 debounce（250ms）窗口内的待写布局**有界落盘**并记录结果。
 * 放在所有其它清理之前：后续清理可能很慢甚至挂住，绝不让它吃掉退出前最后一次布局变更。
 * 组合体尚未建立（禁用态/启动早期）时直接跳过：没有工作区就没有待写可谈。
 */
async function flushPanelWorkspaceLayoutForExit(): Promise<void> {
  if (panelWorkspaceForDisposal === null) return
  // 绝不抛：flushLayout 内部已把异常收敛成 failed，这里只负责把受控报告落日志
  reportPanelWorkspaceFlush({ report: await panelWorkspaceForDisposal.flushLayout() })
}
async function disposePlatformRuntimes(): Promise<void> {
  if (platformRuntimesDisposed) return
  platformRuntimesDisposed = true
  await flushPanelWorkspaceLayoutForExit()
  disposeTaskAutomationMaintenance?.()
  disposeTaskAutomationMaintenance = null
  disposeJobRunRetention?.()
  disposeJobRunRetention = null
  disposeChannelDeliveryMaintenance?.()
  disposeChannelDeliveryMaintenance = null
  disposeChannelInboundRecovery?.()
  disposeChannelInboundRecovery = null
  disposeTelegramRuntimeMaintenance?.()
  disposeTelegramRuntimeMaintenance = null
  disposeSlackRuntimeMaintenance?.()
  disposeSlackRuntimeMaintenance = null
  disposeLarkRuntimeMaintenance?.()
  disposeLarkRuntimeMaintenance = null
  disposeQqRuntimeMaintenance?.()
  disposeQqRuntimeMaintenance = null
  disposeDiscordRuntimeMaintenance?.()
  disposeDiscordRuntimeMaintenance = null
  disposeWechatRuntimeMaintenance?.()
  disposeWechatRuntimeMaintenance = null
  // Abort every adapter lifetime before the shared SQLite fence closes all owners.
  await telegramRuntimeManager.dispose()
  await slackRuntimeManager.dispose()
  await larkRuntimeManager.dispose()
  await qqRuntimeManager.dispose()
  await discordRuntimeManager.dispose()
  await wechatRuntimeManager.dispose()
  channelManagementRepository.fenceAllForQuit(new Date().toISOString())
  agentTaskSchedulerRuntimeService.stop()
  jobRuntimeForDisposal?.stopAll()
  await productServiceDisposerRegistry.disposeAll()
  await Promise.allSettled([
    agentRuntimeService.dispose(),
    mcpRuntimeService.dispose()
  ])
  // workspace：有界 flush 后释放路由目标；flush 超时/失败只如实上报，不阻断其余清理。
  // P1-06m：dispose 报告必须落日志（含「退出瞬间是否仍有待写」与销毁窗数/撤销 owner 数），绝不静默丢弃。
  const workspaceDisposeReport = await panelWorkspaceForDisposal?.dispose()
  if (workspaceDisposeReport !== undefined) reportPanelWorkspaceDispose({ report: workspaceDisposeReport })
  panelWorkspaceForDisposal = null
  jobRunStore.close()
}
function broadcastChannelRuntimeSnapshot(snapshot: ReturnType<ChannelRuntimeSupervisor['snapshot']>): void {
  getMainWindow()?.webContents.send(IpcChannels.agentsChannelRuntimeStateChanged, snapshot)
}
const channelRuntimeSupervisor = new ChannelRuntimeSupervisor({
  query: channelManagementRepository.query,
  restart: async (channelId) => {
    await channelManagementService.restart({ id: channelId, actorId: 'agent-runtime-ui' })
    broadcastChannelRuntimeSnapshot(channelRuntimeSupervisor.snapshot())
  }
})
const telegramDeliveryTransport = new TelegramDeliveryTransport()
const slackDeliveryTransport = new SlackDeliveryTransport()
const larkDeliveryTransport = new LarkDeliveryTransport()
const qqDeliveryTransport = new QqDeliveryTransport()
const discordDeliveryTransport = new DiscordDeliveryTransport()
const wechatDeliveryTransport = new WechatDeliveryTransport()
const channelDeliveryService = new ChannelDeliveryService({
  repository: channelDeliveryRepository,
  cipher: channelCredentialVault.payloadCipher,
  transport: new ChannelDeliveryTransportRouter({
    typeForChannel: (channelId) => channelManagementRepository.channelType(channelId),
    telegram: telegramDeliveryTransport,
    slack: slackDeliveryTransport,
    lark: larkDeliveryTransport,
    qq: qqDeliveryTransport,
    discord: discordDeliveryTransport,
    wechat: wechatDeliveryTransport
  })
})
const channelDispatchRuns = new ChannelDispatchRunRepository(agentDatabase)
const channelInboundExecutionCoordinator = new ChannelInboundExecutionCoordinator({
  inbound: channelInboundRepository,
  delivery: channelDeliveryService,
  cipher: channelCredentialVault.payloadCipher,
  runtime: agentRuntimeService,
  runs: channelDispatchRuns,
  failureText: async (kind) => {
    const language = (await settingsStore.get()).language
    if (language === 'zh-CN') {
      return kind === 'run-interrupted' ? '上一条消息处理被中断，请重新发送。' : '处理失败，请稍后重试。'
    }
    return kind === 'run-interrupted'
      ? 'The previous request was interrupted. Please send it again.'
      : 'The request failed. Please try again later.'
  }
})
const channelInboundExecutionRunner = new ChannelInboundExecutionRunner({
  inbound: channelInboundRepository,
  coordinator: channelInboundExecutionCoordinator
})
let channelInboundService!: ChannelInboundService
channelInboundService = new ChannelInboundService({
  repository: channelInboundRepository,
  encryption: { cipher: channelCredentialVault.payloadCipher },
  sessions: {
    createForConversation: async ({ agentId }) => (await agentServices.sessions.create({
      agentId,
      name: 'Channel conversation',
      workspace: { type: 'system' }
    })).id,
    discardUnbound: async (sessionId) => { await agentServices.sessions.delete(sessionId) },
    exists: async (sessionId) => Boolean(await agentServices.sessions.get(sessionId))
  },
  onInitialClaimAvailable: (dispatchId) => channelInboundExecutionRunner.onInitialClaim(channelInboundService, dispatchId)
})
const telegramRuntimeManager = new TelegramRuntimeManager({
  inbound: channelInboundRepository,
  inboundService: channelInboundService,
  offsets: telegramOffsetRepository,
  vault: channelCredentialVault,
  getPlatformFetch,
  delivery: telegramDeliveryTransport,
  getCredential: (channelId) => channelManagementRepository.credentialMetadata(channelId),
  ownsLifecycleOwner: (channelId, token, generation) => channelManagementRepository.ownsLifecycleOwner(channelId, { token, purpose: 'enable', generation }) ||
    channelManagementRepository.ownsLifecycleOwner(channelId, { token, purpose: 'restart', generation })
})
const slackRuntimeManager = new SlackRuntimeManager({
  inbound: channelInboundService,
  runtime: slackRuntimeRepository,
  vault: channelCredentialVault,
  getPlatformFetch,
  createPlatformWebSocket: createPlatformWebSocketFactory({ getNetworkSettings: async () => (await settingsStore.get()).network }),
  delivery: slackDeliveryTransport,
  getCredential: (channelId) => channelManagementRepository.credentialMetadata(channelId),
  keyedHash: (channelId, value) => channelCredentialVault.payloadCipher.keyedHash(channelId, value),
  isCurrentActive: (channelId, generation) => channelInboundRepository.isCurrentActive(channelId, generation),
  ownsLifecycleOwner: (channelId, token, generation) => channelManagementRepository.ownsLifecycleOwner(channelId, { token, purpose: 'enable', generation }) ||
    channelManagementRepository.ownsLifecycleOwner(channelId, { token, purpose: 'restart', generation })
})
const larkRuntimeManager = new LarkRuntimeManager({
  inbound: channelInboundService,
  runtime: larkRuntimeRepository,
  vault: channelCredentialVault,
  getPlatformFetch,
  createPlatformWebSocket: createPlatformWebSocketFactory({ getNetworkSettings: async () => (await settingsStore.get()).network }),
  delivery: larkDeliveryTransport,
  getCredential: (channelId) => channelManagementRepository.credentialMetadata(channelId),
  keyedHash: (channelId, value) => channelCredentialVault.payloadCipher.keyedHash(channelId, value),
  isCurrentActive: (channelId, generation) => channelInboundRepository.isCurrentActive(channelId, generation),
  ownsLifecycleOwner: (channelId, token, generation) => channelManagementRepository.ownsLifecycleOwner(channelId, { token, purpose: 'enable', generation }) ||
    channelManagementRepository.ownsLifecycleOwner(channelId, { token, purpose: 'restart', generation })
})
const qqRuntimeManager = new QqRuntimeManager({
  inbound: channelInboundService,
  runtime: qqRuntimeRepository,
  vault: channelCredentialVault,
  getPlatformFetch,
  createPlatformWebSocket: createPlatformWebSocketFactory({ getNetworkSettings: async () => (await settingsStore.get()).network }),
  delivery: qqDeliveryTransport,
  getCredential: (channelId) => channelManagementRepository.credentialMetadata(channelId),
  isCurrentActive: (channelId, generation) => channelInboundRepository.isCurrentActive(channelId, generation),
  ownsLifecycleOwner: (channelId, token, generation) => channelManagementRepository.ownsLifecycleOwner(channelId, { token, purpose: 'enable', generation }) ||
    channelManagementRepository.ownsLifecycleOwner(channelId, { token, purpose: 'restart', generation })
})
const discordRuntimeManager = new DiscordRuntimeManager({
  inbound: channelInboundService,
  runtime: discordRuntimeRepository,
  vault: channelCredentialVault,
  getPlatformFetch,
  createPlatformWebSocket: createPlatformWebSocketFactory({ getNetworkSettings: async () => (await settingsStore.get()).network }),
  delivery: discordDeliveryTransport,
  getCredential: (channelId) => channelManagementRepository.credentialMetadata(channelId),
  isCurrentActive: (channelId, generation) => channelInboundRepository.isCurrentActive(channelId, generation),
  ownsLifecycleOwner: (channelId, token, generation) => channelManagementRepository.ownsLifecycleOwner(channelId, { token, purpose: 'enable', generation }) ||
    channelManagementRepository.ownsLifecycleOwner(channelId, { token, purpose: 'restart', generation })
})
const wechatRuntimeManager = new WechatRuntimeManager({
  inbound: channelInboundService,
  runtime: wechatRuntimeRepository,
  enrollments: wechatEnrollmentRepository,
  vault: channelCredentialVault,
  getPlatformFetch,
  createPlatformWebSocket: createPlatformWebSocketFactory({ getNetworkSettings: async () => (await settingsStore.get()).network }),
  delivery: wechatDeliveryTransport
})
channelManagementService.setRuntime({
  start: (channelId, generation, token) => {
    const type = channelManagementRepository.channelType(channelId)
    if (type === 'telegram') return telegramRuntimeManager.start(channelId, generation, token)
    if (type === 'slack') return slackRuntimeManager.start(channelId, generation, token)
    if (type === 'feishu') return larkRuntimeManager.start(channelId, generation, token)
    if (type === 'qq') return qqRuntimeManager.start(channelId, generation, token)
    if (type === 'discord') return discordRuntimeManager.start(channelId, generation, token)
    if (type === 'wechat') return wechatRuntimeManager.start(channelId, generation, token)
    return Promise.resolve(false)
  },
  stop: (channelId, token) => {
    telegramRuntimeManager.stop(channelId, token)
    slackRuntimeManager.stop(channelId, token)
    larkRuntimeManager.stop(channelId, token)
    qqRuntimeManager.stop(channelId, token)
    discordRuntimeManager.stop(channelId, token)
    wechatRuntimeManager.stop(channelId, token)
  }
})
const telegramRuntimeMaintenance = new TelegramRuntimeMaintenance(telegramOffsetRepository)
const slackRuntimeMaintenance = new SlackRuntimeMaintenance(slackRuntimeRepository)
const larkRuntimeMaintenance = new LarkRuntimeMaintenance(larkRuntimeRepository)
const qqRuntimeMaintenance = new QqRuntimeMaintenance(qqRuntimeRepository)
const discordRuntimeMaintenance = new DiscordRuntimeMaintenance(discordRuntimeRepository)
const wechatRuntimeMaintenance = new WechatRuntimeMaintenance(wechatEnrollmentRepository, wechatRuntimeRepository)
const channelDeliveryMaintenance = new ChannelDeliveryMaintenance({
  repository: channelDeliveryRepository,
  retryDue: () => channelDeliveryService.retryDue()
})
const deliverTaskResultToChannels = createTaskChannelDelivery({
  delivery: channelDeliveryService,
  repository: channelDeliveryRepository,
  patchDeliverySummary: async (runLogId, deliverySummary) => {
    await agentServices.tasks.patchRunLog(runLogId, { deliverySummary })
  },
  runs: agentRepositories.taskRunLogs,
  readSessionMessages: async (sessionId: string) => {
    const state = await agentStore.getState()
    return (state.messagesBySessionId[sessionId] ?? []).map((message) => ({ role: message.role, status: message.status, text: message.searchableText }))
  },
  getLanguage: async () => (await settingsStore.get()).language
})
const taskAutomationMaintenance = createTaskAutomationMaintenance({
  attempts: {
    markPendingUnknown: () => 0,
    deleteOlderThan: () => 0
  },
  runs: agentRepositories.taskRunLogs,
  audits: agentRepositories.taskMutationAudits,
  checkpoints: agentRepositories.taskAutomationMaintenance
})
const agentTaskDispatchService = new AgentTaskDispatchService({
  services: agentServices,
  runtime: agentRuntimeService,
  getJobBridge: () => agentTaskJobBridge,
  readHeartbeat: readHeartbeatFileFromWorkspace,
  deliverTaskResult: deliverTaskResultToChannels.deliver,
  onStateChanged: async () => {
    const nextState = await agentStore.getState()
    agentTaskSchedulerRuntimeService.syncFromState(nextState)
    getMainWindow()?.webContents.send(IpcChannels.agentsStateChanged, nextState)
  }
})
const agentTaskSchedulerRuntimeService = new AgentTaskSchedulerRuntimeService({
  startupAt: new Date().toISOString(),
  getAgentState: () => agentStore.getState(),
  enqueueDueTask: async (task) => {
    await agentTaskExecutionCoordinator?.enqueueDueTask(task.taskId)
  }
})
agentTaskExecutionCoordinator = new AgentTaskExecutionCoordinator({
  services: agentServices,
  dispatchQueuedRun: (input) => agentTaskDispatchService.dispatchQueuedRun(input)
})
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
    getMainWindow()?.webContents.send(IpcChannels.agentsStateChanged, state)
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
let agentTaskRunController: ReturnType<typeof createAgentTaskRunController> | null = null
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
    getTaskRunController: () => agentTaskRunController
  }
})
const claudeCodeRuntimeDriver = new ClaudeCodeRuntimeDriver({
  ...claudeCodeRuntimeDependencies,
  emitChunk: (chunk) => agentRuntimeService.emitChunk?.(chunk),
  requestToolApproval: (input) => agentRuntimeService.requestToolApproval(input),
  prewarmSession: (input) => claudeAgentSdkRuntime.prewarmSession(input),
  executeTurn: createClaudeSdkPreferredExecutor({
    sdkRuntime: claudeAgentSdkRuntime,
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
      agentTaskExecutionCoordinator!.enqueueManualRun({
        agentId,
        taskId,
        expectedRevision,
        actor: { kind: 'user', source: 'renderer-agent-drawer' }
      })
        .then((runLog) => ({ taskId, runLogId: runLog.id }))
  },
  {
    cancelTaskRun: (runLogId: string) => {
      if (!agentTaskRunController) {
        throw new Error('Agent task run controller is not available.')
      }
      return agentTaskRunController.cancelTaskRun(runLogId)
    }
  },
  {
    getSkillRuntime: async (agentId: string) =>
      buildAgentSkillsRuntimeCatalog(skillsRuntimeService.getAgentRuntime(await agentStore.getState(), agentId))
  },
  {
    listProductToolPackages: async (agentId: string) => {
      const state = await agentStore.getState()
      return productAgentToolRegistry.listPackages(installedProductManifestIds).map((pkg) =>
        buildProductAgentToolPackageEditorView({
          package: pkg,
          binding: (state.agentProductToolPackages ?? []).find(
            (item) => item.agentId === agentId && item.productId === pkg.productId
          ),
          installedProductIds: installedProductManifestIds
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
      getMainWindow()?.webContents.send(IpcChannels.agentsStateChanged, nextState)
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

function broadcastAssistantStreamEvent(channel: string, payload: unknown): void {
  getMainWindow()?.webContents.send(channel, payload)
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
  events: {
    onChunk: (payload) => broadcastAssistantStreamEvent(IpcChannels.assistantsStreamChunk, payload),
    onDone: (payload) => broadcastAssistantStreamEvent(IpcChannels.assistantsStreamDone, payload),
    onError: (payload) => broadcastAssistantStreamEvent(IpcChannels.assistantsStreamError, payload),
    onStatus: (snapshot) => broadcastAssistantStreamEvent(IpcChannels.assistantsStreamStatusChanged, snapshot)
  }
})
const assistantTemplateRegistry = new AssistantTemplateRegistry()
assistantTemplateRegistry.registerMany(platformAssistantTemplates)
const assistantLibraryService = new AssistantLibraryService({
  registry: assistantTemplateRegistry,
  repos: assistantRepositories
})
const assistantInvocationService = new AssistantProgrammaticInvocationService({
  library: assistantLibraryService,
  repos: assistantRepositories,
  runtime: assistantChatRuntime,
  getProviderState: providerStore.getState,
  getDefaultAssistantModelId: async () => (await settingsStore.get()).modelDefaults.assistantModelId
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

function getMainWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
}

/**
 * **自绘标题栏**（`frame: false`，见 `window/windowChrome.ts`）下，窗口按钮的**唯一**目标：
 * 发起调用的那个窗口。
 *
 * 之前的实现一律 `getMainWindow()`：主窗只有一层时等价，但独立页面窗/面板窗自己画出最小化/最大化/关闭后，
 * 点「关闭」会去关主窗（用户可见的严重错乱）。身份不从渲染层参数来——`BrowserWindow.fromWebContents`
 * 由 Main 用 `event.sender` 推导，参数里没有任何 webContentsId/窗口句柄。
 */
function resolveInvokingWindow(event: IpcMainInvokeEvent): BrowserWindow | null {
  const window = BrowserWindow.fromWebContents(event.sender)
  return window && !window.isDestroyed() ? window : null
}

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
  getMainWindow()?.webContents.send(IpcChannels.agentsStateChanged, nextState)
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
    platformFetch: typeof fetch
    secretVault: ReturnType<typeof createElectronSecretVault>
    registerProductAgentToolHandler: (registration: ProductAgentToolHandlerRegistration) => void
    registerProductCache: ReturnType<typeof createProductCacheRegistrar>
    registerProductDisposer: ReturnType<typeof createProductServiceDisposerRegistry>['register']
    getAgentState?: () => Promise<AgentStoreState>
    createAgentSession?: (input: CreateAgentSessionDto) => Promise<AgentSessionEntity>
    invokeProductAgentTool?: (
      state: AgentStoreState,
      input: ProductAgentToolInvokeInput
    ) => Promise<ProductAgentToolInvokeResult>
    invokeProductIpc?: (productId: string, method: string, payload?: unknown) => Promise<unknown>
    assistantInvocation?: AssistantProgrammaticInvocationService
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

  ipcMain.handle(IpcChannels.appInfo, () => ({
    name: app.getName(),
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    osRelease: release(),
    theme: nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
  }))

  ipcMain.handle(IpcChannels.productSummaries, () => summarizeProductManifests(productManifests))

  // 自绘标题栏的窗口按钮：目标窗口一律由 `event.sender` 推导（主窗/独立窗同一套按钮，见 resolveInvokingWindow）
  ipcMain.handle(IpcChannels.windowMinimize, (event: IpcMainInvokeEvent) => resolveInvokingWindow(event)?.minimize())
  ipcMain.handle(IpcChannels.windowMaximize, (event: IpcMainInvokeEvent) => {
    const window = resolveInvokingWindow(event)
    if (!window) return false
    if (window.isMaximized()) window.unmaximize()
    else window.maximize()
    return window.isMaximized()
  })
  ipcMain.handle(IpcChannels.windowClose, (event: IpcMainInvokeEvent) => resolveInvokingWindow(event)?.close())
  ipcMain.handle(IpcChannels.windowIsMaximized, (event: IpcMainInvokeEvent) => resolveInvokingWindow(event)?.isMaximized() ?? false)
  ipcMain.handle(IpcChannels.windowSetMinimumSize, (event: IpcMainInvokeEvent, width: number, height: number) => {
    const window = resolveInvokingWindow(event)
    if (!window) return
    const minimumWidth = Number.isFinite(width) ? Math.max(0, Math.floor(width)) : DEFAULT_MIN_WINDOW_WIDTH
    const minimumHeight = Number.isFinite(height) ? Math.max(0, Math.floor(height)) : DEFAULT_MIN_WINDOW_HEIGHT
    window.setMinimumSize(minimumWidth, minimumHeight)
    const [nextWidth, nextHeight] = clampWindowSizeToMinimum(window.getSize() as [number, number], {
      width: minimumWidth,
      height: minimumHeight
    })
    if (nextWidth !== window.getSize()[0] || nextHeight !== window.getSize()[1]) {
      window.setSize(nextWidth, nextHeight)
    }
  })
  ipcMain.handle(IpcChannels.windowResetMinimumSize, (event: IpcMainInvokeEvent) => {
    const window = resolveInvokingWindow(event)
    if (!window) return
    window.setMinimumSize(DEFAULT_MIN_WINDOW_WIDTH, DEFAULT_MIN_WINDOW_HEIGHT)
    const [nextWidth, nextHeight] = clampWindowSizeToMinimum(window.getSize() as [number, number], {
      width: DEFAULT_MIN_WINDOW_WIDTH,
      height: DEFAULT_MIN_WINDOW_HEIGHT
    })
    if (nextWidth !== window.getSize()[0] || nextHeight !== window.getSize()[1]) {
      window.setSize(nextWidth, nextHeight)
    }
  })
  /**
   * 自绘标题栏的**菜单条**（Windows 上 `frame: false` 之后，OS 不再绘制菜单栏，Alt 也唤不出）。
   *
   * 只暴露两件事：应用菜单的**顶层标签**（供渲染层排版），以及「按索引弹出既有子菜单」。
   * 没有任意 channel/命令/role 字符串入口——菜单内容仍是 `buildAppMenu` 里那一份
   * `Menu.setApplicationMenu`，点击行为与原生菜单逐字一致（不新增第二套命令表）。
   */
  ipcMain.handle(IpcChannels.windowMenuList, () => {
    const menu = Menu.getApplicationMenu()
    if (!menu) return []
    return menu.items
      .map((item, index) => ({ index, label: item.label, visible: item.visible }))
      .filter((item) => item.visible && item.label.length > 0)
  })
  ipcMain.handle(IpcChannels.windowMenuPopup, (event: IpcMainInvokeEvent, index: number, x: number, y: number) => {
    const window = resolveInvokingWindow(event)
    const items = Menu.getApplicationMenu()?.items ?? []
    const submenu = Number.isInteger(index) ? items[index]?.submenu : undefined
    if (!window || !submenu) return false
    // 坐标是渲染层给的「菜单按钮左下角」（窗口内容 CSS px = DIP）；非有限值一律夹到 0
    const popupX = Math.max(0, Math.round(Number.isFinite(x) ? x : 0))
    const popupY = Math.max(0, Math.round(Number.isFinite(y) ? y : 0))
    return new Promise<boolean>((resolve) => {
      try {
        submenu.popup({
          window,
          x: popupX,
          y: popupY,
          // 关闭回调：渲染层据此撤掉按钮的「打开中」高亮（渲染层不自己猜关闭时机）
          callback: () => resolve(true)
        })
      } catch {
        resolve(false)
      }
    })
  })
  ipcMain.handle(IpcChannels.shellOpenExternal, (_event: IpcMainInvokeEvent, url: string) => {
    if (!url.startsWith('https://') && !url.startsWith('http://')) {
      throw new Error('Only http(s) URLs can be opened externally.')
    }
    return shell.openExternal(url)
  })
  ipcMain.handle(IpcChannels.shellOpenPath, (_event: IpcMainInvokeEvent, path: string) => {
    if (!path.trim()) return ''
    return shell.openPath(path)
  })
  ipcMain.handle(IpcChannels.appQuoteToMain, (_event: IpcMainInvokeEvent, text: string) => {
    const window = getMainWindow()
    if (!window || !text.trim()) return false
    if (window.isMinimized()) window.restore()
    if (!window.isVisible()) window.show()
    window.focus()
    setTimeout(() => {
      if (!window.isDestroyed()) {
        window.webContents.send(IpcChannels.appQuoteToMain, text)
      }
    }, 100)
    return true
  })
  ipcMain.handle(IpcChannels.dialogSelectDirectory, async () => {
    const options: OpenDialogOptions = {
      properties: ['openDirectory', 'createDirectory'],
      title: '选择工作区'
    }
    const window = getMainWindow()
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
    return result.canceled ? null : result.filePaths[0] ?? null
  })
  ipcMain.handle(IpcChannels.dialogSelectFiles, async () => {
    const options: OpenDialogOptions = {
      properties: ['openFile', 'multiSelections'],
      title: '选择附件'
    }
    const window = getMainWindow()
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
    return result.canceled ? [] : result.filePaths
  })
  ipcMain.handle(IpcChannels.appReadTextFile, async (_event: IpcMainInvokeEvent, path: string) => readTextFilePreview(path))
  ipcMain.handle(IpcChannels.appSaveClipboardImage, async (_event: IpcMainInvokeEvent, payload: unknown) => {
    // Renderer paste path: clipboard pixels are not a filesystem path, so write one temp file and
    // hand the existing attachment reader a normal path.
    if (!payload || typeof payload !== 'object') throw new Error('Invalid clipboard image payload.')
    const { data, mimeType } = payload as { data?: unknown; mimeType?: unknown }
    const bytes =
      data instanceof Uint8Array
        ? data
        : data instanceof ArrayBuffer
          ? new Uint8Array(data)
          : null
    if (!bytes || bytes.byteLength === 0 || bytes.byteLength > 20 * 1024 * 1024) {
      throw new Error('Clipboard image is empty or too large.')
    }
    const extension =
      mimeType === 'image/jpeg'
        ? 'jpg'
        : mimeType === 'image/webp'
          ? 'webp'
          : mimeType === 'image/gif'
            ? 'gif'
            : 'png'
    const directory = join(app.getPath('temp'), 'macrobay-clipboard')
    await mkdirSync(directory, { recursive: true })
    const filePath = join(directory, `paste-${Date.now()}-${randomUUID()}.${extension}`)
    await writeFile(filePath, bytes)
    return filePath
  })
  // PLAT-27：`platform:external-apps-*` 此前只有声明、没有 handler（死通道 ⇒ Agent 聊天栏「外部应用」列表
  // 永不出现）。主进程侧本就存在可平凡接线的枚举实现（`ExternalAppsService`）⇒ 注册 handler（情形 ①），
  // 不新增通道、不改按钮的 fail-closed 行为；枚举来源是 OS 的协议处理器查询，路径入参经既有 allow-list 校验。
  ipcMain.handle(IpcChannels.externalAppsListInstalled, () => externalAppsService.listInstalledAppViews())
  ipcMain.handle(IpcChannels.externalAppsLaunchWorkspace, (_event: IpcMainInvokeEvent, input: unknown) =>
    externalAppsService.launchWorkspace(validateLaunchExternalAppRequest(input)))

  ipcMain.handle(IpcChannels.settingsGet, () => settingsStore.get())
  ipcMain.handle(IpcChannels.settingsUpdate, async (_event: IpcMainInvokeEvent, patch: AppSettingsPatch) => {
    const next = await settingsStore.update(patch)
    if (patch.language) {
      await ensureDefaultAssistantSeed()
      // 内置 Agent/会话文案按 id 重新解析到新语言；用户改过的字段不动，也不写任何迁移标记。
      await refreshBuiltinSeedCopy(next.language)
    }
    await applySessionProxySettings(next.network)
    // PLAT-32/S1：偏好的**唯一对账点** = 这条显式通知（受控读取不再带副作用；通知自身绝不 reject）
    void panelWorkspaceForDisposal?.notifyPreferencesChanged()
    return next
  })
  ipcMain.handle(IpcChannels.channelsCatalog, () => channelManagementService.catalog())
  ipcMain.handle(IpcChannels.channelsList, () => channelManagementService.list())
  ipcMain.handle(IpcChannels.channelsGet, (_event: IpcMainInvokeEvent, id: unknown) => channelManagementService.get(id))
  ipcMain.handle(IpcChannels.channelsCreate, (_event: IpcMainInvokeEvent, input: unknown) => channelManagementService.create(asChannelInput(input)))
  ipcMain.handle(IpcChannels.channelsUpdate, (_event: IpcMainInvokeEvent, input: unknown) => channelManagementService.update(asChannelInput(input)))
  ipcMain.handle(IpcChannels.channelsDisable, (_event: IpcMainInvokeEvent, input: unknown) => channelManagementService.disable(asChannelInput(input)))
  ipcMain.handle(IpcChannels.channelsRequestEnable, (_event: IpcMainInvokeEvent, input: unknown) => channelManagementService.requestEnable(asChannelInput(input)))
  ipcMain.handle(IpcChannels.channelsRestart, (_event: IpcMainInvokeEvent, input: unknown) => channelManagementService.restart(asChannelInput(input)))
  ipcMain.handle(IpcChannels.channelsDelete, async (_event: IpcMainInvokeEvent, input: unknown) => channelManagementService.delete(asChannelInput(input)))
  ipcMain.handle(IpcChannels.channelsCredentialBegin, (_event: IpcMainInvokeEvent, input: unknown) => {
    const value = asChannelInput(input)
    return channelManagementService.beginCredential({ id: value.id, senderId: _event.sender.id })
  })
  ipcMain.handle(IpcChannels.channelsCredentialSubmit, async (_event: IpcMainInvokeEvent, input: unknown) => {
    const value = asChannelInput(input)
    return channelManagementService.provision({ id: value.id, actorId: value.actorId, senderId: _event.sender.id, handoff: asChannelHandoff(value.handoff) })
  })
  ipcMain.handle(IpcChannels.channelsCredentialRotate, async (_event: IpcMainInvokeEvent, input: unknown) => {
    const value = asChannelInput(input)
    return channelManagementService.rotate({ id: value.id, actorId: value.actorId, senderId: _event.sender.id, handoff: asChannelHandoff(value.handoff) })
  })
  ipcMain.handle(IpcChannels.channelsPolicyBegin, (_event: IpcMainInvokeEvent, input: unknown) => channelManagementService.beginPolicy({ id: asChannelInput(input).id, senderId: _event.sender.id }))
  ipcMain.handle(IpcChannels.channelsPolicyCreate, async (_event: IpcMainInvokeEvent, input: unknown) => {
    const value = asChannelInput(input)
    return channelManagementService.createPolicy({
      id: value.id,
      actorId: value.actorId,
      senderId: _event.sender.id,
      handoff: asChannelHandoff(value.handoff)
    })
  })
  ipcMain.handle(IpcChannels.channelsListAudits, (_event: IpcMainInvokeEvent, input: unknown) => {
    const value = asChannelInput(input)
    return channelManagementService.listAudits({ id: value.id, limit: value.limit, offset: value.offset })
  })
  ipcMain.handle(IpcChannels.channelsRuntimeStatus, (_event: IpcMainInvokeEvent, input: unknown) => channelManagementService.runtimeStatus({ id: asChannelInput(input).id }))
  ipcMain.handle(IpcChannels.channelsListDeliveryAttempts, (_event: IpcMainInvokeEvent, input: unknown) => {
    const value = asChannelInput(input)
    return channelManagementService.listDeliveryAttempts({ id: value.id, limit: value.limit, offset: value.offset })
  })
  ipcMain.handle(IpcChannels.channelsListDeliveryAudits, (_event: IpcMainInvokeEvent, input: unknown) => {
    const value = asChannelInput(input)
    return channelManagementService.listDeliveryAudits({ id: value.id, limit: value.limit, offset: value.offset })
  })
  ipcMain.handle(IpcChannels.channelsListPolicies, (_event: IpcMainInvokeEvent, input: unknown) => {
    const value = asChannelInput(input)
    return channelManagementService.listPolicies({ id: value.id, limit: value.limit })
  })
  ipcMain.handle(IpcChannels.channelsDeletePolicy, (_event: IpcMainInvokeEvent, input: unknown) => {
    const value = asChannelInput(input)
    return channelManagementService.deletePolicy({ channelId: value.channelId, policyId: value.policyId, actorId: value.actorId })
  })
  ipcMain.handle(IpcChannels.channelsListConversations, (_event: IpcMainInvokeEvent, input: unknown) => {
    const value = asChannelInput(input)
    return channelManagementService.listConversations({ id: value.id, limit: value.limit })
  })
  ipcMain.handle(IpcChannels.channelsSetTarget, (_event: IpcMainInvokeEvent, input: unknown) => {
    const value = asChannelInput(input)
    return channelManagementService.setTarget({
      channelId: value.channelId,
      conversationId: value.conversationId,
      enabled: assertBoolean(value.enabled),
      actorId: value.actorId
    })
  })

  ipcMain.handle(IpcChannels.channelsListCandidates, (_event: IpcMainInvokeEvent, input: unknown) => {
    const value = asChannelInput(input)
    return channelInboundService.listCandidates(String(value.id), typeof value.limit === 'number' ? value.limit : 100)
  })
  ipcMain.handle(IpcChannels.channelsAllowCandidate, (_event: IpcMainInvokeEvent, input: unknown) => {
    const value = asChannelInput(input)
    return channelInboundService.allowCandidate({
      channelId: String(value.channelId ?? value.id),
      candidateId: String(value.candidateId),
      enableTarget: assertBoolean(value.enableTarget)
    })
  })
  ipcMain.handle(IpcChannels.channelsIgnoreCandidate, (_event: IpcMainInvokeEvent, input: unknown) => {
    const value = asChannelInput(input)
    return channelInboundService.ignoreCandidate(String(value.channelId ?? value.id), String(value.candidateId))
  })

  ipcMain.handle(IpcChannels.modelProvidersList, () => providerStore.list())
  ipcMain.handle(IpcChannels.modelProvidersUpsert, async (_event: IpcMainInvokeEvent, provider: ModelProviderInput) => {
    const result = await providerStore.upsert(provider)
    invalidateAgentModelCompatibilityCache(provider.id)
    // 保存 Key / 改地址后，旧的逐模型运行证据必须作废，否则会出现
    // "同一供应商有的模型说缺少 API Key、有的正常"（旧快照没失效）。
    await agentRuntimeProbeSnapshotStore.invalidateProvider(provider.id).catch(() => undefined)
    return result
  })
  ipcMain.handle(IpcChannels.modelProvidersRemove, async (_event: IpcMainInvokeEvent, providerId: string) => {
    const result = await providerStore.remove(providerId)
    invalidateAgentModelCompatibilityCache(providerId)
    return result
  })
  ipcMain.handle(IpcChannels.modelProvidersSetEnabled, (_event: IpcMainInvokeEvent, providerId: string, enabled: boolean) =>
    providerStore.setEnabled(providerId, enabled).then((result) => {
      invalidateAgentModelCompatibilityCache(providerId)
      return result
    })
  )
  ipcMain.handle(IpcChannels.modelProvidersAddOrUpdateModel, (_event: IpcMainInvokeEvent, providerId: string, model: ModelDefinition) =>
    providerStore.addOrUpdateModel(providerId, model).then((result) => {
      invalidateAgentModelCompatibilityCache(providerId)
      return result
    })
  )
  ipcMain.handle(IpcChannels.modelProvidersRemoveModel, (_event: IpcMainInvokeEvent, providerId: string, modelId: string) =>
    providerStore.removeModel(providerId, modelId).then((result) => {
      invalidateAgentModelCompatibilityCache(providerId)
      return result
    })
  )
  ipcMain.handle(IpcChannels.modelProvidersSetDefaultChatModel, (_event: IpcMainInvokeEvent, providerId: string, modelId: string) =>
    providerStore.setDefaultChatModel(providerId, modelId).then((result) => {
      invalidateAgentModelCompatibilityCache(providerId)
      return result
    })
  )
  ipcMain.handle(
    IpcChannels.modelProvidersTestConnection,
    async (
      _event: IpcMainInvokeEvent,
      providerId: string,
      options?: {
        modelId?: string
        proxyProbeUrl?: string
        /** PLAT-63：单个已保存端点的测试（同一通道、additive 参数；不新增通道）。 */
        endpointTest?: { kind?: unknown; baseUrl?: unknown }
      }
    ) => {
      // PLAT-61 代理自检（同一通道、additive 参数）：无鉴权 GET，用 Electron net.fetch 走当前 session 代理。
      if (typeof options?.proxyProbeUrl === 'string' && options.proxyProbeUrl.trim()) {
        return probeProviderProxyTarget(options.proxyProbeUrl.trim(), getPlatformFetch())
      }
      // PLAT-63：端点测试只接受已知端点类型 + http(s) 地址；校验先于任何网络请求。
      if (options?.endpointTest !== undefined) {
        const kind = options.endpointTest.kind
        const baseUrl = typeof options.endpointTest.baseUrl === 'string' ? options.endpointTest.baseUrl.trim() : ''
        if (!isEndpointProbeKind(kind)) throw new Error('Unknown endpoint kind for probe.')
        if (!/^https?:\/\//i.test(baseUrl)) throw new Error('Endpoint probe requires an http(s) base URL.')
        const provider = await providerStore.resolveRuntimeProvider(providerId)
        if (!provider) throw new Error(`Provider "${providerId}" was not found.`)
        return probeProviderEndpoint(provider, { kind, baseUrl, fetch: getPlatformFetch() })
      }
      const provider = await providerStore.resolveRuntimeProvider(providerId)
      if (!provider) throw new Error(`Provider "${providerId}" was not found.`)
      // 所有 provider 出站都必须走平台 fetch（Electron net.fetch + session 代理），禁止全局 fetch。
      return testModelProviderConnection(provider, { modelId: options?.modelId, fetch: getPlatformFetch() })
    }
  )
  /**
   * T1–T3：图像生成 / 图像编辑共用**同一条**通道（`operation: 'edit'` 是 additive 参数，不新增通道）。
   * 全部返回结构化 `{ok:...}`，不再抛裸 IPC 错误；顺序固定为
   * 「校验参数 → 解析 provider → 检查端点 → 原图落盘 → 先落 pending 消息 → 出站 → 用同一 id settle」。
   */
  ipcMain.handle(
    IpcChannels.modelProvidersGenerateImage,
    async (_event: IpcMainInvokeEvent, providerId: string, input: unknown) => {
      if (typeof providerId !== 'string' || !providerId.trim()) {
        return { ok: false, reasonCode: 'invalid_request', message: 'providerId is required.' }
      }
      const request = readProviderImageChannelRequest(input)
      if (!request.topicId) {
        return { ok: false, reasonCode: 'missing_topic', message: 'Select a topic before generating an image.' }
      }
      // 先校验（model / prompt 长度 / count 1–4 / size 白名单），再解析 provider 并出站。
      const validated = validateImageGenerationInput(input)
      if (!validated.ok) return validated
      // 编辑额外校验原图（≤4MB、mime 白名单、file 名必须是 hash 形状）。
      const editInput = request.operation === 'edit' ? validateImageEditInput(input) : null
      if (editInput && !editInput.ok) return editInput
      const provider = await providerStore.resolveRuntimeProvider(providerId)
      if (!provider) {
        return { ok: false, reasonCode: 'provider_not_found', message: `Provider "${providerId}" was not found.` }
      }
      const endpoint = request.operation === 'edit'
        ? provider.imageEndpoints?.edit
        : provider.imageEndpoints?.generation
      if (!endpoint?.trim()) {
        return { ok: false, reasonCode: 'missing_endpoint', message: 'The provider has no image endpoint configured.' }
      }
      // 原图：会话图片按 hash 文件名读盘，上传字节先落盘；两条路径都只把引用写进消息。
      let editSource: { mime: ImageEditSourceMime; bytes: Uint8Array } | null = null
      let storedSource: StoredGeneratedImage | null = null
      if (request.operation === 'edit') {
        if (!editInput?.ok) {
          return { ok: false, reasonCode: 'invalid_request', message: 'A source image is required.' }
        }
        const resolved = await resolveImageEditSource(generatedImageStorage, editInput.value.sourceImage)
        if (!resolved.ok) return resolved
        editSource = resolved.source
        storedSource = resolved.stored
      }
      const model = provider.models.find((entry) => entry.id === validated.value.modelId)
      // 生成中：先落 pending 占位（完成时用同一个 id 替换，不会多出一条消息）。
      const prepared = await assistantImageMessages.prepare({
        topicId: request.topicId,
        operation: request.operation,
        modelId: validated.value.modelId,
        modelSnapshot: { id: validated.value.modelId, name: model?.name ?? validated.value.modelId, provider: provider.name },
        prompt: validated.value.prompt,
        ...(storedSource ? { sourceImage: storedSource } : {})
      })
      if (!prepared.ok) return prepared
      // 所有 provider 出站都必须走平台 fetch（Electron net.fetch + session 代理），禁止全局 fetch。
      const outcome = request.operation === 'edit'
        ? await editProviderImages(provider, { ...validated.value, source: editSource!, fetch: getPlatformFetch() })
        : await generateProviderImages(provider, { ...validated.value, fetch: getPlatformFetch() })
      return assistantImageMessages.settle({ assistantMessageId: prepared.assistantMessageId, outcome })
    }
  )
  // PLAT-82：「检测模型」= 联通性 + 协议支持探测。主进程执行（Key 只在主进程、并发 5、
  // abort 记账在 main），结果只存内存、绝不写库；一模型一条 progress 事件，run 结束发 done。
  const modelProviderDetection = createModelProviderDetectionService({
    resolveProvider: (providerId: string) => providerStore.resolveRuntimeProvider(providerId),
    fetch: () => getPlatformFetch(),
    onProgress: (result) => {
      getMainWindow()?.webContents.send(IpcChannels.modelProvidersDetectionProgress, result)
    },
    onDone: (runId, payload) => {
      getMainWindow()?.webContents.send(IpcChannels.modelProvidersDetectionDone, runId, payload)
    },
    // PLAT-82：run 结束后把「实测通过」的协议写回模型（一次写入；状态文案不落库）。
    recordProbedProtocols: (providerId, updates) => providerStore.recordProbedProtocols(providerId, updates),
    // 可用性结论：只写 ok / failed；渲染层用同一指纹函数判过期。
    recordModelAvailability: (providerId, updates, checkedAt) =>
      providerStore.recordModelAvailability(providerId, updates, checkedAt)
  })
  ipcMain.handle(
    IpcChannels.modelProvidersDetectModels,
    async (
      _event: IpcMainInvokeEvent,
      providerId: string,
      options?: { modes?: unknown; runId?: unknown; modelIds?: unknown }
    ) => {
      if (typeof providerId !== 'string' || !providerId.trim()) {
        throw new Error('providerId is required.')
      }
      return modelProviderDetection.detectModels(providerId, {
        modes: (options?.modes ?? []) as ModelDetectionMode[],
        runId: typeof options?.runId === 'string' ? options.runId : '',
        ...(Array.isArray(options?.modelIds) ? { modelIds: options.modelIds as string[] } : {})
      })
    }
  )
  ipcMain.handle(
    IpcChannels.modelProvidersCancelModelDetection,
    (_event: IpcMainInvokeEvent, runId: string) => {
      if (typeof runId === 'string' && runId.trim()) modelProviderDetection.cancelModelDetection(runId)
    }
  )
  ipcMain.handle(
    IpcChannels.modelProvidersRunRuntimeChecks,
    async (
      _event: IpcMainInvokeEvent,
      providerId: string,
      options?: { modelId?: string; runtimeId?: 'claude-code' | 'openai-agents'; checkGateway?: boolean }
    ) => {
      const provider = await providerStore.resolveRuntimeProvider(providerId)
      if (!provider) throw new Error(`Provider "${providerId}" was not found.`)
      const modelId =
        options?.modelId?.trim() ||
        provider.defaultChatModelId ||
        provider.models.find((model) => model.capabilities.chat)?.id
      if (!modelId) throw new Error('Add at least one chat-capable model first.')
      return providerRuntimeCheckService.runChecks({
        providerId,
        modelId,
        runtimeId: options?.runtimeId ?? 'claude-code',
        checkGateway: options?.checkGateway
      })
    }
  )
  ipcMain.handle(
    IpcChannels.modelProvidersGetRuntimeCheckReport,
    async (
      _event: IpcMainInvokeEvent,
      providerId: string,
      modelId: string,
      runtimeId: 'claude-code' | 'openai-agents' = 'claude-code'
    ) => providerRuntimeCheckService.getReport(providerId, modelId, runtimeId)
  )
  /**
   * PLAT-61 诊断可用性：模型同步失败**不再 throw**（原始 IPC Error 会带着
   * `Error invoking remote method '<channel>'` 泄漏到 UI）。改为结构化结果：
   * `{ ok:false, reasonCode, message }`；`ok:true` 仍保留既有 `added`/`missing`/provider 字段。
   * 通道名与载荷形状保持向后兼容。
   */
  ipcMain.handle(IpcChannels.modelProvidersPreviewModelSync, async (_event: IpcMainInvokeEvent, providerId: string) => {
    const provider = await providerStore.resolveRuntimeProvider(providerId)
    if (!provider) {
      return { ok: false, reasonCode: 'provider_not_found', message: 'The provider was not found.' }
    }
    // 模型同步同样必须走平台 fetch（否则会绕过代理，需代理的域名必然超时）。
    return previewProviderModelSync(provider, { fetch: getPlatformFetch() })
  })
  ipcMain.handle(IpcChannels.modelProvidersApplyModelSync, async (
    _event: IpcMainInvokeEvent,
    providerId: string,
    plan: unknown
  ): Promise<ModelSyncApplyOutcome> => {
    try {
      const result = await providerStore.applyModelSync(providerId, normalizeModelSyncPlan(plan))
      invalidateAgentModelCompatibilityCache(providerId)
      return { ok: true, provider: result }
    } catch (error) {
      return toModelSyncFailure(error)
    }
  })
  /**
   * PLAT-58：产品 owner 决定允许 UI 显式查看已保存的完整 Key。
   * 只读、绝不打印该值；只允许已知 provider，校验失败不触碰 vault。
   */
  ipcMain.handle(IpcChannels.modelProvidersSetCustomHeaders, async (_event: IpcMainInvokeEvent, providerId: string, headers: unknown) => {
    if (typeof providerId !== 'string' || !providerId.trim()) return { ok: false, error: 'invalid_provider' }
    if (!Array.isArray(headers)) return { ok: false, error: 'invalid_headers' }
    const provider = await providerStore.setCustomHeaders(providerId, headers)
    return { ok: true, provider }
  })

  ipcMain.handle(IpcChannels.modelProvidersRevealCustomHeaders, async (_event: IpcMainInvokeEvent, providerId: string) => {
    if (typeof providerId !== 'string' || !providerId.trim()) return { headers: [] }
    const headers = await providerStore.revealCustomHeaders(providerId)
    return { headers }
  })

  ipcMain.handle(IpcChannels.modelProvidersRevealApiKey, async (_event: IpcMainInvokeEvent, providerId: string) => {
    if (typeof providerId !== 'string' || !providerId.trim()) throw new Error('Provider id is required.')
    const knownProviders = await providerStore.list()
    if (!knownProviders.some((provider) => provider.id === providerId)) {
      throw new Error(`Provider "${providerId}" was not found.`)
    }
    return { apiKey: await providerStore.revealApiKey(providerId) }
  })

  ipcMain.handle(IpcChannels.webSearchListProviders, () => webSearchIpcHandlers.listProviders())
  ipcMain.handle(IpcChannels.webSearchGetSettings, () => webSearchIpcHandlers.getSettings())
  ipcMain.handle(IpcChannels.webSearchUpdateSettings, (_event: IpcMainInvokeEvent, patch: unknown) =>
    webSearchIpcHandlers.updateSettings(patch)
  )
  ipcMain.handle(IpcChannels.webSearchUpdateProvider, (_event: IpcMainInvokeEvent, input: unknown) =>
    webSearchIpcHandlers.updateProvider(input)
  )
  ipcMain.handle(IpcChannels.webSearchRevealProviderApiKey, (_event: IpcMainInvokeEvent, providerId: unknown) =>
    webSearchIpcHandlers.revealProviderApiKey(providerId)
  )
  ipcMain.handle(IpcChannels.webSearchCheckProvider, (_event: IpcMainInvokeEvent, input: unknown) =>
    webSearchIpcHandlers.checkProvider(input)
  )
  ipcMain.handle(IpcChannels.webSearchSearchKeywords, (_event: IpcMainInvokeEvent, input: unknown) =>
    webSearchIpcHandlers.searchKeywords(input)
  )
  ipcMain.handle(IpcChannels.webSearchFetchUrls, (_event: IpcMainInvokeEvent, input: unknown) =>
    webSearchIpcHandlers.fetchUrls(input)
  )
  ipcMain.handle(IpcChannels.storageListCaches, () => cacheGovernanceIpcHandlers.listCaches())
  ipcMain.handle(IpcChannels.storageInspectCache, (_event: IpcMainInvokeEvent, cacheId: unknown) =>
    cacheGovernanceIpcHandlers.inspectCache(cacheId)
  )
  ipcMain.handle(IpcChannels.storageClearCache, (_event: IpcMainInvokeEvent, input: unknown) =>
    cacheGovernanceIpcHandlers.clearCache(input)
  )
  ipcMain.handle(IpcChannels.storageCompactCache, (_event: IpcMainInvokeEvent, input: unknown) =>
    cacheGovernanceIpcHandlers.compactCache(input)
  )
  ipcMain.handle(IpcChannels.storageListCacheOperations, (_event: IpcMainInvokeEvent, query?: unknown) =>
    cacheGovernanceIpcHandlers.listOperations(query)
  )

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
    getMainWindow()?.webContents.send(IpcChannels.agentsStateChanged, result.state)
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
    const previousState = await agentStore.getState()
    const created = await agentIpcHandlers.createAgent(input as Parameters<typeof agentIpcHandlers.createAgent>[0])
    await syncAgentStateAfterMutation(previousState)
    return created
  })
  registerAgentTaskIpcHandlers(ipcMain, agentIpcHandlers, {
    getScheduleValidationOptions: taskIpcScheduleValidationOptions,
    afterCommit: refreshTaskStateAfterCommit
  })
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
    const previousState = await agentStore.getState()
    const created = await agentIpcHandlers.createSession(input as Parameters<typeof agentIpcHandlers.createSession>[0])
    await syncAgentStateAfterMutation(previousState)
    return created
  })
  ipcMain.handle(IpcChannels.agentsUpdateAgent, async (_event: IpcMainInvokeEvent, agentId: string, patch: unknown) => {
    const updated = await agentIpcHandlers.updateAgent(
      agentId,
      patch as Parameters<typeof agentIpcHandlers.updateAgent>[1]
    )
    getMainWindow()?.webContents.send(IpcChannels.agentsStateChanged, await agentServices.state.getState())
    return updated
  })
  ipcMain.handle(IpcChannels.agentsDeleteAgent, async (_event: IpcMainInvokeEvent, agentId: string) => {
    const previousState = await agentStore.getState()
    await agentIpcHandlers.deleteAgent(agentId)
    return syncAgentStateAfterMutation(previousState)
  })
  ipcMain.handle(IpcChannels.agentsReorderAgents, async (_event: IpcMainInvokeEvent, orderedAgentIds: string[]) => {
    const state = await agentIpcHandlers.reorderAgents(orderedAgentIds)
    getMainWindow()?.webContents.send(IpcChannels.agentsStateChanged, state)
    return state
  })
  ipcMain.handle(IpcChannels.agentsSelectAgent, async (_event: IpcMainInvokeEvent, agentId: string) => {
    const state = await agentIpcHandlers.selectAgent(agentId)
    getMainWindow()?.webContents.send(IpcChannels.agentsStateChanged, state)
    return state
  })
  ipcMain.handle(
    IpcChannels.agentsUpdateSession,
    async (_event: IpcMainInvokeEvent, sessionId: string, patch: unknown) => {
      const typedPatch = patch as Parameters<typeof agentIpcHandlers.updateSession>[1]
      const previousState = typedPatch.agentId === undefined ? null : await agentStore.getState()
      const updated = await agentIpcHandlers.updateSession(sessionId, typedPatch)
      if (previousState) {
        await syncAgentStateAfterMutation(previousState)
      } else {
        getMainWindow()?.webContents.send(IpcChannels.agentsStateChanged, await agentServices.state.getState())
      }
      return updated
    }
  )
  ipcMain.handle(IpcChannels.agentsDeleteSessions, async (_event: IpcMainInvokeEvent, sessionIds: string[]) => {
    const previousState = await agentStore.getState()
    const result = await agentIpcHandlers.deleteSessions(sessionIds)
    await syncAgentStateAfterMutation(previousState)
    return result
  })
  ipcMain.handle(IpcChannels.agentsReorderSessions, async (_event: IpcMainInvokeEvent, orderedSessionIds: string[]) => {
    const state = await agentIpcHandlers.reorderSessions(orderedSessionIds)
    getMainWindow()?.webContents.send(IpcChannels.agentsStateChanged, state)
    return state
  })
  ipcMain.handle(IpcChannels.agentsSetSessionAgent, async (_event: IpcMainInvokeEvent, sessionId: string, agentId: string | null) => {
    const previousState = await agentStore.getState()
    const session = await agentIpcHandlers.setSessionAgent(sessionId, agentId)
    await syncAgentStateAfterMutation(previousState)
    return session
  })
  ipcMain.handle(IpcChannels.agentsSetSessionWorkspace, async (_event: IpcMainInvokeEvent, sessionId: string, source: unknown) => {
    const previousState = await agentStore.getState()
    const session = await agentIpcHandlers.setSessionWorkspace(
      sessionId,
      source as Parameters<typeof agentIpcHandlers.setSessionWorkspace>[1]
    )
    await syncAgentStateAfterMutation(previousState)
    return session
  })
  ipcMain.handle(IpcChannels.agentsSetSessionWorkspaceByPath, async (_event: IpcMainInvokeEvent, sessionId: string, path: string) => {
    const previousState = await agentStore.getState()
    const session = await agentIpcHandlers.setSessionWorkspaceByPath(sessionId, path)
    await syncAgentStateAfterMutation(previousState)
    return session
  })
  ipcMain.handle(IpcChannels.agentsSwitchSessionPinState, async (_event: IpcMainInvokeEvent, sessionId: string) => {
    const state = await agentIpcHandlers.toggleSessionPin(sessionId)
    getMainWindow()?.webContents.send(IpcChannels.agentsStateChanged, state)
    return state
  })
  ipcMain.handle(IpcChannels.agentsSelectSession, async (_event: IpcMainInvokeEvent, sessionId: string) => {
    const state = await agentIpcHandlers.selectSession(sessionId)
    getMainWindow()?.webContents.send(IpcChannels.agentsStateChanged, state)
    return state
  })
  ipcMain.handle(IpcChannels.agentsClearSessionMessages, async (_event: IpcMainInvokeEvent, sessionId: string) => {
    const state = await agentIpcHandlers.clearSessionMessages(sessionId)
    getMainWindow()?.webContents.send(IpcChannels.agentsStateChanged, state)
    return state
  })
  ipcMain.handle(
    IpcChannels.agentsDeleteSessionMessage,
    async (_event: IpcMainInvokeEvent, sessionId: string, messageId: string) => {
      const state = await agentIpcHandlers.deleteSessionMessage(sessionId, messageId)
      getMainWindow()?.webContents.send(IpcChannels.agentsStateChanged, state)
      return state
    }
  )
  ipcMain.handle(IpcChannels.agentsReplaceState, (_event: IpcMainInvokeEvent, state: AgentStoreState) => replaceAgentState(state))
  ipcMain.handle(IpcChannels.agentsSendMessage, async (_event: IpcMainInvokeEvent, request: AgentChatRuntimeRequest) => {
    const result = await agentIpcHandlers.sendMessage(request)
    getMainWindow()?.webContents.send(IpcChannels.agentsStateChanged, result.state)
    return result
  })
  ipcMain.handle(IpcChannels.agentsCancelMessage, (_event: IpcMainInvokeEvent, runId: string) => agentRuntimeService.cancelMessage(runId))
  ipcMain.handle(IpcChannels.agentsCancelSession, (_event: IpcMainInvokeEvent, sessionId: string) =>
    agentIpcHandlers.cancelSession(sessionId)
  )
  ipcMain.handle(IpcChannels.agentsRefreshMcpTools, async (_event: IpcMainInvokeEvent, serverId: string) =>
    refreshAgentMcpTools(
      {
        getState: () => agentStore.getState(),
        refreshServerTools: mcpRuntimeService.refreshServerTools.bind(mcpRuntimeService),
        replaceAgentState
      },
      serverId
    )
  )
  ipcMain.handle(IpcChannels.agentsSkillsList, async (_event: IpcMainInvokeEvent, query?: { agentId?: string; search?: string }) =>
    skillService.list(await agentStore.getState(), query)
  )
  ipcMain.handle(IpcChannels.agentsSkillsGetRuntime, (_event: IpcMainInvokeEvent, agentId: string) =>
    agentIpcHandlers.getSkillRuntime(agentId)
  )
  ipcMain.handle(IpcChannels.agentsListProductToolPackages, (_event: IpcMainInvokeEvent, agentId: string) =>
    agentIpcHandlers.listProductToolPackages(agentId)
  )
  ipcMain.handle(
    IpcChannels.agentsUpdateProductToolPackageBinding,
    (_event: IpcMainInvokeEvent, agentId: string, productId: string, permissionMode: 'allow-read-only' | 'prompt' | 'disabled') =>
      agentIpcHandlers.updateProductToolPackageBinding(agentId, productId, permissionMode)
  )
  ipcMain.handle(IpcChannels.agentsListProductToolCallTracePage, (_event: IpcMainInvokeEvent, query?: unknown) =>
    agentIpcHandlers.listProductToolCallTracePage(
      (query as Parameters<typeof agentIpcHandlers.listProductToolCallTracePage>[0]) ?? {}
    )
  )
  ipcMain.handle(IpcChannels.agentsGetProductToolCallTrace, (_event: IpcMainInvokeEvent, toolCallId: string) =>
    agentIpcHandlers.getProductToolCallTrace(toolCallId)
  )
  ipcMain.handle(IpcChannels.agentsSkillsSearch, (_event: IpcMainInvokeEvent, query: string) => skillSearchService.search(query))
  ipcMain.handle(IpcChannels.agentsSkillsInstall, async (_event: IpcMainInvokeEvent, options: SkillInstallOptions) => {
    const previousState = await agentStore.getState()
    const result = await skillService.install(previousState, options)
    await replaceAgentStateAfterSkillMutation(previousState, result.state)
    return result.skill
  })
  ipcMain.handle(IpcChannels.agentsSkillsInstallFromZip, async (_event: IpcMainInvokeEvent, options: SkillInstallFromZipOptions) => {
    const previousState = await agentStore.getState()
    const result = await skillService.installFromZip(previousState, options)
    await replaceAgentStateAfterSkillMutation(previousState, result.state)
    return result.skill
  })
  ipcMain.handle(
    IpcChannels.agentsSkillsInstallFromDirectory,
    async (_event: IpcMainInvokeEvent, options: SkillInstallFromDirectoryOptions) => {
      const previousState = await agentStore.getState()
      const result = await skillService.installFromDirectory(previousState, options)
      await replaceAgentStateAfterSkillMutation(previousState, result.state)
      return result.skill
    }
  )
  ipcMain.handle(IpcChannels.agentsSkillsUninstall, async (_event: IpcMainInvokeEvent, skillId: string) => {
    const previousState = await agentStore.getState()
    const nextState = await skillService.uninstall(previousState, skillId)
    await replaceAgentStateAfterSkillMutation(previousState, nextState)
    return true
  })
  ipcMain.handle(IpcChannels.agentsSkillsToggle, async (_event: IpcMainInvokeEvent, options: SkillToggleOptions) => {
    const previousState = await agentStore.getState()
    const result = await skillService.toggle(previousState, options)
    await replaceAgentStateAfterSkillMutation(previousState, result.state)
    return result.skill
  })
  ipcMain.handle(IpcChannels.agentsSkillsReadFile, async (_event: IpcMainInvokeEvent, skillId: string, filename: string) =>
    skillService.readFile(await agentStore.getState(), skillId, filename)
  )
  ipcMain.handle(IpcChannels.agentsSkillsListFiles, async (_event: IpcMainInvokeEvent, skillId: string) =>
    skillService.listFiles(await agentStore.getState(), skillId)
  )
  ipcMain.handle(IpcChannels.agentsSkillsListLocal, (_event: IpcMainInvokeEvent, workdir: string) => skillService.listLocal(workdir))

  ipcMain.handle(IpcChannels.assistantsList, () => assistantIpcHandlers.listAssistants())
  ipcMain.handle(IpcChannels.assistantsGet, (_event: IpcMainInvokeEvent, assistantId: string) =>
    assistantIpcHandlers.getAssistant(assistantId)
  )
  ipcMain.handle(IpcChannels.assistantsCreate, (_event: IpcMainInvokeEvent, input: unknown) =>
    assistantIpcHandlers.createAssistant(input as Parameters<typeof assistantIpcHandlers.createAssistant>[0])
  )
  ipcMain.handle(IpcChannels.assistantsUpdate, (_event: IpcMainInvokeEvent, assistantId: string, patch: unknown) =>
    assistantIpcHandlers.updateAssistant(assistantId, patch as Parameters<typeof assistantIpcHandlers.updateAssistant>[1])
  )
  ipcMain.handle(IpcChannels.assistantsDelete, (_event: IpcMainInvokeEvent, assistantId: string) =>
    assistantIpcHandlers.deleteAssistant(assistantId)
  )
  ipcMain.handle(IpcChannels.assistantsReorder, (_event: IpcMainInvokeEvent, orderedIds: string[]) =>
    assistantIpcHandlers.reorderAssistants(orderedIds)
  )
  ipcMain.handle(
    IpcChannels.assistantsLibraryListTemplates,
    async (_event: IpcMainInvokeEvent, query?: unknown, language?: 'zh-CN' | 'en-US') =>
      assistantIpcHandlers.listAssistantTemplates(
        (query as Parameters<typeof assistantIpcHandlers.listAssistantTemplates>[0]) ?? {},
        language ?? (await settingsStore.get()).language
      )
  )
  ipcMain.handle(
    IpcChannels.assistantsLibraryGetTemplate,
    async (_event: IpcMainInvokeEvent, templateId: string, language?: 'zh-CN' | 'en-US') =>
      assistantIpcHandlers.getAssistantTemplate(templateId, language ?? (await settingsStore.get()).language)
  )
  ipcMain.handle(
    IpcChannels.assistantsLibraryInstallTemplate,
    async (_event: IpcMainInvokeEvent, input: unknown, language?: 'zh-CN' | 'en-US') =>
      assistantIpcHandlers.installAssistantTemplate(
        input as Parameters<typeof assistantIpcHandlers.installAssistantTemplate>[0],
        language ?? (await settingsStore.get()).language
      )
  )
  ipcMain.handle(
    IpcChannels.assistantsLibraryListGroups,
    async (_event: IpcMainInvokeEvent, language?: 'zh-CN' | 'en-US') =>
      assistantIpcHandlers.listAssistantTemplateGroups(language ?? (await settingsStore.get()).language)
  )
  ipcMain.handle(IpcChannels.assistantsLibraryCreateAssistant, (_event: IpcMainInvokeEvent, input: unknown) =>
    assistantIpcHandlers.createAssistantFromLibrary(
      input as Parameters<typeof assistantIpcHandlers.createAssistantFromLibrary>[0]
    )
  )
  ipcMain.handle(IpcChannels.assistantsListTopics, (_event: IpcMainInvokeEvent, query?: unknown) =>
    assistantIpcHandlers.listTopics((query as Parameters<typeof assistantIpcHandlers.listTopics>[0]) ?? {})
  )
  ipcMain.handle(IpcChannels.assistantsCreateTopic, (_event: IpcMainInvokeEvent, input: unknown) =>
    assistantIpcHandlers.createTopic(input as Parameters<typeof assistantIpcHandlers.createTopic>[0])
  )
  ipcMain.handle(IpcChannels.assistantsUpdateTopic, (_event: IpcMainInvokeEvent, topicId: string, patch: unknown) =>
    assistantIpcHandlers.updateTopic(topicId, patch as Parameters<typeof assistantIpcHandlers.updateTopic>[1])
  )
  ipcMain.handle(IpcChannels.assistantsDeleteTopic, (_event: IpcMainInvokeEvent, topicId: string) =>
    assistantIpcHandlers.deleteTopic(topicId)
  )
  ipcMain.handle(IpcChannels.assistantsPinTopic, (_event: IpcMainInvokeEvent, topicId: string) =>
    assistantIpcHandlers.pinTopic(topicId)
  )
  ipcMain.handle(IpcChannels.assistantsUnpinTopic, (_event: IpcMainInvokeEvent, topicId: string) =>
    assistantIpcHandlers.unpinTopic(topicId)
  )
  ipcMain.handle(IpcChannels.assistantsListTopicMessages, (_event: IpcMainInvokeEvent, topicId: string, nodeId?: string | null) =>
    assistantIpcHandlers.listTopicMessages(topicId, nodeId)
  )
  ipcMain.handle(IpcChannels.assistantsSetActiveNode, (_event: IpcMainInvokeEvent, topicId: string, nodeId: string | null) =>
    assistantIpcHandlers.setActiveNode(topicId, nodeId)
  )
  ipcMain.handle(
    IpcChannels.assistantsRenameTopic,
    (_event: IpcMainInvokeEvent, topicId: string, name: string, isNameManuallyEdited?: boolean) =>
      assistantIpcHandlers.renameTopic(topicId, name, isNameManuallyEdited)
  )
  ipcMain.handle(IpcChannels.assistantsCreateMessageSibling, (_event: IpcMainInvokeEvent, messageId: string, dto: unknown) =>
    assistantIpcHandlers.createMessageSibling(messageId, dto as Parameters<typeof assistantIpcHandlers.createMessageSibling>[1])
  )
  ipcMain.handle(IpcChannels.assistantsEditAndResendUserMessage, (_event: IpcMainInvokeEvent, input: unknown) =>
    assistantIpcHandlers.editAndResendUserMessage(
      input as Parameters<typeof assistantIpcHandlers.editAndResendUserMessage>[0]
    )
  )
  ipcMain.handle(IpcChannels.assistantsClearTopicMessages, (_event: IpcMainInvokeEvent, topicId: string) =>
    assistantIpcHandlers.clearTopicMessages(topicId)
  )
  ipcMain.handle(
    IpcChannels.assistantsSearchTopicMessages,
    (_event: IpcMainInvokeEvent, topicId: string, query: string, limit?: number) =>
      assistantIpcHandlers.searchTopicMessages(topicId, query, limit)
  )
  ipcMain.handle(IpcChannels.assistantsDeleteMessage, (_event: IpcMainInvokeEvent, messageId: string, options?: unknown) =>
    assistantIpcHandlers.deleteMessage(messageId, options as Parameters<typeof assistantIpcHandlers.deleteMessage>[1])
  )
  ipcMain.handle(IpcChannels.assistantsStreamOpen, (_event: IpcMainInvokeEvent, request: unknown) =>
    assistantIpcHandlers.streamOpen(request as Parameters<typeof assistantIpcHandlers.streamOpen>[0])
  )
  ipcMain.handle(IpcChannels.assistantsStreamAttach, (_event: IpcMainInvokeEvent, topicId: string) =>
    assistantIpcHandlers.streamAttach(topicId)
  )
  ipcMain.handle(IpcChannels.assistantsStreamAbort, (_event: IpcMainInvokeEvent, topicId: string) =>
    assistantIpcHandlers.streamAbort(topicId)
  )
  ipcMain.handle(IpcChannels.assistantsStreamGetStatus, (_event: IpcMainInvokeEvent, topicId: string) =>
    assistantIpcHandlers.streamGetStatus(topicId)
  )

  configureNotificationRuntime({
    getSettings: async () => (await settingsStore.get()).notifications
  })
  registerNotificationIpcHandlers()
  registerEventBusIpcHandlers()
  registerJobIpcHandlers(ipcMain, jobRunQueryService, jobScheduleQueryService)

  // 产品 IPC 统一入口：renderer 通过 preload.products.invoke 调用
  ipcMain.handle(
    IpcChannels.productIpcInvoke,
    (_event: IpcMainInvokeEvent, productId: string, method: string, payload?: unknown) =>
      productIpcRegistry.invoke(productId, method, payload)
  )
}

async function readTextFilePreview(path: string): Promise<{ path: string; text: string; truncated: boolean }> {
  const trimmedPath = path.trim()
  if (!trimmedPath) throw new Error('File path is required.')

  const info = await stat(trimmedPath)
  if (!info.isFile()) throw new Error('Only files can be attached.')

  const bytesToRead = Math.min(info.size, TEXT_FILE_READ_LIMIT_BYTES)
  const buffer = Buffer.alloc(bytesToRead)
  const file = await open(trimmedPath, 'r')
  try {
    await file.read(buffer, 0, bytesToRead, 0)
    if (isLikelyBinary(buffer)) throw new Error('Binary files are not supported in text attachments yet.')
  } finally {
    await file.close()
  }

  return {
    path: trimmedPath,
    text: buffer.toString('utf8'),
    truncated: info.size > TEXT_FILE_READ_LIMIT_BYTES
  }
}

function isLikelyBinary(buffer: Buffer): boolean {
  const sampleSize = Math.min(buffer.length, 1024)
  for (let index = 0; index < sampleSize; index++) {
    if (buffer[index] === 0) return true
  }
  return false
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

function wireWindowEvents(window: BrowserWindow): void {
  wireRendererSendGuard(window)
  wireRendererProcessDiagnostics(window, { logEvent: rendererProcessLog.write })
  // 自绘标题栏：最大化/还原事实（主窗与独立窗共用同一条广播，见 `window/windowChrome.ts`）
  wireWindowChromeState(window)
  window.on('closed', () => {
    mainWindow = null
  })
}

async function createAndLoadMainWindow(): Promise<void> {
  mainWindow = await createMainWindow()
  wireWindowEvents(mainWindow)
  await loadMainWindowRenderer(mainWindow)
  // workspace：重建的主窗同样要登记并在加载后挂载，否则它的 workspace IPC 会被 not-owner 拒绝
  if (mainWindow) {
    panelWorkspaceForDisposal?.registerMainWindow({ webContentsId: mainWindow.webContents.id })
    panelWorkspaceForDisposal?.attachMainWindow({ webContentsId: mainWindow.webContents.id })
  }
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
  installedProductManifestIds = productManifests.map((manifest) => manifest.id)
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
  const jobRuntime = createJobRuntime({ store: jobRunStore })
  jobRuntimeForDisposal = jobRuntime
  jobRuntime.recover()
  const jobRunQueryService = createJobRunQueryService({ runtime: jobRuntime })
  const jobScheduleQueryService = createJobScheduleQueryService({ runtime: jobRuntime })
  agentTaskJobBridge = createAgentTaskJobBridge({ jobRuntime })
  agentTaskRunController = createAgentTaskRunController({
    jobs: jobRunQueryService,
    jobRuntime
  })
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

  if (!productAcceptanceProfile.enabled) app.on('second-instance', () => {
    const window = getMainWindow()
    if (!window) return
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  })

  await app.whenReady()
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
    isAppQuitting: () => appQuitting
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
      getTimeZone: () => readWorkspaceContextTimeZone(settingsStore, systemTimeZoneSource())
    }
  })
  // 宿主事件/原生关闭/外部销毁的接收方现在才存在：接线后所有宿主回调都回流到 compose
  panelWorkspaceMainHostBridge = panelWorkspace.mainHostBridge
  // PLAT-26：只注册（幂等，不恢复）——7 条受控通道此刻已在 ipcMain 上，随后创建的窗口一被驱动就有 handler
  panelWorkspace.registerChannels()

  mainWindow = await createMainWindow()
  wireWindowEvents(mainWindow)
  tray = createAppTray(getMainWindow)
  await applySessionProxySettings((await settingsStore.get()).network)

  try {
    if (!taskAutomationSmokeProfile.enabled) await options.registerProductServices?.({
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
      platformFetch: getPlatformFetch(),
      secretVault: providerSecretVault,
      registerProductAgentToolHandler,
      registerProductCache,
      registerProductDisposer: productServiceDisposerRegistry.register,
      getAgentState: () => agentStore.getState(),
      createAgentSession: (input) => agentServices.sessions.create(input),
      invokeProductAgentTool: (state, input) => productAgentToolRuntimeService.invokeTool(state, input),
      invokeProductIpc: (productId, method, payload) => productIpcRegistry.invoke(productId, method, payload),
      assistantInvocation: assistantInvocationService
    })
    const productIpcMethods = productIpcRegistry.seal(expectedProductIpcMethods(productManifests))
    if (productAcceptanceProfile.enabled) {
      reportProductAcceptanceRegistration({
        productIds: productManifests.map((manifest) => manifest.id),
        productIpcMethodCount: productIpcMethods.length
      })
    }
  } catch {
    productIpcRegistry.markUnavailable()
    return
  }

  reportPanelWorkspaceStart({ report: await panelWorkspace.start() }) // P1-06h N4：恢复/降级原因必须运行期可观测，启动顺序与 fail-closed 语义不变
  panelWorkspaceForDisposal = panelWorkspace
  /**
   * PLAT-32/S1（PM 裁决②）：OS 外观变化与「设置写入」走**同一条显式通知**。`themeMode==='system'` 时
   * `context.theme` 由 `nativeTheme.shouldUseDarkColors` 解析，用户在系统里切深浅色必须让已分离的页窗/面板窗
   * 跟随（旧实现只是在下一次任意窗口成功读取时顺带转发 ⇒ 读带副作用的副产物）；这里显式通知一次，
   * 通知本身不承载值、绝不 reject，且与设置写入共用同一对账入口（有界、主窗 0 条、无自持环）。
   */
  nativeTheme.on('updated', () => { void panelWorkspaceForDisposal?.notifyPreferencesChanged() })
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
  await agentTaskExecutionCoordinator?.recoverAfterRestart()
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
  disposeTaskAutomationMaintenance = scheduleTaskAutomationMaintenance(taskAutomationMaintenance)
  disposeJobRunRetention = scheduleJobRunRetention(jobRunStore)
  disposeChannelDeliveryMaintenance = channelDeliveryMaintenance.start()
  disposeChannelInboundRecovery = channelInboundExecutionRunner.startRecovery()
  disposeTelegramRuntimeMaintenance = telegramRuntimeMaintenance.start()
  disposeSlackRuntimeMaintenance = slackRuntimeMaintenance.start()
  disposeLarkRuntimeMaintenance = larkRuntimeMaintenance.start()
  disposeQqRuntimeMaintenance = qqRuntimeMaintenance.start()
  disposeDiscordRuntimeMaintenance = discordRuntimeMaintenance.start()
  disposeWechatRuntimeMaintenance = wechatRuntimeMaintenance.start()
  syncProductToolsRuntimeFromState(await agentStore.getState())
  mcpRuntimeService.syncFromState(await agentStore.getState())
  agentTaskSchedulerRuntimeService.syncFromState(await agentStore.getState())
  agentTaskSchedulerRuntimeService.start()
  agentRuntimeService.subscribe((snapshot) => {
    getMainWindow()?.webContents.send(IpcChannels.agentsRuntimeStateChanged, snapshot)
  })
  buildAppMenu(getMainWindow)
  await loadMainWindowRenderer(mainWindow)
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
app.on('before-quit', (event) => {
  appQuitting = true
  if (platformRuntimesDisposed || quitDisposeSettled) return
  event.preventDefault()
  if (quitDisposeStarted) return
  quitDisposeStarted = true
  let released = false
  const releaseQuit = (): void => {
    if (released) return
    released = true
    quitDisposeSettled = true
    app.quit()
  }
  const escape = setTimeout(releaseQuit, QUIT_DISPOSE_BUDGET_MS)
  ;(escape as unknown as { unref?: () => void }).unref?.()
  void disposePlatformRuntimes()
    .catch(() => undefined)
    .finally(() => { clearTimeout(escape); releaseQuit() })
})

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
