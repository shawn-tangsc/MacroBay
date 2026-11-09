import type { BrowserWindow } from 'electron'

import { processBootId } from '../processBootId'

import { ClaudeCodeRuntimeDriver } from '../../../ai/agent-platform/runtime/drivers/claudeCode'
import type { AgentTaskSchedulerRuntimeService } from '../../../ai/agent-platform/runtime/tasks'
import { mergeAgentRuntimeSessionState, type AgentStoreState } from '../../../ai/agent-platform/store/agentStore'
import { buildAgentSkillsRuntimeCatalog } from '../../../ai/agent-platform/skills/skillRuntimeInspector'
import {
  buildProductAgentToolPackageEditorView,
  upsertAgentProductToolPackageBinding
} from '../../../ai/agent-platform/productTools'
import { createAssistantChatRuntimeService } from '../../../ai/assistant-platform/runtime/AssistantChatRuntimeService'
import { AssistantTemplateRegistry } from '../../../ai/assistant-platform/library/AssistantTemplateRegistry'
import { getNotificationRuntime } from '../../../notifications/ipc/registerNotificationIpc'
import { AssistantLibraryService } from '../../../ai/assistant-platform/library/AssistantLibraryService'
import { platformAssistantTemplates } from '../../../ai/assistant-platform/library/platformAssistantTemplates'
import { AssistantTopicNamingService } from '../../../ai/assistant-platform/naming/AssistantTopicNamingService'
import {
  buildDefaultAssistantLocalizationPatch,
  createDefaultAssistantSeed
} from '../../../ai/assistant-platform/seeds/defaultAssistantSeed'
import type { createWebSearchService } from '../../../ai/web-search/runtime/WebSearchService'
import { getPlatformFetch } from '../../../network/platformFetch'
import type { createAgentModelCompatibilityControl } from '../agentModelCompatibility/createAgentModelCompatibilityControl'
import type { createAgentModelRuntimeProbeService } from '../agentModelCompatibility/AgentModelRuntimeProbeService'
import type { createAgentRuntimeProbeSnapshotStore } from '../agentModelCompatibility/AgentRuntimeProbeSnapshotStore'
import type { createProviderRuntimeCheckService } from '../agentModelCompatibility/ProviderRuntimeCheckService'
import type { createAgentModelGatewayService } from '../agentModelGateway/AgentModelGatewayService'
import { createAgentIpcHandlers } from '../agentIpcHandlers'
import { createAssistantIpcHandlers } from '../assistantIpcHandlers'
import { createAssistantStreamSink } from '../assistantStreamBroadcast'
import { createTaskAutomationSmokeDriver } from '../taskAutomationSmokeFixture'
import type { configureTaskAutomationSmokeProfile } from '../taskAutomationSmokeProfile'
import { createWorkspaceTestStreamDriver, installWorkspaceTestFixtureHandle, type resolveWorkspaceTestFixtures } from '../workspaceTestFixtures'
import {
  createClaudeAgentSdkRuntime,
  createClaudeCodeRuntimeDriverDependencies,
  createClaudeSdkPreferredExecutor
} from '../claudeCodeRuntimeDependencies'

import { replaceAgentStateForConstruction } from './agentStateBridge'
import type { AgentBroadcasts } from './agentBroadcast'
import type { createAgentRuntime } from './agentRuntime'
import type { createChannelsAndJobs } from './channelsAndJobs'
import type { createPlatformCore } from './platformCore'
import type { createRepositories } from './repositories'
import { getAgentTaskExecutionCoordinator, getAgentTaskRunController, getInstalledProductManifestIds } from './slots'

/**
 * 助手与智能体运行时驱动的构造（web search bridge、claude 运行时、agent handler、助手服务/handler）。
 *
 * **这一片只搬构造**：运行时驱动注册、助手服务与它们的 IPC handler 在这里建好并交回 `app.ts`；
 * 退出链和槽位持有者一个字没动（`agentRuntimeService` / `agentTaskExecutionCoordinator` 等仍在
 * `app.ts` 的受保护区或 `slots` 里）。
 *
 * 逐条写清「什么时候读」，因为这些读法原来只隐含在 `app.ts` 的位置里：
 *
 * | 端口 | 什么时候读 | 为什么是这个时机 |
 * |---|---|---|
 * | `agentRuntimeService` | 驱动发 chunk、请求工具批准时 | 与智能体线是**同一个实例**，不是各建一个 |
 * | `agentBroadcasts` | 每次状态替换后 | 发送那一刻现取主窗，持有旧引用会发进死窗 |
 * | `agentModelCompatibilityControl` | handler 组装时 | 兼容性控制只有一个实例，两处各建会各判一套 |
 * | `webSearchService` | 每次出网资格判断/搜索时 | 设置可变，快照会读到旧开关 |
 * | `agentTaskSchedulerRuntimeService` | 会话状态替换后同步 | 调度器只有一个，切片不另起 |
 * | `workspaceTestFixtures` / `taskAutomationSmokeProfile` | 构造期选驱动 | 这是测试/烟测的接缝开关，只在注册驱动时读一次 |
 *
 * 一条**不许在这里判断**的事：会话文本怎么合并由 `mergeAgentRuntimeSessionState`（存储层）判，
 * 这里只负责在替换后按顺序同步技能、产品工具、MCP、调度与广播——顺序乱了会漏一次同步。
 */
export type AssistantsAndRuntimesPorts = Readonly<{
  core: ReturnType<typeof createPlatformCore>
  repositories: ReturnType<typeof createRepositories>
  agentRuntime: ReturnType<typeof createAgentRuntime>
  channelsAndJobs: ReturnType<typeof createChannelsAndJobs>
  agentModelGatewayService: ReturnType<typeof createAgentModelGatewayService>
  agentRuntimeProbeSnapshotStore: ReturnType<typeof createAgentRuntimeProbeSnapshotStore>
  providerRuntimeCheckService: ReturnType<typeof createProviderRuntimeCheckService>
  webSearchService: ReturnType<typeof createWebSearchService>
  agentModelCompatibilityControl: ReturnType<typeof createAgentModelCompatibilityControl>
  agentTaskSchedulerRuntimeService: InstanceType<typeof AgentTaskSchedulerRuntimeService>
  agentBroadcasts: AgentBroadcasts
  getMainWindow: () => BrowserWindow | null
  syncSkillsRuntimeFromState: (state: AgentStoreState) => void
  syncProductToolsRuntimeFromState: (state: AgentStoreState) => void
  workspaceTestFixtures: ReturnType<typeof resolveWorkspaceTestFixtures>
  taskAutomationSmokeProfile: ReturnType<typeof configureTaskAutomationSmokeProfile>
}>

export type AssistantsAndRuntimes = Readonly<{
  agentIpcHandlers: ReturnType<typeof createAgentIpcHandlers>
  assistantIpcHandlers: ReturnType<typeof createAssistantIpcHandlers>
  assistantChatRuntime: ReturnType<typeof createAssistantChatRuntimeService>
  assistantTemplateRegistry: AssistantTemplateRegistry
  ensureDefaultAssistantSeed: () => Promise<void>
  isAgentWebSearchProviderReady: () => Promise<boolean>
}>

export function createAssistantsAndRuntimes(ports: AssistantsAndRuntimesPorts): AssistantsAndRuntimes {
  const { settingsStore, providerStore, appLog } = ports.core
  const { agentStore, agentRepositories, assistantRepositories, agentServices } = ports.repositories
  const {
    skillsRuntimeService,
    agentSystemWorkspacesRoot,
    runtimeDriverRegistry,
    productAgentToolRegistry,
    productAgentToolRuntimeService,
    taskManagementToolRuntimeService,
    mcpRuntimeService,
    agentRuntimeService,
    agentRuntimeCompositionService
  } = ports.agentRuntime
  const { channelRuntimeSupervisor, deliverTaskResultToChannels } = ports.channelsAndJobs
  const {
    agentModelGatewayService,
    agentRuntimeProbeSnapshotStore,
    providerRuntimeCheckService,
    webSearchService,
    agentModelCompatibilityControl,
    agentTaskSchedulerRuntimeService,
    agentBroadcasts,
    getMainWindow,
    syncSkillsRuntimeFromState,
    syncProductToolsRuntimeFromState,
    workspaceTestFixtures,
    taskAutomationSmokeProfile
  } = ports

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
    ownerBootId: processBootId,
    getProviderState: providerStore.getState,
    getAgentState: () => agentStore.getState(),
    saveAgentState: async (state, options) => {
      if (options?.mergeSessionId) {
        await mergeAndReplaceAgentSessionState(state, options.mergeSessionId)
        return
      }
      await replaceAgentStateForConstruction(state)
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
        await replaceAgentStateForConstruction(state)
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
    // 凭据判定信号：进程级依赖，**只在这里注入一次**（AI 运行时不许 import 通知包）。
    // 请求路径上不携带；翻转去重交给 `reportProviderCredential` 自己的 changed。
    // 名字在组合根取：通知那边只有 id，且**不许印 id**。取不到名字就不发（返回 undefined 即可），
    // 这一层不编「未知」，也不建第二份 id→名字的映射。
    onProviderCredentialSignal: async (input) => {
      const providerName = (await providerStore.getState()).providers.find(
        (provider) => provider.id === input.providerId
      )?.name
      await getNotificationRuntime().reportProviderCredential({ ...input, providerName })
    },
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
    // 这里不再出现任何一个 assistantsStream* 的名字。
    // 传 thunk 而不是引用：主窗可在运行中被销毁重建，发送那一刻取窗口才是对的。
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

  return {
    agentIpcHandlers,
    assistantIpcHandlers,
    assistantChatRuntime,
    assistantTemplateRegistry,
    ensureDefaultAssistantSeed,
    isAgentWebSearchProviderReady
  }
}
