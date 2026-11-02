import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { IpcChannels } from '../ipc/channels'

/**
 * Source-text assertions below spell out multi-line snippets with `\n`. A Windows checkout
 * (core.autocrlf) hands us `\r\n`, which would fail every one of them for a reason that has
 * nothing to do with the code under test, so normalize line endings at the read.
 */
function readSource(relativePath: string): string {
  return readFileSync(resolve(__dirname, relativePath), 'utf8').replace(/\r\n/g, '\n')
}

const appSource = readSource('app.ts')
const webIpcSource = readSource('ipc/webIpc.ts')
const storageIpcSource = readSource('ipc/storageIpc.ts')
const channelIpcSource = readSource('ipc/channelIpc.ts')
const modelIpcSource = readSource('ipc/modelIpc.ts')
const assistantIpcSource = readSource('ipc/assistantIpc.ts')
const agentIpcSource = readSource('ipc/agentIpc.ts')
const agentToolsIpcSource = readSource('ipc/agentToolsIpc.ts')
// 第 1 步起，窗口/应用/外壳/对话框这 16 个 handler 的归属文件是 ipc/windowIpc.ts。
const windowIpcSource = readSource('ipc/windowIpc.ts')

/**
 * 顺序断言用的比较：先把两端空白折叠成单空格再比。
 *
 * 这些锚点已经长到一行放不下，任何一次 prettier 换行都会让 `toContain` 失败——那是一次
 * 与语义无关的红，会教会下一个人「重跑一下就好」。折叠空白只影响比较，不改任何断言结构。
 */
const collapseWhitespace = (text: string): string => text.replace(/\s+/gu, ' ')
const looseIndexOf = (source: string, needle: string): number =>
  collapseWhitespace(source).indexOf(collapseWhitespace(needle))
const preloadSource = readSource('../preload/index.ts')
/**
 * 删除已读是**破坏性**通道，必须能一眼看出它落在哪一层：
 * 渲染层只经 preload → 主进程 handler → 运行时，不许绕过去直接写文件。
 */
const notificationIpcSource = readSource('../../notifications/ipc/notificationIpcHandlers.ts')
const taskIpcHelperSource = readSource('registerAgentTaskIpcHandlers.ts')
const generatedProductManifestsSource = readSource('../../../products/generated/productManifests.ts')
const generatedProductServicesSource = readSource('../../../products/generated/productServices.ts')
/** Agent / 产品 / Job 三个受保护面必须在同一次注册调用里接线。 */
const registerIpcHandlersCall = [
  'registerIpcHandlers(',
  '    productManifests,',
  '    productIpcRegistry,',
  '    jobRunQueryService,',
  '    jobScheduleQueryService,',
  '    refreshBuiltinSeedCopy',
  '  )'
].join('\n')

const directTaskIpcMethods: Array<[string, string]> = [
  ['agentsListTasks', 'listTasks'],
  ['agentsGetTaskLogs', 'getTaskLogs'],
  ['agentsPreviewTaskSchedule', 'previewTaskSchedule'],
  ['agentsListTaskPage', 'listTaskPage'],
  ['agentsGetTaskDeliveryAttempts', 'getTaskDeliveryAttempts'],
  ['agentsListTaskMutationAudits', 'listTaskMutationAudits'],
  ['agentsGetTaskAutomationPolicy', 'getTaskAutomationPolicy'],
  ['agentsUpdateTaskAutomationPolicy', 'updateTaskAutomationPolicy'],
  ['agentsGetTaskDeliveryReadiness', 'getTaskDeliveryReadiness']
]

const mutationTaskIpcMethods: Array<[string, string]> = [
  ['agentsCreateTask', 'createTask'],
  ['agentsUpdateTask', 'updateTask'],
  ['agentsDeleteTask', 'deleteTask'],
  ['agentsRunTask', 'runTask'],
  ['agentsCancelTaskRun', 'cancelTaskRun']
  , ['agentsRetryTaskDelivery', 'retryTaskDelivery']
]

describe('desktop main IPC surface', () => {
  it('accepts product agent seed factories without importing products into the platform', () => {
    expect(appSource).not.toMatch(/from ['"][^'"]*products\//)
    expect(appSource).toContain('options.productAgentSeedFactories')
  })
  it('keeps critical agent runtime and compatibility handlers registered in app.ts', () => {
    expect(appSource).toContain('createElectronChannelCredentialVault')
    expect(modelIpcSource).toContain('IpcChannels.modelProvidersRunRuntimeChecks')
    expect(modelIpcSource).toContain('IpcChannels.modelProvidersGetRuntimeCheckReport')
    expect(agentIpcSource).toContain('IpcChannels.agentsGetRuntimeCompatibility')
    expect(agentIpcSource).toContain('IpcChannels.agentsProbeRuntimeCompatibility')
    expect(agentIpcSource).toContain('IpcChannels.agentsGetModelGatewayStatus')
    expect(agentIpcSource).toContain('IpcChannels.agentsStartModelGateway')
    expect(agentIpcSource).toContain('IpcChannels.agentsStopModelGateway')
    expect(agentIpcSource).toContain('IpcChannels.agentsSetModelGatewayEnabled')
    expect(agentIpcSource).toContain('IpcChannels.agentsExecuteRuntimeCommand')
    expect(agentIpcSource).toContain('agentIpcHandlers.sendMessage(request)')
    expect(appSource).toContain('getPolicyPreset: async () => (await settingsStore.get()).agent.taskAutomation.policyPreset')
    expect(appSource).toContain('taskManagementRuntime: taskManagementToolRuntimeService')
    expect(appSource).toContain('taskManagementToolBridge: {')
    expect(appSource).toContain('getTaskRunController: () => agentTaskRunController')
    expect(appSource).toContain('await agentTaskExecutionCoordinator?.recoverAfterRestart()')
    expect(appSource).toContain('taskAutomationMaintenance.recoverAfterRestart()')
    expect(appSource).toContain('scheduleTaskAutomationMaintenance(taskAutomationMaintenance)')
    // Channel maintenance no longer owns timers: it is registered as platform jobs and removed by
    // the disposer those registrations return. The guard follows the registration, not the old
    // method name — deleting the whole block must still turn it red.
    expect(appSource).toContain('deliveryCleanup: () => channelDeliveryMaintenance.runSlice()')
    expect(appSource).toContain('deliveryRetry: () => channelDeliveryMaintenance.runRetrySlice()')
    expect(appSource).toContain('inboundRecovery: () => channelInboundExecutionRunner.recoverOnce()')
    expect(appSource).toContain('telegram: () => telegramRuntimeMaintenance.runOnce()')
    expect(appSource).toContain('slack: () => slackRuntimeMaintenance.runOnce()')
    expect(appSource).toContain('lark: () => larkRuntimeMaintenance.runOnce()')
    expect(appSource).toContain('qq: () => qqRuntimeMaintenance.runOnce()')
    expect(appSource).toContain('discord: () => discordRuntimeMaintenance.runOnce()')
    expect(appSource).toContain('wechat: () => wechatRuntimeMaintenance.runOnce()')
    expect(appSource).toContain('registerChannelMaintenanceJobHandlers(jobRuntime, channelMaintenanceJobDeps)')
    expect(appSource).toContain('disposeChannelMaintenanceJobs = scheduleChannelMaintenanceJobs(')
    expect(appSource).toContain('disposeChannelMaintenanceJobs?.()')
    expect(appSource).toContain('ChannelManagementService')
    // 25 个渠道 handler 已搬到 ipc/channelIpc.ts：断言看模块，退出链接线仍看 app.ts。
    expect(appSource).toContain('registerChannelIpc(ipcMain, { channelManagementService, channelInboundService })')
    expect(channelIpcSource).toContain('IpcChannels.channelsCatalog')
    expect(channelIpcSource).toContain('IpcChannels.channelsCredentialSubmit')
    expect(channelIpcSource).toContain('IpcChannels.channelsPolicyCreate')
    expect(channelIpcSource).toContain('IpcChannels.channelsRuntimeStatus')
    expect(channelIpcSource).toContain('asChannelHandoff')
    expect(channelIpcSource).toContain('isP256PublicJwk')
    expect(appSource).toContain('channelManagementService.recover()')
    expect(appSource).toContain('SlackRuntimeManager')
    expect(appSource).toContain('SlackRuntimeRepository')
    expect(appSource).toContain('LarkRuntimeManager')
    expect(appSource).toContain('LarkRuntimeRepository')
    expect(appSource).toContain('QqRuntimeRepository')
    expect(appSource).toContain('QqRuntimeManager')
    expect(appSource).toContain('DiscordRuntimeRepository')
    expect(appSource).toContain('DiscordRuntimeManager')
    expect(appSource).toContain("if (type === 'discord') return discordRuntimeManager.start(channelId, generation, token)")
    expect(appSource).toContain('WechatRuntimeRepository')
    expect(appSource).toContain('WechatRuntimeManager')
    expect(appSource).toContain("if (type === 'wechat') return wechatRuntimeManager.start(channelId, generation, token)")
    expect(appSource).toContain('createPlatformWebSocketFactory')
    expect(appSource).toContain('ChannelDeliveryTransportRouter')
    expect(appSource).toContain("if (type === 'slack') return slackRuntimeManager.start(channelId, generation, token)")
    expect(appSource).toContain("else if (type === 'telegram') telegramOffsetRepository.auditBootstrapFenced(channelId, 'telegram-runtime-evidence-missing')")
    expect(appSource).toContain("// Lark's audit gate is intentionally active-generation-only")
    expect(appSource).not.toContain('agentServices.channels.create')
    expect(appSource).toContain('disposeTaskAutomationMaintenance?.()')
    expect(appSource).toContain('agent: {\n          taskAutomation: { policyPreset }')
    expect(appSource).not.toContain('...settings.agent,\n          taskAutomation: { policyPreset }')
    expect(appSource).toContain("import { registerAgentTaskIpcHandlers } from './registerAgentTaskIpcHandlers'")
    expect(appSource).toContain('registerAgentTaskIpcHandlers(ipcMain, agentIpcHandlers, {')
    expect(appSource).toContain('getScheduleValidationOptions: taskIpcScheduleValidationOptions')
    expect(appSource).toContain('afterCommit: refreshTaskStateAfterCommit')
    expect(appSource).toContain('retryTaskDelivery: (agentId, runLogId, attemptId)')
  })

  it('keeps the task smoke fixture launch-only before normal persistence composition', () => {
    const smokeImport = "import { configureTaskAutomationSmokeProfile } from './taskAutomationSmokeProfile'"
    const smokeSetup = 'const taskAutomationSmokeProfile = configureTaskAutomationSmokeProfile({'
    expect(appSource).toContain(smokeImport)
    expect(appSource).toContain(smokeSetup)
    expect(appSource).toContain('const productAcceptanceRequested = resolveProductAcceptanceProfileOptIn({')
    expect(appSource).toContain('environment: productAcceptanceRequested ? {} : process.env')
    expect(appSource.indexOf(smokeSetup)).toBeLessThan(appSource.indexOf('const settingsStore = createSettingsStore('))
    expect(appSource).toContain('createTaskAutomationSmokeSeed(')
    expect(appSource).toContain('createTaskAutomationSmokeDriver(')
    expect(appSource).toContain('mergeAndReplaceAgentSessionState(state, sessionId)')
    expect(appSource).toContain('new ChannelRuntimeSupervisor({')
    expect(appSource).toContain('getChannelRuntimeSnapshot: () => channelRuntimeSupervisor.snapshot()')
    expect(appSource).not.toContain('channelRuntimeService')
    expect(appSource).toContain('if (taskAutomationSmokeProfile.enabled)')
    expect(appSource).toContain('resolveBootstrapProductManifests(options.productManifests ?? [], taskAutomationSmokeProfile.enabled)')
    expect(collapseWhitespace(appSource)).toContain(
      collapseWhitespace('registerProductServices: taskAutomationSmokeProfile.enabled ? undefined : async () => options.registerProductServices?.({')
    )
    expect(agentIpcSource).toContain('agentIpcHandlers.sendMessage(request)')
    expect(assistantIpcSource).toContain('IpcChannels.assistantsStreamOpen')
    expect(webIpcSource).toContain('IpcChannels.webSearchFetchUrls')
    expect(storageIpcSource).toContain('IpcChannels.storageListCaches')
    expect(appSource).toContain('registerJobIpcHandlers(')
  })

  it('sets the product acceptance profile before durable stores are constructed', () => {
    const acceptanceImport = "import { configureProductAcceptanceProfile, resolveProductAcceptanceProfileOptIn } from './productAcceptanceProfile'"
    const acceptanceSetup = 'const productAcceptanceProfile = configureProductAcceptanceProfile({'
    expect(appSource).toContain(acceptanceImport)
    expect(appSource).toContain('resolveProductAcceptanceProfileOptIn')
    expect(appSource).toContain(acceptanceSetup)
    expect(appSource.indexOf('const productAcceptanceRequested = resolveProductAcceptanceProfileOptIn({')).toBeLessThan(
      appSource.indexOf('const taskAutomationSmokeProfile = configureTaskAutomationSmokeProfile({')
    )
    expect(appSource.indexOf('const productAcceptanceRequested = resolveProductAcceptanceProfileOptIn({')).toBeLessThan(
      appSource.indexOf(acceptanceSetup)
    )
    expect(appSource.indexOf(acceptanceSetup)).toBeLessThan(appSource.indexOf('const settingsStore = createSettingsStore('))
    expect(appSource.indexOf(acceptanceSetup)).toBeLessThan(appSource.indexOf('const providerStore = createProviderStore('))
    expect(appSource.indexOf(acceptanceSetup)).toBeLessThan(appSource.indexOf('const agentDatabase = createAgentPlatformDatabase('))
    expect(appSource.indexOf(acceptanceSetup)).toBeLessThan(appSource.indexOf('const assistantDatabase = createAssistantPlatformDatabase('))
    expect(appSource.indexOf(acceptanceSetup)).toBeLessThan(appSource.indexOf('const jobRunStore = createJobRunSqliteStore('))
    expect(appSource.indexOf(acceptanceSetup)).toBeLessThan(appSource.indexOf('const channelCredentialVault = createElectronChannelCredentialVault('))
  })

  it('creates the platform data directory before opening platform databases', () => {
    const platformDirectory = "const platformDataDirectory = join(app.getPath('userData'), 'platform')"
    const ensureDirectory = 'mkdirSync(platformDataDirectory, { recursive: true })'

    expect(appSource).toContain(platformDirectory)
    expect(appSource).toContain(ensureDirectory)
    expect(appSource.indexOf(ensureDirectory)).toBeLessThan(appSource.indexOf('const agentDatabase = createAgentPlatformDatabase('))
    expect(appSource.indexOf(ensureDirectory)).toBeLessThan(appSource.indexOf('const assistantDatabase = createAssistantPlatformDatabase('))
    expect(appSource.indexOf(ensureDirectory)).toBeLessThan(appSource.indexOf('const jobRunStore = createJobRunSqliteStore('))
  })

  it('constructs the generic provider secret vault before the provider store without changing IPC registration', () => {
    expect(appSource).toContain("import { createElectronSecretVault } from '../../secrets'")
    expect(appSource).toContain('const providerSecretVault = createElectronSecretVault({')
    expect(appSource).toContain("directory: join(app.getPath('userData'), 'platform', 'secrets')")
    expect(appSource).toContain('const providerStore = createProviderStore(')
    expect(appSource).toContain('providerSecretVault')
    expect(appSource.indexOf('const providerSecretVault = createElectronSecretVault({')).toBeLessThan(
      appSource.indexOf('const providerStore = createProviderStore(')
    )
    // 模型服务 19 个 handler 已搬到 ipc/modelIpc.ts。
    expect(appSource).toContain('registerModelIpc(ipcMain, {')
    expect(modelIpcSource).toContain('IpcChannels.modelProvidersList')
    expect(modelIpcSource).toContain('IpcChannels.modelProvidersUpsert')
    expect(modelIpcSource).toContain('IpcChannels.modelProvidersTestConnection')
    expect(modelIpcSource).toContain('IpcChannels.modelProvidersPreviewModelSync')
    const modelSyncHandler = modelIpcSource.slice(modelIpcSource.indexOf('IpcChannels.modelProvidersPreviewModelSync'))
    expect(modelSyncHandler).toContain('const provider = await providerStore.resolveRuntimeProvider(providerId)')
    expect(modelSyncHandler).not.toContain("(await providerStore.getState()).providers.find((item) => item.id === providerId)")
    expect(appSource).not.toContain('testModelProviderConnection(provider, options)')
    expect(appSource).not.toContain('apiKey: options?.apiKey')
    expect(assistantIpcSource).toContain('IpcChannels.assistantsStreamOpen')
    expect(agentIpcSource).toContain('IpcChannels.agentsSendMessage')
    expect(appSource).toContain('IpcChannels.productIpcInvoke')
  })

  it('passes the existing generic provider vault through the product service seam', () => {
    expect(appSource).toContain('secretVault: providerSecretVault')
    expect(appSource.indexOf('secretVault: providerSecretVault')).toBeGreaterThan(
      appSource.indexOf('registerProductServices: taskAutomationSmokeProfile.enabled ? undefined : async () => options.registerProductServices?.({')
    )
  })

  it('passes the model-service defaults through the product service seam', () => {
    // 默认翻译模型等默认值只读透出：产品不得自己读写 app settings。
    expect(appSource).toContain('getModelDefaults: async () => (await settingsStore.get()).modelDefaults')
    expect(appSource.indexOf('getModelDefaults: async () => (await settingsStore.get()).modelDefaults')).toBeGreaterThan(
      appSource.indexOf('registerProductServices: taskAutomationSmokeProfile.enabled ? undefined : async () => options.registerProductServices?.({')
    )
    expect(generatedProductServicesSource).toContain('getModelDefaults: () => Promise<ModelDefaultsSettings>')
  })

  it('keeps products and product IPC active in product acceptance mode', () => {
    expect(appSource).toContain('function resolveBootstrapProductManifests(')
    expect(appSource).toContain('productManifests: readonly ProductManifest[]')
    expect(appSource).toContain('taskSmokeEnabled: boolean')
    expect(appSource).toContain('if (taskSmokeEnabled) return []')
    expect(appSource).not.toContain('productAcceptanceProfile.enabled ? []')
    expect(appSource).toContain('reportProductAcceptanceRegistration({')
    expect(appSource).toContain('productIds: productManifests.map((manifest) => manifest.id)')
    expect(appSource).toContain("`[product-acceptance] products: ${input.productIds.join(',') || '(none)'}`")
    expect(appSource).toContain('`[product-acceptance] product IPC handlers: ${input.productIpcMethodCount}`')
    expect(appSource).toContain('productIpcRegistry.invoke(productId, method, payload)')
    expect(appSource).toContain(registerIpcHandlersCall)
    expect(appSource).toContain('IpcChannels.productIpcInvoke')
    expect(storageIpcSource).toContain('IpcChannels.productSummaries')
  })

  it('registers the read-only job schedule projection and keeps agent, assistant, and product seams intact', () => {
    expect(appSource).toContain("import { registerJobIpcHandlers } from './jobIpcHandlers'")
    expect(appSource).toContain('const jobScheduleQueryService = createJobScheduleQueryService({ runtime: jobRuntime })')
    expect(appSource).toContain('registerJobIpcHandlers(ipcMain, jobRunQueryService, jobScheduleQueryService)')
    expect(appSource).toContain(registerIpcHandlersCall)
    // 新增面只读：preload 只多一个具名查询方法，没有 setSchedule/removeSchedule/toggle 入口
    expect(preloadSource).toContain('listSchedules: () => ipcRenderer.invoke(IpcChannels.jobsListSchedules)')
    for (const writeChannel of ['jobsSetSchedule', 'jobsRemoveSchedule', 'jobsEnqueue', 'jobsToggle']) {
      expect(preloadSource).not.toContain(writeChannel)
      expect(appSource).not.toContain(writeChannel)
    }
    // 既有受保护面逐字未变
    expect(agentIpcSource).toContain('IpcChannels.agentsSendMessage')
    expect(assistantIpcSource).toContain('IpcChannels.assistantsStreamOpen')
    expect(appSource).toContain('IpcChannels.productIpcInvoke')
    expect(appSource).toContain('registerAgentTaskIpcHandlers(ipcMain, agentIpcHandlers, {')
    expect(appSource).toContain('registerJobIpcHandlers(')
  })

  it('creates a visible boot window before product registration and loads the renderer only after sealing product IPC', () => {
    const bootstrapSource = collapseWhitespace(appSource.slice(appSource.indexOf('export async function bootstrapDesktopApp(')))
    // 建窗/接线搬到 window/mainWindow.ts 后，启动顺序仍由这一行位置证明。
    const bootWindow = 'await mainWindowHost.createAndWire()'
    // 启动时应用代理设置；历史遗留的坏地址会退回直连，但必须留日志，不许无声。
    const proxyApply = 'await applySessionProxySettings((await settingsStore.get()).network, {'
    const productRegistration = 'registerProductServices: taskAutomationSmokeProfile.enabled ? undefined : async () => options.registerProductServices?.({'
    const productSeal = 'productIpcRegistry.seal(expectedProductIpcMethods(productManifests))'
    const rendererLoad = 'await mainWindowHost.loadAndMount()'

    expect(bootstrapSource).toContain(bootWindow)
    expect(bootstrapSource).toContain(proxyApply)
    expect(bootstrapSource).toContain(productSeal)
    expect(bootstrapSource).toContain(rendererLoad)
    expect(looseIndexOf(bootstrapSource, bootWindow)).toBeLessThan(looseIndexOf(bootstrapSource, productRegistration))
    expect(looseIndexOf(bootstrapSource, proxyApply)).toBeLessThan(looseIndexOf(bootstrapSource, productRegistration))
    expect(looseIndexOf(bootstrapSource, productRegistration)).toBeLessThan(looseIndexOf(bootstrapSource, productSeal))
    expect(looseIndexOf(bootstrapSource, productSeal)).toBeLessThan(looseIndexOf(bootstrapSource, rendererLoad))
    expect(bootstrapSource).toContain('platformFetch: getPlatformFetch()')
    expect(looseIndexOf(bootstrapSource, proxyApply)).toBeLessThan(looseIndexOf(bootstrapSource, 'platformFetch: getPlatformFetch()'))
  })

  it('recovers stale persistent job runs before product startup can enqueue current-process work', () => {
    const bootstrapSource = collapseWhitespace(appSource.slice(appSource.indexOf('export async function bootstrapDesktopApp(')))
    const staleRecovery = 'jobRuntime.recover()'
    const productRegistration = 'registerProductServices: taskAutomationSmokeProfile.enabled ? undefined : async () => options.registerProductServices?.({'

    expect(bootstrapSource).toContain(staleRecovery)
    expect(looseIndexOf(bootstrapSource, staleRecovery)).toBeLessThan(looseIndexOf(bootstrapSource, productRegistration))
  })

  it('treats proxy application failure as a startup boundary before products and the normal renderer', () => {
    const bootstrapSource = collapseWhitespace(appSource.slice(appSource.indexOf('export async function bootstrapDesktopApp(')))
    // 启动时应用代理设置；历史遗留的坏地址会退回直连，但必须留日志，不许无声。
    const proxyApply = 'await applySessionProxySettings((await settingsStore.get()).network, {'
    const productRegistration = 'registerProductServices: taskAutomationSmokeProfile.enabled ? undefined : async () => options.registerProductServices?.({'
    const rendererLoad = 'await mainWindowHost.loadAndMount()'
    const proxyApplyIndex = looseIndexOf(bootstrapSource, proxyApply)
    const productRegistrationIndex = looseIndexOf(bootstrapSource, productRegistration)

    expect(proxyApplyIndex).toBeLessThan(productRegistrationIndex)
    expect(proxyApplyIndex).toBeLessThan(looseIndexOf(bootstrapSource, rendererLoad))
    expect(bootstrapSource.slice(proxyApplyIndex, productRegistrationIndex)).not.toContain('catch')
  })

  it('keeps generated product registration reachable from the desktop bootstrap', () => {
    expect(generatedProductManifestsSource).toContain('marketIntelligenceProductManifest')
    expect(generatedProductServicesSource).toContain('registermarketIntelligenceProductManifestServices(deps)')
    expect(appSource).toContain('registerProductServices')
  })

  it('does not request the normal global single-instance lock in product acceptance mode', () => {
    expect(appSource).toContain('function requestRuntimeSingleInstanceLock(productAcceptanceEnabled: boolean): boolean')
    expect(appSource).toContain('if (productAcceptanceEnabled) return true')
    expect(appSource).toContain('const gotLock = requestRuntimeSingleInstanceLock(productAcceptanceProfile.enabled)')
    expect(appSource).toContain("if (!productAcceptanceProfile.enabled) app.on('second-instance'")
  })

  it('keeps assistant IPC handlers registered alongside agent handlers', () => {
    expect(assistantIpcSource).toContain('IpcChannels.assistantsList')
    expect(assistantIpcSource).toContain('IpcChannels.assistantsStreamOpen')
    expect(assistantIpcSource).toContain('IpcChannels.assistantsEditAndResendUserMessage')
    expect(assistantIpcSource).toContain('IpcChannels.assistantsLibraryListTemplates')
    expect(assistantIpcSource).toContain('IpcChannels.assistantsLibraryInstallTemplate')
  })

  it('adds exactly one web search reveal channel and drops no existing channels', () => {
    const keys = Object.keys(IpcChannels)
    // 按 webSearch 命名空间精确断言 +1（并发包可能新增别的命名空间，不能用全量总数互锁）。
    expect(keys.filter((key) => key.startsWith('webSearch'))).toHaveLength(8)
    expect(keys).toContain('webSearchRevealProviderApiKey')
    expect(IpcChannels.webSearchRevealProviderApiKey).toBe('platform:web-search-reveal-provider-api-key')
    expect(keys).toEqual(
      expect.arrayContaining([
        'webSearchListProviders',
        'webSearchGetSettings',
        'webSearchUpdateSettings',
        'webSearchUpdateProvider',
        'webSearchRevealProviderApiKey',
        'webSearchCheckProvider',
        'webSearchSearchKeywords',
        'webSearchFetchUrls'
      ])
    )
  })

  it('keeps web search IPC handlers registered without removing assistant and agent seams', () => {
    // handler 已搬到 ipc/webIpc.ts；app.ts 只剩构造与一行接线，断言跟着实现走。
    expect(appSource).toContain('createWebSearchIpcHandlers')
    expect(appSource).toContain('registerWebIpc(ipcMain, { webSearch: webSearchIpcHandlers })')
    expect(webIpcSource).toContain('IpcChannels.webSearchListProviders')
    expect(webIpcSource).toContain('IpcChannels.webSearchRevealProviderApiKey')
    expect(webIpcSource).toContain('IpcChannels.webSearchCheckProvider')
    expect(webIpcSource).toContain('IpcChannels.webSearchFetchUrls')
    expect(assistantIpcSource).toContain('IpcChannels.assistantsStreamOpen')
    expect(assistantIpcSource).toContain('IpcChannels.assistantsEditAndResendUserMessage')
    expect(agentIpcSource).toContain('IpcChannels.agentsSendMessage')
    expect(agentToolsIpcSource).toContain('IpcChannels.agentsListProductToolPackages')
  })

  it('keeps storage and cache IPC handlers registered without dropping existing seams', () => {
    expect(appSource).toContain('createCacheGovernanceIpcHandlers')
    expect(appSource).toContain("cache-governance.sqlite")
    expect(appSource).toContain('registerStorageIpc(ipcMain, {')
    expect(storageIpcSource).toContain('IpcChannels.storageListCaches')
    expect(storageIpcSource).toContain('IpcChannels.storageInspectCache')
    expect(storageIpcSource).toContain('IpcChannels.storageClearCache')
    expect(storageIpcSource).toContain('IpcChannels.storageCompactCache')
    expect(storageIpcSource).toContain('IpcChannels.storageListCacheOperations')
    expect(assistantIpcSource).toContain('IpcChannels.assistantsStreamOpen')
    expect(webIpcSource).toContain('IpcChannels.webSearchFetchUrls')
    expect(agentIpcSource).toContain('IpcChannels.agentsSendMessage')
  })

  it('wires renderer lifecycle diagnostics to every main window', () => {
    // 接线随建窗搬到 window/mainWindow.ts；日志写入器仍在 app.ts 构造。
    const windowHostSource = readSource('window/mainWindow.ts')
    expect(windowHostSource).toContain("from '../../window/rendererProcessDiagnostics'")
    expect(appSource).toContain("import { createRendererProcessLog } from '../window/rendererProcessLog'")
    expect(windowHostSource).toContain('wireRendererProcessDiagnostics(window')
    // 渲染层诊断不再有自己的 ndjson 管道：改走唯一的应用日志写入器，来源由 category 区分。
    expect(appSource).toContain('createRendererProcessLog(appLog)')
    expect(appSource).not.toContain('renderer-lifecycle.ndjson')
  })

  it('answers product IPC with structured unavailability once quit cleanup has closed the runtime', () => {
    expect(appSource).toContain("import { createProductIpcInvoker } from './productIpcInvoker'")
    expect(appSource).toContain('const invokeProductIpc = createProductIpcInvoker({')
    // 退出标记是入口的短路条件：产品 DB 关闭后绝不再进入产品 handler。
    expect(appSource).toContain('isRuntimeClosed: () => platformRuntimesDisposed')
    expect(appSource).toContain('invokeProductIpc(productId, method, payload)')
    // 关闭登记与 renderer 入口共用同一 registry 实例。
    expect(appSource).toContain('productIpcRegistryForDisposal = productIpcRegistry')
    expect(appSource).toContain('productIpcRegistryForDisposal?.markClosed()')
    // 登记关闭必须早于产品服务/DB 拆除。
    expect(appSource.indexOf('productIpcRegistryForDisposal?.markClosed()')).toBeLessThan(
      appSource.indexOf('productServiceDisposerRegistry.disposeAll()')
    )
  })

  it('owns product service disposal alongside platform runtime disposal', () => {
    expect(appSource).toContain('createProductServiceDisposerRegistry')
    expect(appSource).toContain('registerProductDisposer: productServiceDisposerRegistry.register')
    expect(appSource).toContain('productServiceDisposerRegistry.disposeAll()')
  })

  it('registers the panel workspace channels before the boot window and restores after product sealing', () => {
    const bootstrapSource = collapseWhitespace(appSource.slice(appSource.indexOf('export async function bootstrapDesktopApp(')))
    const compose = 'const panelWorkspace = composePanelWorkspace({'
    const registerChannels = 'panelWorkspace.registerChannels()'
    // 建窗/接线搬到 window/mainWindow.ts 后，启动顺序仍由这一行位置证明。
    const bootWindow = 'await mainWindowHost.createAndWire()'
    const restore = 'await panelWorkspace.start()'
    const productSeal = 'productIpcRegistry.seal(expectedProductIpcMethods(productManifests))'
    const rendererLoad = 'await mainWindowHost.loadAndMount()'

    expect(appSource).toContain("import { composePanelWorkspace } from './workspace/composePanelWorkspace'")
    expect(bootstrapSource).toContain(compose)
    expect(bootstrapSource).toContain('await panelWorkspace.start()')
    expect(bootstrapSource).toContain('panelWorkspace.registerMainWindow({ webContentsId: workspaceMainWindow.webContents.id })')
    expect(bootstrapSource).toContain('panelWorkspace.attachMainWindow({ webContentsId: workspaceMainWindow.webContents.id })')
    // PLAT-26：**先注册、再建窗**（建窗早于 handler 注册 ⇒ 被驱动的窗口会打出 No handler registered）；
    // 注册与恢复拆成两个入口，注册内容与准入链逐字不变。
    expect(bootstrapSource).toContain(registerChannels)
    expect(bootstrapSource.indexOf(registerChannels)).toBeLessThan(bootstrapSource.indexOf(bootWindow))
    // 恢复（有界加载 + 迟到 CAS）仍在产品注册 seal 之后、renderer 之前：fail-closed 与产品顺序不变
    expect(bootstrapSource.indexOf(productSeal)).toBeLessThan(bootstrapSource.indexOf(restore))
    expect(bootstrapSource.indexOf(compose)).toBeLessThan(bootstrapSource.indexOf(rendererLoad))
    expect(bootstrapSource.indexOf(restore)).toBeLessThan(bootstrapSource.indexOf(rendererLoad))
    expect(looseIndexOf(bootstrapSource, productSeal)).toBeLessThan(looseIndexOf(bootstrapSource, rendererLoad))
    // 退出走 workspace 有界 flush
    // 退出链搬到 lifecycle/quit.ts 后，dispose 决策由编排器驱动；app.ts 只提供端口。
    expect(appSource).toContain('disposeWorkspace: async () => panelWorkspaceForDisposal?.dispose()')
    expect(appSource).toContain('let panelWorkspaceForDisposal: ReturnType<typeof composePanelWorkspace> | null = null')

    // 5 条通道常量与 preload 命名空间一一对应，且不引入任意 channel/URL 入口
    for (const channel of [
      'workspaceGetHostContext', 'workspaceGetSnapshot', 'workspaceCommand', 'workspaceHostLifecycle', 'workspaceEvent'
    ]) {
      expect(appSource).not.toContain(`ipcMain.handle(IpcChannels.${channel}`)
      expect(preloadSource).toContain(`IpcChannels.${channel}`)
    }
    expect(preloadSource).toContain('workspace: {')
    // P2-03：`.tabs.*` 三条通道同样只经 compose 注册（app.ts 不得自行 handle），preload 必须有对应具名方法
    for (const channel of ['workspaceTabsGetSnapshot', 'workspaceTabsCommand', 'workspaceTabsHostLifecycle']) {
      expect(appSource).not.toContain(`ipcMain.handle(IpcChannels.${channel}`)
      expect(preloadSource).toContain(`IpcChannels.${channel}`)
    }
    // Tab 事件复用既有受控通道（不新增事件通道、不扩事件词汇）
    expect(appSource).not.toContain('IpcChannels.workspaceTabsEvent')
    for (const method of ['tabsGetSnapshot', 'tabsCommand', 'tabsHostLifecycle']) {
      expect(preloadSource).toContain(`${method}:`)
    }
    // 既有受保护 seam 不得因 workspace 接线丢失
    expect(agentIpcSource).toContain('IpcChannels.agentsSendMessage')
    expect(assistantIpcSource).toContain('IpcChannels.assistantsStreamOpen')
    expect(appSource).toContain('IpcChannels.productIpcInvoke')
    // web search handler 已搬到 ipc/webIpc.ts：受保护 seam 看模块而不是只看 app.ts。
    expect(webIpcSource).toContain('IpcChannels.webSearchFetchUrls')
    expect(appSource).toContain('registerAgentTaskIpcHandlers(ipcMain, agentIpcHandlers, {')
  })

  it('composes task IPC in app.ts and keeps every helper/preload boundary enveloped', () => {
    const mutationWrapperSource = taskIpcHelperSource.slice(
      taskIpcHelperSource.indexOf('const mutation ='),
      taskIpcHelperSource.indexOf('ipcMain.handle(')
    )
    expect(mutationWrapperSource).toContain('serializeTaskIpc(async () =>')
    expect(mutationWrapperSource).toContain('await options.afterCommit()')
    expect(mutationWrapperSource).toContain('try {')
    expect(mutationWrapperSource).toContain('} catch {')

    for (const [channel, method] of directTaskIpcMethods) {
      const mainBlock = mainRegistrationBlock(taskIpcHelperSource, channel)
      expect(mainBlock).toContain('serializeTaskIpc')
      expect(appSource).not.toContain(`ipcMain.handle(IpcChannels.${channel}`)
      const preloadBlock = preloadMethodBlock(preloadSource, method)
      expect(preloadBlock).toContain(`IpcChannels.${channel}`)
      expect(preloadBlock).toContain('unwrapTaskIpc')
    }

    for (const [channel, method] of mutationTaskIpcMethods) {
      expect(mainRegistrationBlock(taskIpcHelperSource, channel)).toContain('mutation(() =>')
      expect(appSource).not.toContain(`ipcMain.handle(IpcChannels.${channel}`)
      const preloadBlock = preloadMethodBlock(preloadSource, method)
      expect(preloadBlock).toContain(`IpcChannels.${channel}`)
      expect(preloadBlock).toContain('unwrapTaskIpc')
    }
    expect(mainRegistrationBlock(taskIpcHelperSource, 'agentsRetryTaskDelivery')).toContain('mutation(() =>')
    expect(appSource).not.toContain('ipcMain.handle(IpcChannels.agentsRetryTaskDelivery')
    expect(preloadMethodBlock(preloadSource, 'retryTaskDelivery')).toContain('unwrapTaskIpc')
  })

  it('adds exactly one model provider reveal channel and keeps the rest of the namespace', () => {
    expect(IpcChannels.modelProvidersRevealApiKey).toBe('platform:model-providers-reveal-api-key')
    expect(
      Object.entries(IpcChannels)
        .filter(([name]) => name.startsWith('modelProviders'))
        .map(([, channel]) => channel)
        .sort()
    ).toEqual([
      'platform:model-providers-add-or-update-model',
      'platform:model-providers-apply-model-sync',
      'platform:model-providers-cancel-model-detection',
      'platform:model-providers-detect-models',
      'platform:model-providers-detection-done',
      'platform:model-providers-detection-progress',
      'platform:model-providers-generate-image',
      'platform:model-providers-get-in-use-retired',
      'platform:model-providers-get-runtime-check-report',
      'platform:model-providers-list',
      'platform:model-providers-preview-model-sync',
      'platform:model-providers-remove',
      'platform:model-providers-remove-model',
      'platform:model-providers-reveal-api-key',
      'platform:model-providers-reveal-custom-headers',
      'platform:model-providers-run-runtime-checks',
      'platform:model-providers-set-custom-headers',
      'platform:model-providers-set-default-chat-model',
      'platform:model-providers-set-enabled',
      'platform:model-providers-test-connection',
      'platform:model-providers-upsert'
    ])
    // 既有受保护面逐字未变（agent / assistant / product）
    expect(agentIpcSource).toContain('IpcChannels.agentsSendMessage')
    expect(assistantIpcSource).toContain('IpcChannels.assistantsStreamOpen')
    expect(appSource).toContain('IpcChannels.productIpcInvoke')
  })

  it('wires exactly one image generation/edit channel behind strict validation and message persistence', () => {
    expect(IpcChannels.modelProvidersGenerateImage).toBe('platform:model-providers-generate-image')
    const block = mainRegistrationBlock(modelIpcSource, 'modelProvidersGenerateImage')

    // 先校验参数（provider/model/prompt/count/size 白名单 + 编辑原图 ≤4MB/mime 白名单），再解析 provider 并出站。
    expect(block).toContain("typeof providerId !== 'string'")
    expect(block).toContain('validateImageGenerationInput(')
    expect(block).toContain('validateImageEditInput(')
    expect(block).toContain('resolveImageEditSource(')
    expect(block).toContain('resolveRuntimeProvider(providerId)')
    expect(block).toContain('generateProviderImages(')
    expect(block).toContain('editProviderImages(')
    expect(block).toContain('imageEndpoints?.generation')
    expect(block).toContain('imageEndpoints?.edit')
    expect(block).toContain('getPlatformFetch()')
    // 编辑复用同一通道：operation 是 additive 参数，不存在第二条图像通道。
    expect(block).toContain("request.operation === 'edit'")
    expect(modelIpcSource).not.toContain('modelProvidersEditImage')
    expect(appSource).not.toContain('ipcMain.handle(IpcChannels.modelProvidersGenerateImageV2')
    expect(block.indexOf('validateImageGenerationInput(')).toBeLessThan(
      block.indexOf('resolveRuntimeProvider(providerId)')
    )
    expect(block.indexOf('resolveRuntimeProvider(providerId)')).toBeLessThan(
      block.indexOf('generateProviderImages(')
    )
    // T2：生成前先落 pending 消息，完成时用同一 id settle（不新增一条消息）。
    expect(block).toContain('assistantImageMessages.prepare(')
    expect(block).toContain('assistantImageMessages.settle(')
    expect(block.indexOf('assistantImageMessages.prepare(')).toBeLessThan(block.indexOf('generateProviderImages('))
    // IPC 只返回结构化结果，不抛裸错误；不写日志、不回显 base64。
    expect(block).not.toContain('throw new Error')
    expect(block).not.toMatch(/console\./)
    expect(block).not.toContain('base64')
    expect(preloadMethodBlock(preloadSource, 'generateImage')).toContain(
      'IpcChannels.modelProvidersGenerateImage'
    )
    expect(preloadMethodBlock(preloadSource, 'generateImage')).toContain('topicId: input.topicId')
  })

  it('serves generated images through a single read-only app-image protocol instead of a new IPC channel', () => {
    // T1：图片用自定义协议读盘（不在渲染层拼路径、不新增 IPC 通道）。
    expect(appSource).toContain('registerGeneratedImageScheme()')
    expect(appSource).toContain('registerGeneratedImageProtocol(generatedImagesDirectory)')
    expect(appSource).toContain('createGeneratedImageStorage({ directory: generatedImagesDirectory })')
    // scheme 必须在 app ready 之前注册，handle 必须在 ready 之后。
    expect(appSource.indexOf('registerGeneratedImageScheme()')).toBeLessThan(
      appSource.indexOf('await app.whenReady()')
    )
    expect(appSource.indexOf('await app.whenReady()')).toBeLessThan(
      appSource.indexOf('registerGeneratedImageProtocol(generatedImagesDirectory)')
    )
    // 没有为读图新增任何通道：既有精确面断言逐字未变。
    expect(Object.keys(IpcChannels).filter((name) => /image/i.test(name))).toEqual([
      'appSaveClipboardImage',
      'modelProvidersGenerateImage'
    ])
    // Clipboard pixels are an attachment write path, not a generated-image read path.
    expect(windowIpcSource).toContain('IpcChannels.appSaveClipboardImage')
    expect(windowIpcSource).toContain("app.getPath('temp')")
  })

  it('runs the comparison probe only inside the on-demand self-test', () => {
    // 本地优先的应用不该每次启动去握手外部 IP：探针只允许出现在自检 handler 里（现已随模型服务搬家）。
    expect(modelIpcSource.split('probeDirectEgress(').length - 1).toBe(1)
  })

  it('rejects an invalid proxy address before the settings file is written', () => {
    // handler 已搬到 ipc/settingsIpc.ts：断言跟着实现走，不再读 app.ts 的文本。
    const settingsSource = readSource('ipc/settingsIpc.ts')
    expect(settingsSource).toContain("import { assertProxySettingsPatchAccepted } from '../../../network/proxySettingsGuard'")
    const guardIndex = settingsSource.indexOf('assertProxySettingsPatchAccepted(patch, (await ports.settings.get()).network)')
    expect(guardIndex).toBeGreaterThan(-1)
    // 校验必须先于落盘：抛错时 settings.update 根本没被调用，settings.json 不会留下坏地址。
    expect(guardIndex).toBeLessThan(settingsSource.indexOf('const next = await ports.settings.update(patch)'))
  })

  it('keeps the attachment text preview on its existing channel but reads it from platform/files', () => {
    // 附件读取归位后只剩这一条接缝：通道不变，preload 不变，实现改由 platform/files/attachments 提供。
    expect(windowIpcSource).toContain(
      "import { readTextFilePreview } from '../../../files/attachments/textFilePreview'"
    )
    expect(windowIpcSource).toContain(
      'ipcMain.handle(IpcChannels.appReadTextFile, async (_event: IpcMainInvokeEvent, path: string) => readTextFilePreview(path))'
    )
    expect(preloadSource).toContain(
      'readTextFile: (path: string) => ipcRenderer.invoke(IpcChannels.appReadTextFile, path)'
    )
    // 实现只留一份：启动文件里不允许再长出第二个读取实现或第二个 128 KiB 上限。
    expect(appSource).not.toContain('TEXT_FILE_READ_LIMIT_BYTES = 128 * 1024')
    expect(appSource).not.toContain('function isLikelyBinary')
    expect(windowIpcSource).not.toContain('TEXT_FILE_READ_LIMIT_BYTES = 128 * 1024')
    expect(windowIpcSource).not.toContain('function isLikelyBinary')
  })

  it('wires the PLAT-82 detection channels end to end (memory-only, no writes)', () => {
    expect(IpcChannels.modelProvidersDetectModels).toBe('platform:model-providers-detect-models')
    expect(IpcChannels.modelProvidersCancelModelDetection)
      .toBe('platform:model-providers-cancel-model-detection')
    expect(IpcChannels.modelProvidersDetectionProgress)
      .toBe('platform:model-providers-detection-progress')
    expect(IpcChannels.modelProvidersDetectionDone)
      .toBe('platform:model-providers-detection-done')
    // 旧探针通道与 preload 方法一并删除（不留透传路径）。
    expect(appSource).not.toContain('probeModelMessages')
    expect(preloadSource).not.toContain('probeModelMessages')
    expect(Object.keys(IpcChannels)).not.toContain('modelProvidersProbeModelMessages')

    const block = mainRegistrationBlock(modelIpcSource, 'modelProvidersDetectModels')
    // 运行器在主进程：供应商解析 + 平台 fetch（Key 只在主进程解析）。
    expect(modelIpcSource).toContain('resolveProvider: (providerId: string) => providerStore.resolveRuntimeProvider(providerId)')
    expect(modelIpcSource).toContain('fetch: () => getPlatformFetch()')
    // 检测**绝不写库**：旧 handler 里的落盘调用不得回来。
    expect(block).not.toContain('addOrUpdateModel')
    // progress = 完整 result（含 protocols / protocolSkipReason / declaredProtocolFailures）；
    // done = (runId, { stopped })。
    expect(modelIpcSource).toContain('IpcChannels.modelProvidersDetectionProgress, result')
    expect(modelIpcSource).toContain('IpcChannels.modelProvidersDetectionDone, runId, payload')

    const preloadBlock = preloadMethodBlock(preloadSource, 'detectModels')
    expect(preloadBlock).toContain('IpcChannels.modelProvidersDetectModels')
    expect(preloadMethodBlock(preloadSource, 'cancelModelDetection'))
      .toContain('IpcChannels.modelProvidersCancelModelDetection')
    expect(preloadMethodBlock(preloadSource, 'onModelDetectionProgress'))
      .toContain('IpcChannels.modelProvidersDetectionProgress')
    expect(preloadMethodBlock(preloadSource, 'onModelDetectionDone'))
      .toContain('IpcChannels.modelProvidersDetectionDone')
    // 两个订阅方法都返回取消订阅函数（防泄漏）。
    expect(preloadMethodBlock(preloadSource, 'onModelDetectionProgress')).toContain('removeListener')
    expect(preloadMethodBlock(preloadSource, 'onModelDetectionDone')).toContain('removeListener')
  })

  it('reuses the existing test-connection channel for per-endpoint probes with strict validation', () => {
    const block = mainRegistrationBlock(modelIpcSource, 'modelProvidersTestConnection')

    // 不新增通道：端点探测走既有 testConnection 的 additive 参数。
    expect(block).toContain('endpointTest')
    expect(block).toContain('isEndpointProbeKind(')
    expect(block).toContain('probeProviderEndpoint(')
    expect(block).toContain('resolveRuntimeProvider(providerId)')
    // 未知端点类型 / 非 http(s) 地址必须在发请求前拒绝。
    expect(block).toContain("throw new Error('Unknown endpoint kind for probe.')")
    expect(block).toContain("throw new Error('Endpoint probe requires an http(s) base URL.')")
    expect(block.indexOf('isEndpointProbeKind(')).toBeLessThan(block.indexOf('probeProviderEndpoint('))
    expect(block.indexOf('Endpoint probe requires an http(s) base URL.')).toBeLessThan(
      block.indexOf('probeProviderEndpoint(')
    )
    // 探针结果不含凭据，handler 也不得打印任何东西。
    expect(block).not.toMatch(/console\./)
    expect(appSource).not.toMatch(/console\.[a-z]+\([^)]*endpointTest/i)
  })

  it('registers the reveal handler behind strict provider validation and never logs the key', () => {
    const block = mainRegistrationBlock(modelIpcSource, 'modelProvidersRevealApiKey')

    expect(block).toContain("typeof providerId !== 'string'")
    expect(block).toContain('providerStore.list()')
    expect(block).toContain('providerStore.revealApiKey(providerId)')
    expect(block).toContain('{ apiKey:')
    expect(block).not.toMatch(/console\./)
    expect(block).not.toContain('JSON.stringify')
    // 整个 handler 模块不得把凭据打印到任何 console（含既有日志语句）。
    expect(modelIpcSource).not.toMatch(/console\.[a-z]+\([^)]*apiKey/i)
    expect(preloadMethodBlock(preloadSource, 'revealApiKey')).toContain(
      'IpcChannels.modelProvidersRevealApiKey'
    )
  })
})

function mainRegistrationBlock(source: string, channel: string): string {
  const token = `IpcChannels.${channel},`
  const tokenIndex = source.indexOf(token)
  expect(tokenIndex).toBeGreaterThanOrEqual(0)
  const start = source.lastIndexOf('ipcMain.handle(', tokenIndex)
  expect(start).toBeGreaterThanOrEqual(0)
  const end = source.indexOf('ipcMain.handle(', tokenIndex + token.length)
  return source.slice(start, end < 0 ? undefined : end)
}

function preloadMethodBlock(source: string, method: string): string {
  const start = source.indexOf(`${method}:`)
  expect(start).toBeGreaterThanOrEqual(0)
  const rest = source.slice(start + method.length + 1)
  const next = rest.search(/\n    [a-zA-Z]\w+: /)
  return source.slice(start, next < 0 ? undefined : start + method.length + 1 + next)
}

describe('notification delete-read surface', () => {
  it('reaches the renderer only through the runtime, on its own channel', () => {
    // 通道名独立，不与「清空 = 标已读」或「单条收起」复用。
    expect(IpcChannels.notificationsDeleteRead).toBe('platform:notifications-delete-read')
    // 主进程 handler 走运行时方法，不自己摸存储。
    expect(notificationIpcSource).toContain('IpcChannels.notificationsDeleteRead')
    expect(notificationIpcSource).toContain('getNotificationRuntime().deleteRead()')
    // 渲染层入口：preload 暴露方法，但命名空间里只有这一个删除方法。
    expect(preloadSource).toContain('deleteRead: () => ipcRenderer.invoke(IpcChannels.notificationsDeleteRead)')
  })
})
