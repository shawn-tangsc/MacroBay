import { app, protocol, safeStorage, session } from 'electron'
import { join } from 'node:path'
import type { AgentStoreState } from '../../../ai/agent-platform/store/agentStore'
import { ChannelInboundRepository, ChannelDeliveryRepository, ChannelAdapterAcceptanceRegistry, ChannelAcceptanceService, ChannelManagementRepository, ChannelManagementService, ChannelSecureHandoff, TelegramOffsetRepository, SlackRuntimeRepository, LarkRuntimeRepository, QqRuntimeRepository, DiscordRuntimeRepository, WechatEnrollmentRepository, WechatRuntimeRepository } from '../../../ai/agent-platform/channels'
import { createElectronChannelCredentialVault } from '../../../secrets/channels'
import { createAssistantImageMessageService } from '../../../ai/assistant-platform/images/assistantImageMessageService'
import { createGeneratedImageStorage } from '../../../storage/generatedImageStorage'
import { registerGeneratedImageScheme } from '../generatedImageProtocol'
import { createAgentPlatformServices } from '../../../ai/agent-platform/services'
import { createAgentPlatformDatabase } from '../../../ai/agent-platform/db/createAgentPlatformDatabase'
import { createAssistantPlatformDatabase } from '../../../ai/assistant-platform/db/createAssistantPlatformDatabase'
import { createAssistantPlatformRepositories } from '../../../ai/assistant-platform/repositories/createAssistantPlatformRepositories'
import { createChannelSmokeRouter } from '../../../ai/agent-platform/channels/channelSmokeEnable'
import { createDiscordChannelSmoke } from '../../../ai/agent-platform/channels/discord/discordChannelSmoke'
import { createQqChannelSmoke } from '../../../ai/agent-platform/channels/qq/qqChannelSmoke'
import { createSlackChannelSmoke } from '../../../ai/agent-platform/channels/slack/slackChannelSmoke'
import { createTelegramChannelSmoke } from '../../../ai/agent-platform/channels/telegram/telegramChannelSmoke'
import { reconcileSingleEnabledChannel } from '../../../ai/agent-platform/channels/singleEnabledChannel'
import { describeActiveProxy } from '../../../network/activeProxyState'
import { getPlatformFetch } from '../../../network/platformFetch'
import { createAgentPlatformRepositories } from '../../../ai/agent-platform/repositories/createAgentPlatformRepositories'
import { createAgentSqliteStoreWithOptions } from '../../../ai/agent-platform/store/agentSqliteStore'
import { processBootId } from '../processBootId'
import { createDefaultAgentPersistentState } from '../../../ai/agent-platform/store/agentPersistentStore'
import { testModelProviderConnection } from '../../../ai/providers/providerConnection'
import { createInUseModelPatrolRuntime } from '../../../ai/providers/inUseModelPatrolRuntime'
import { createJsonFileStorage } from '../../../storage/jsonFileStorage'
import { createJobRunSqliteStore } from '../../../jobs'
import { createWorkspaceTestFixtureAgentSeed } from '../workspaceTestFixtures'
import { createTaskAutomationSmokeSeed } from '../taskAutomationSmokeFixture'

import type { createPlatformCore } from './platformCore'

export type RepositoriesPorts = Readonly<{
  userDataPath: string
  core: ReturnType<typeof createPlatformCore>
  /** 受保护区里的验收画像开关：构造期要读，按「没有时机语义的可变输入」从端口进。 */
  taskAutomationSmokeProfile: { enabled: boolean }
}>

export function createRepositories(ports: RepositoriesPorts) {
  const { userDataPath, core, taskAutomationSmokeProfile } = ports
  const { settingsStore, providerStore, workspaceTestFixtures, shellTimeZone } = core

const legacyAgentStorage = createJsonFileStorage<AgentStoreState>(
  join(userDataPath, 'platform', 'agents.json'),
  createDefaultAgentPersistentState()
)
const agentDatabase = createAgentPlatformDatabase(join(userDataPath, 'platform', 'agents.sqlite'))
const assistantDatabase = createAssistantPlatformDatabase(join(userDataPath, 'platform', 'assistants.sqlite'))
const agentRepositories = createAgentPlatformRepositories(agentDatabase, { bootId: processBootId })
const assistantRepositories = createAssistantPlatformRepositories(assistantDatabase, { bootId: processBootId })
/**
 * T1/T2：生成图片落 `userData/generated-images/`（文件名 = 内容 hash），消息只存引用；
 * 渲染层通过 `app-image://generated-images/<hash>.<ext>` 读图（协议见 generatedImageProtocol.ts）。
 */
const generatedImagesDirectory = join(userDataPath, 'generated-images')
const generatedImageStorage = createGeneratedImageStorage({ directory: generatedImagesDirectory })
const assistantImageMessages = createAssistantImageMessageService({
  repositories: assistantRepositories,
  storage: generatedImageStorage
})
// 特权 scheme 必须在 app ready 之前注册（window 创建后只做 protocol.handle）。
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
const jobRunStore = createJobRunSqliteStore(join(userDataPath, 'platform', 'jobs.sqlite'))
const channelCredentialVault = createElectronChannelCredentialVault({
  directory: join(userDataPath, 'platform', 'channel-secrets'),
  safeStorage
})
const channelManagementService = new ChannelManagementService({
  repository: channelManagementRepository,
  vault: channelCredentialVault,
  cipher: channelCredentialVault.payloadCipher,
  registry: channelAdapterRegistry,
  acceptance: channelAcceptance,
  handoff: new ChannelSecureHandoff(),
  // 单频道不变量：启动时把历史遗留的「多条启用」收口成一条（保留最近启用的那条）。
  singleEnabledChannel: (now) => reconcileSingleEnabledChannel(agentDatabase, now),
  // 用户点「启用」时现场自检：握手 + 一次接收往返（够证明 token、网络与代理都通），
  // 通过才在这条通道上启用；平台的七项真机验收照旧决定「对外是否声明支持」。
  // 实现在 `telegramChannelSmoke`：它有独立用例，免得「长轮询套短超时」这种必失败写法再躲进来。
  smoke: createChannelSmokeRouter({
    telegram: createTelegramChannelSmoke({
      credentialMetadata: (id) => channelManagementRepository.credentialMetadata(id),
      readSecret: (ref) => channelCredentialVault.get(ref),
      getPlatformFetch,
      // 失败时把「实际生效的代理」记进审计：这是唯一能把「代理没生效」与「代理连不上」分开的事实。
      describeProxy: describeActiveProxy,
      fetchKind: 'net'
    }),
    // Slack 两把凭据各证一件事：auth.test 证 Bot Token，apps.connections.open 证 App Token 与 Socket Mode。
    slack: createSlackChannelSmoke({
      credentialMetadata: (id) => channelManagementRepository.credentialMetadata(id),
      readSecret: (ref) => channelCredentialVault.get(ref),
      getPlatformFetch,
      describeProxy: describeActiveProxy,
      fetchKind: 'net'
    }),
    // Discord 一次 `/users/@me` 同时证明凭据活着、出网通、bot 存在。
    discord: createDiscordChannelSmoke({
      credentialMetadata: (id) => channelManagementRepository.credentialMetadata(id),
      readSecret: (ref) => channelCredentialVault.get(ref),
      getPlatformFetch,
      describeProxy: describeActiveProxy,
      fetchKind: 'net'
    }),
    // QQ 两步：换 access token（证凭据活）+ 取网关地址（证 token 能用、出网通）。
    qq: createQqChannelSmoke({
      credentialMetadata: (id) => channelManagementRepository.credentialMetadata(id),
      readSecret: (ref) => channelCredentialVault.get(ref),
      getPlatformFetch,
      describeProxy: describeActiveProxy,
      fetchKind: 'net'
    })
  })
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

const inUseModelPatrol = createInUseModelPatrolRuntime({
    listProviders: async () => (await providerStore.getState()).providers,
    loadAgentModelIds: async () => {
      const state = await agentStore.getState()
      return state.agents.flatMap((agent) =>
        [agent.model, agent.planModel, agent.smallModel].filter(
          (id): id is string => typeof id === 'string' && id.length > 0
        )
      )
    },
    configuredDefaultModelIds: async () =>
      Object.values((await settingsStore.get()).modelDefaults).filter(
        (value) => typeof value === 'string' && value.trim().length > 0
      ),
    testConnection: async (providerId, modelId) => {
      const provider = await providerStore.resolveRuntimeProvider(providerId)
      if (!provider) return null
      return testModelProviderConnection(provider, { modelId, fetch: getPlatformFetch() })
    }
})
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
    hasEnabledDeliveryTarget: (channelId, agentId) => channelDeliveryRepository.hasEnabledTarget(channelId, agentId),
    // 任务排期与「下次运行」都跟设置时区走；改时区当场生效，不等重启。
    timeZone: () => shellTimeZone.get()
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
    messages: {
      listByCursor: agentRepositories.messages.listByCursor
    },
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

  return {
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
  }
}
