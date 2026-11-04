import {
  ChannelDeliveryMaintenance,
  ChannelDeliveryService,
  ChannelDeliveryTransportRouter,
  ChannelDispatchRunRepository,
  ChannelInboundExecutionCoordinator,
  ChannelInboundExecutionRunner,
  ChannelInboundService,
  ChannelRuntimeSupervisor,
  DiscordDeliveryTransport,
  DiscordRuntimeMaintenance,
  DiscordRuntimeManager,
  LarkDeliveryTransport,
  LarkRuntimeMaintenance,
  LarkRuntimeManager,
  QqDeliveryTransport,
  QqRuntimeMaintenance,
  QqRuntimeManager,
  SlackDeliveryTransport,
  SlackRuntimeMaintenance,
  SlackRuntimeManager,
  TelegramDeliveryTransport,
  TelegramRuntimeMaintenance,
  TelegramRuntimeManager,
  WechatDeliveryTransport,
  WechatRuntimeMaintenance,
  WechatRuntimeManager,
  createChannelInboundContentGuard
} from '../../../ai/agent-platform/channels'
import { recordRuntimeLifecycle } from '../../../ai/agent-platform/channels/channelRuntimeLifecycle'
import { recordRuntimeAudit } from '../../../ai/agent-platform/channels/channelRuntimeAuditRetention'
import { isChannelRuntimeFailureMirrorCode, mirrorRuntimeFailure } from '../../../ai/agent-platform/channels/channelRuntimeFailureMirror'
import { getPlatformFetch } from '../../../network/platformFetch'
import { createPlatformWebSocketFactory } from '../../../network/platformWebSocket'
import { createTaskAutomationMaintenance } from '../taskAutomationMaintenance'
import { createTaskChannelDelivery } from '../taskChannelDelivery'

import type { AgentBroadcasts } from './agentBroadcast'
import type { createAgentRuntime } from './agentRuntime'
import type { createPlatformCore } from './platformCore'
import type { createRepositories } from './repositories'

/**
 * 通道与任务作业的构造（6 个 adapter、投递、入站执行、维护作业）。
 *
 * **这一片只搬构造，不搬退出链**：`markClosed → flush 布局 → 8 个维护定时器 → 6 个 adapter
 * dispose → fenceAllForQuit → jobs stopAll` 是一条跨域链，顺序错了会在退出瞬间静默出错
 * （定时器 teardown 期又跑一次、fence 之后 adapter 还写一次），而全量测试看不见——所以它整条
 * 留在 `app.ts` 的 `createRuntimeDisposer` 里，这里只交出它要用的对象。
 *
 * 逐条写清「什么时候读」，因为这些读法原来只隐含在 `app.ts` 的位置里：
 *
 * | 端口 | 什么时候读 | 为什么是这个时机 |
 * |---|---|---|
 * | `settingsStore` | 每次投递失败取文案、每次读网络设置 | 切语言/改代理立刻生效，快照会读到上一版 |
 * | `agentBroadcasts` | 每次广播运行时快照前 | 主窗可被销毁重建，由它按发送那一刻现取 |
 * | `getPlatformFetch` | 每个 adapter 出网时 | 代理设置可变，取一次会绕过之后改的代理 |
 * | `agentServices` / `agentStore` | 建立会话、读会话消息时 | 与智能体线共用同一份存储，不另开实例 |
 * | `agentDatabase` | 构造派发运行时仓库时 | 与智能体共用同一个 SQLite 句柄 |
 *
 * 一条**不许在这里判断**的事：哪个 adapter 能启用由 `channelAdapterRegistry`（构造根）判，
 * 这里只在启动恢复时按库里的 active 行起停，不自己拍证据。
 */
export type ChannelsAndJobsPorts = Readonly<{
  settingsStore: ReturnType<typeof createPlatformCore>['settingsStore']
  /** 三条状态广播的唯一出口；发送那一刻才去取主窗。 */
  agentBroadcasts: AgentBroadcasts
  /** 入站消息要推进的那台运行时；与智能体线共用同一实例，不另建。 */
  agentRuntimeService: ReturnType<typeof createAgentRuntime>['agentRuntimeService']
  repositories: Pick<
    ReturnType<typeof createRepositories>,
    | 'agentDatabase'
    | 'agentRepositories'
    | 'agentServices'
    | 'agentStore'
    | 'channelInboundRepository'
    | 'channelDeliveryRepository'
    | 'channelManagementRepository'
    | 'channelCredentialVault'
    | 'channelManagementService'
    | 'telegramOffsetRepository'
    | 'slackRuntimeRepository'
    | 'larkRuntimeRepository'
    | 'qqRuntimeRepository'
    | 'discordRuntimeRepository'
    | 'wechatEnrollmentRepository'
    | 'wechatRuntimeRepository'
  >
}>

export function createChannelsAndJobs(ports: ChannelsAndJobsPorts) {
  const { settingsStore, agentBroadcasts, agentRuntimeService } = ports
  const {
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
  } = ports.repositories

  function broadcastChannelRuntimeSnapshot(snapshot: ReturnType<ChannelRuntimeSupervisor['snapshot']>): void {
    agentBroadcasts.channelRuntimeStateChanged(snapshot)
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
  // 设置页「发一条测试消息」要走真投递：装在这儿而不是 app.ts（那是只减不增的基线文件）。
  channelManagementService.setDelivery(channelDeliveryService)
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
    // Untrusted external text is wrapped and narrowly screened before it is encrypted and stored.
    contentGuard: createChannelInboundContentGuard({
      channelTypeForChannel: (channelId) => channelManagementRepository.channelType(channelId)
    }),
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
      channelManagementRepository.ownsLifecycleOwner(channelId, { token, purpose: 'restart', generation }),
    // 起/停各一条进运行审计表：面板的「状态变化」就靠它，失败仍走已有异常码。
    recordLifecycle: (channelId, generation, state) => recordRuntimeLifecycle(agentDatabase, channelId, state, generation),
    // 起不来时把**具体原因**写进同一张表：面板读得到，用户不用再对着一句「网络连不通」猜。
    recordFailure: (channelId, generation, reason) => {
      if (isChannelRuntimeFailureMirrorCode(reason)) mirrorRuntimeFailure(agentDatabase, channelId, generation, reason, new Date())
    },
    // 轮询宿主退出也留一行：静默退出会让用户完全看不出为什么没反应。
    recordExit: (channelId, generation, code) => {
      if (code === 'channel-stale-generation') recordRuntimeAudit(agentDatabase, channelId, generation, code, new Date())
    }
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
      channelManagementRepository.ownsLifecycleOwner(channelId, { token, purpose: 'restart', generation }),
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
      channelManagementRepository.ownsLifecycleOwner(channelId, { token, purpose: 'restart', generation }),
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
      channelManagementRepository.ownsLifecycleOwner(channelId, { token, purpose: 'restart', generation }),
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
      channelManagementRepository.ownsLifecycleOwner(channelId, { token, purpose: 'restart', generation }),
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
  return {
    channelRuntimeSupervisor,
    channelInboundService,
    channelInboundExecutionRunner,
    channelDeliveryService,
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
  }
}
