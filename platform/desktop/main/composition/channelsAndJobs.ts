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
import { channelConversationTitle } from '../../../ai/agent-platform/channels/channelConversationName'
import { channelAdapterDescriptor } from '../../../ai/agent-platform/channels/channelAdapterDescriptors'
import { autoBindDeliveryTarget } from '../../../ai/agent-platform/channels/channelAutoTargetBinding'
import {
  readChannelConversationSession,
  touchChannelConversation
} from '../../../ai/agent-platform/channels/channelConversationBindings'
import { selectAgentSession } from '../../../ai/agent-platform/store/agentStore'
import { getNotificationRuntime } from '../../../notifications/ipc/registerNotificationIpc'
import { notifyChannelConnectionLost } from '../../../notifications/producers/channelConnectionLost'
import type { NotificationSubmitOutcome, NotificationSubmitRequest } from '../../../notifications/contracts/notificationContracts'
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
  /**
   * 平台核心（与 `agentRuntime` / `assistantsAndRuntimes` 同一个口）：设置、时区、**日志写入器**都从这里取。
   * 用整块 core 而不是逐个字段，是因为这条事件的失败留痕要写 `app.log`，而 `app.ts` 是受保护接缝，
   * 不该为一条通知再长长——频道自己的装配留在频道自己的分片里。
   */
  core: ReturnType<typeof createPlatformCore>
  /** 三条状态广播的唯一出口；发送那一刻才去取主窗。 */
  agentBroadcasts: AgentBroadcasts
  /** 入站消息要推进的那台运行时；与智能体线共用同一实例，不另建。 */
  agentRuntimeService: ReturnType<typeof createAgentRuntime>['agentRuntimeService']
  /**
   * 通知提交口（P8「频道连不上」用）。缺省就是主进程那个通知运行时——**调用时才解析**，
   * 因为它晚于这里构造。留成可选口只为一个理由：单独测这一片时能换成假的。
   */
  submitNotification?: (request: NotificationSubmitRequest) => Promise<NotificationSubmitOutcome>
  /** 日志口（缺省是主进程唯一写入器）。同样是「留个口子好测」，不为别的。 */
  log?: (level: 'info' | 'warn' | 'error', event: string, fields?: Record<string, unknown>) => void
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
  const { core, agentBroadcasts, agentRuntimeService } = ports
  const { settingsStore, appLog } = core
  // P8 的两根线在这里收口：`app.ts` 是受保护接缝，不该因为多一条事件就长长——频道自己的装配
  // 留在频道自己的组合分片里，`app.ts` 只留一次调用。
  const submitNotification = ports.submitNotification ??
    ((request: NotificationSubmitRequest) => getNotificationRuntime().submit(request))
  const log = ports.log ?? appLog.log
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
    // 同一个运行时实例：通道分发前会把这个会话标成「手机通道」，工具审批不进卡片队列。
    runtime: agentRuntimeService,
    runs: channelDispatchRuns,
    failureText: async (kind, reason) => {
      const language = (await settingsStore.get()).language
      if (kind === 'run-interrupted') {
        return language === 'zh-CN' ? '上一条消息处理被中断，请重新发送。' : 'The previous request was interrupted. Please send it again.'
      }
      // 真实原因说到手机上：读者不该只看到「处理失败」这种套话。
      const zh: Record<string, string> = {
        'dispatch-session-agent-mismatch': '这个对话绑的会话还属上一个助手，下一条消息会自动换过来。',
        'dispatch-session-missing': '这个对话的会话不在了，下一条消息会重新建一个。',
        'dispatch-model-missing': '这个助手还没配置可用的模型，先在设置里配好再发。',
        'dispatch-quota-exhausted': '模型额度用尽了，今天暂时发不出去。',
        'dispatch-network-unavailable': '模型服务连不上，稍后再试一次。',
        'dispatch-payload-invalid': '这条消息没能解开，重新发一次试试。',
        'dispatch-conversation-unbound': '这个对话还没绑定好，重新发一次试试。'
      }
      const en: Record<string, string> = {
        'dispatch-session-agent-mismatch': 'this conversation still uses the session of the previous assistant; the next message switches it.',
        'dispatch-session-missing': 'the session for this conversation is gone; the next message creates a new one.',
        'dispatch-model-missing': 'this assistant has no usable model yet; set one up first.',
        'dispatch-quota-exhausted': 'the model quota is used up, so it cannot answer today.',
        'dispatch-network-unavailable': 'the model service cannot be reached; try again shortly.',
        'dispatch-payload-invalid': 'this message could not be decoded; send it again.',
        'dispatch-conversation-unbound': 'this conversation is not bound yet; send again.'
      }
      const table = language === 'zh-CN' ? zh : en
      // 查不到就**如实说「原因没有记录下来」**：兜底句只承认兜底，不冒充解释。
      if (reason && table[reason]) return table[reason]
      return language === 'zh-CN'
        ? '处理失败：具体原因没有记录下来，请稍后重试。'
        : 'The request failed and the reason was not recorded. Please try again later.'
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
      // 会话名要能认出「来自哪个平台、哪个人」：平台名只从目录表取，拼接处不写字面量。
      createForConversation: async (input) => {
        // 名字由入站服务通过 `conversationTitle` 算好并落库；这里只负责用它创建会话。
        const name = input.title
        return (await agentServices.sessions.create({ agentId: input.agentId, name, workspace: { type: 'system' } })).id
      },
      discardUnbound: async (sessionId) => { await agentServices.sessions.delete(sessionId) },
      exists: async (sessionId) => Boolean(await agentServices.sessions.get(sessionId)),
      // 读者改过频道的助手后，旧会话属于上一个助手：这种绑定要按「未绑定」重建，
      // 否则运行时会在第一毫秒抛「会话不属于这个助手」，用户只看到一句「处理失败」。
      belongsToAgent: async (sessionId, agentId) => (await agentServices.sessions.get(sessionId))?.agentId === agentId
    },
    // Untrusted external text is wrapped and narrowly screened before it is encrypted and stored.
    contentGuard: createChannelInboundContentGuard({
      channelTypeForChannel: (channelId) => channelManagementRepository.channelType(channelId)
    }),
    onInitialClaimAvailable: (dispatchId) => channelInboundExecutionRunner.onInitialClaim(channelInboundService, dispatchId),
    // 「打开这条频道的会话」：会话 id 只在主进程里查、只用一次，渲染层拿不到（见 channelConversationBindings）。
    conversationSessionId: ({ channelId, conversationId }) =>
      readChannelConversationSession(agentDatabase, { channelId, conversationId }),
    // 会话线没有「按会话选中」的服务方法（只有 IPC handler 里那一行）：这里复用同一个纯函数与
    // 同一个 store 写口，没有第二套状态机。等他们开一个 `AgentSessionService.select(sessionId)`
    // 就换成调它（已报，不在本笔越线改）。
    selectSession: async (sessionId) => {
      await agentServices.state.update((state) => selectAgentSession(state, sessionId), { activeSelectionRowOnly: true })
    },
    // 会话名的拼装：平台名只从目录表取，语言跟界面走；算出来的名字会落到会话行上。
    conversationTitle: async (suggestion) => {
      const language = (await settingsStore.get()).language
      const type = channelManagementRepository.channelType(suggestion.channelId)
      const adapter = type === 'feishu' ? 'lark' : type ?? 'telegram'
      return channelConversationTitle({
        adapter,
        language,
        ...(suggestion.displayLabel ? { displayLabel: suggestion.displayLabel } : {}),
        providerConversationKey: suggestion.providerConversationKey,
        disambiguate: suggestion.disambiguate
      })
    },
    // 未授权会话的拒绝句：只有「你没有权限」这一句，不写频道 id / 管理员 / 配置。
    deniedReplyText: async () => (await settingsStore.get()).language === 'zh-CN'
      ? '你没有权限使用这个机器人，请联系管理员开放访问。'
      : "You don't have permission to use this bot. Ask the administrator to grant access.",
    // 入站消息到达且这条频道还没有投递目标时，自动把它记成唯一目标（不覆盖已有绑定）。
    bindAutoTarget: ({ channelId, conversationId }) => {
      autoBindDeliveryTarget(agentDatabase, { channelId, conversationId, now: new Date() })
    },
    // 同一刻刷新这条对话的「最近活跃」：只有时间，不动键/会话/名字。
    touchConversation: ({ channelId, conversationId, now }) => {
      touchChannelConversation(agentDatabase, { channelId, conversationId, now })
    }
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
    },
    // 自动重连连续失败 → 一条「频道连不上」（契约 §4.1 P8）。断的是**收**，与 P6a「发不出去」不是一条。
    // 频道名现取：读者改过名字就该按新名字说；读不到时退回平台显示名，正文里绝不出现频道 id。
    reportConnectionLost: ({ channelId, cause, disconnectedAt }) => {
      // 这是**发出去就不等**的一笔（断线判定不能等通知落盘）；但一个裸 rejection 在主进程里会升级成
      // 退出，而「通知发不出去」绝不能把整个应用带走，所以最外层自己兜住。
      void (async () => {
        try {
          const name = channelManagementRepository.query.get(channelId)?.name ?? null
          const language = (await settingsStore.get()).language
          await notifyChannelConnectionLost(submitNotification, {
            channelId,
            channelName: name ?? channelAdapterDescriptor('telegram').displayName[language],
            cause,
            disconnectedAt,
            occurredAt: new Date().toISOString()
          })
        } catch (error) {
          // 「不把应用带走」不等于「不留痕」（2026-11-04 立的规矩：失败不许静默）。最可能的失败是
          // 提交被拒（unknown-event-type / 批准表不匹配 / bodyVariant 写错）——那时 P8 永远不响，
          // 若这里也空白，就只剩「没反应」这一个现象，正是今晚反复出现的那类黑箱。
          log('error', 'channel.connection-lost.submit-failed', {
            channelId,
            cause,
            disconnectedAt,
            reason: error instanceof Error ? error.message : String(error)
          })
        }
      })()
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
