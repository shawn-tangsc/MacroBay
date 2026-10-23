import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { IpcChannels } from '../ipc/channels'

const appSource = readFileSync(resolve(__dirname, 'app.ts'), 'utf8')
const preloadSource = readFileSync(resolve(__dirname, '../preload/index.ts'), 'utf8')
const taskIpcHelperSource = readFileSync(resolve(__dirname, 'registerAgentTaskIpcHandlers.ts'), 'utf8')
const generatedProductManifestsSource = readFileSync(resolve(__dirname, '../../../products/generated/productManifests.ts'), 'utf8')
const generatedProductServicesSource = readFileSync(resolve(__dirname, '../../../products/generated/productServices.ts'), 'utf8')
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
    expect(appSource).toContain('channelMigrationReconciler: channelCredentialMigrationReconciler')
    expect(appSource.indexOf('channelMigrationReconciler: channelCredentialMigrationReconciler')).toBeLessThan(
      appSource.indexOf('const agentServices = createAgentPlatformServices')
    )
    expect(appSource).toContain('IpcChannels.modelProvidersRunRuntimeChecks')
    expect(appSource).toContain('IpcChannels.modelProvidersGetRuntimeCheckReport')
    expect(appSource).toContain('IpcChannels.agentsGetRuntimeCompatibility')
    expect(appSource).toContain('IpcChannels.agentsProbeRuntimeCompatibility')
    expect(appSource).toContain('IpcChannels.agentsGetModelGatewayStatus')
    expect(appSource).toContain('IpcChannels.agentsStartModelGateway')
    expect(appSource).toContain('IpcChannels.agentsStopModelGateway')
    expect(appSource).toContain('IpcChannels.agentsSetModelGatewayEnabled')
    expect(appSource).toContain('IpcChannels.agentsExecuteRuntimeCommand')
    expect(appSource).toContain('agentIpcHandlers.sendMessage(request)')
    expect(appSource).toContain('getPolicyPreset: async () => (await settingsStore.get()).agent.taskAutomation.policyPreset')
    expect(appSource).toContain('taskManagementRuntime: taskManagementToolRuntimeService')
    expect(appSource).toContain('taskManagementToolBridge: {')
    expect(appSource).toContain('getTaskRunController: () => agentTaskRunController')
    expect(appSource).toContain('await agentTaskExecutionCoordinator?.recoverAfterRestart()')
    expect(appSource).toContain('taskAutomationMaintenance.recoverAfterRestart()')
    expect(appSource).toContain('scheduleTaskAutomationMaintenance(taskAutomationMaintenance)')
    expect(appSource).toContain('channelDeliveryMaintenance.start()')
    expect(appSource).toContain('channelInboundExecutionRunner.startRecovery()')
    expect(appSource).toContain('disposeChannelDeliveryMaintenance?.()')
    expect(appSource).toContain('disposeChannelInboundRecovery?.()')
    expect(appSource).toContain('ChannelManagementService')
    expect(appSource).toContain('IpcChannels.channelsCatalog')
    expect(appSource).toContain('IpcChannels.channelsCredentialSubmit')
    expect(appSource).toContain('IpcChannels.channelsPolicyCreate')
    expect(appSource).toContain('IpcChannels.channelsRuntimeStatus')
    expect(appSource).toContain('asChannelHandoff')
    expect(appSource).toContain('isP256PublicJwk')
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
    expect(appSource).toContain('persistChannelConfig: async (channelId, nextConfig) => {')
    expect(appSource).toContain('await agentServices.channels.update(channelId, {')
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
    expect(appSource).toContain("registerChannelRuntimeHostFactory('telegram'")
    expect(appSource).toContain("if (type !== 'telegram') throw new Error('channel-runtime-adapter-blocked')")
    expect(appSource).toContain('if (taskAutomationSmokeProfile.enabled)')
    expect(appSource).toContain('resolveBootstrapProductManifests(options.productManifests ?? [], taskAutomationSmokeProfile.enabled)')
    expect(appSource).toContain('if (!taskAutomationSmokeProfile.enabled) await options.registerProductServices?.({')
    expect(appSource).toContain('agentIpcHandlers.sendMessage(request)')
    expect(appSource).toContain('IpcChannels.assistantsStreamOpen')
    expect(appSource).toContain('IpcChannels.webSearchFetchUrls')
    expect(appSource).toContain('IpcChannels.storageListCaches')
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
    expect(appSource).toContain('IpcChannels.modelProvidersList')
    expect(appSource).toContain('IpcChannels.modelProvidersUpsert')
    expect(appSource).toContain('IpcChannels.modelProvidersTestConnection')
    expect(appSource).toContain('IpcChannels.modelProvidersPreviewModelSync')
    const modelSyncHandler = appSource.slice(appSource.indexOf('IpcChannels.modelProvidersPreviewModelSync'))
    expect(modelSyncHandler).toContain('const provider = await providerStore.resolveRuntimeProvider(providerId)')
    expect(modelSyncHandler).not.toContain("(await providerStore.getState()).providers.find((item) => item.id === providerId)")
    expect(appSource).not.toContain('testModelProviderConnection(provider, options)')
    expect(appSource).not.toContain('apiKey: options?.apiKey')
    expect(appSource).toContain('IpcChannels.assistantsStreamOpen')
    expect(appSource).toContain('IpcChannels.agentsSendMessage')
    expect(appSource).toContain('IpcChannels.productIpcInvoke')
  })

  it('passes the existing generic provider vault through the product service seam', () => {
    expect(appSource).toContain('secretVault: providerSecretVault')
    expect(appSource.indexOf('secretVault: providerSecretVault')).toBeGreaterThan(
      appSource.indexOf('if (!taskAutomationSmokeProfile.enabled) await options.registerProductServices?.({')
    )
  })

  it('passes the model-service defaults through the product service seam', () => {
    // 默认翻译模型等默认值只读透出：产品不得自己读写 app settings。
    expect(appSource).toContain('getModelDefaults: async () => (await settingsStore.get()).modelDefaults')
    expect(appSource.indexOf('getModelDefaults: async () => (await settingsStore.get()).modelDefaults')).toBeGreaterThan(
      appSource.indexOf('if (!taskAutomationSmokeProfile.enabled) await options.registerProductServices?.({')
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
    expect(appSource).toContain('IpcChannels.productSummaries')
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
    expect(appSource).toContain('IpcChannels.agentsSendMessage')
    expect(appSource).toContain('IpcChannels.assistantsStreamOpen')
    expect(appSource).toContain('IpcChannels.productIpcInvoke')
    expect(appSource).toContain('registerAgentTaskIpcHandlers(ipcMain, agentIpcHandlers, {')
    expect(appSource).toContain('registerJobIpcHandlers(')
  })

  it('creates a visible boot window before product registration and loads the renderer only after sealing product IPC', () => {
    const bootstrapSource = appSource.slice(appSource.indexOf('export async function bootstrapDesktopApp('))
    const bootWindow = 'mainWindow = await createMainWindow()'
    const proxyApply = 'await applySessionProxySettings((await settingsStore.get()).network)'
    const productRegistration = 'if (!taskAutomationSmokeProfile.enabled) await options.registerProductServices?.({'
    const productSeal = 'productIpcRegistry.seal(expectedProductIpcMethods(productManifests))'
    const rendererLoad = 'await loadMainWindowRenderer(mainWindow)'

    expect(bootstrapSource).toContain(bootWindow)
    expect(bootstrapSource).toContain(proxyApply)
    expect(bootstrapSource).toContain(productSeal)
    expect(bootstrapSource).toContain(rendererLoad)
    expect(bootstrapSource.indexOf(bootWindow)).toBeLessThan(bootstrapSource.indexOf(productRegistration))
    expect(bootstrapSource.indexOf(proxyApply)).toBeLessThan(bootstrapSource.indexOf(productRegistration))
    expect(bootstrapSource.indexOf(productRegistration)).toBeLessThan(bootstrapSource.indexOf(productSeal))
    expect(bootstrapSource.indexOf(productSeal)).toBeLessThan(bootstrapSource.indexOf(rendererLoad))
    expect(bootstrapSource).toContain('platformFetch: getPlatformFetch()')
    expect(bootstrapSource.indexOf(proxyApply)).toBeLessThan(bootstrapSource.indexOf('platformFetch: getPlatformFetch()'))
  })

  it('recovers stale persistent job runs before product startup can enqueue current-process work', () => {
    const bootstrapSource = appSource.slice(appSource.indexOf('export async function bootstrapDesktopApp('))
    const staleRecovery = 'jobRuntime.recover()'
    const productRegistration = 'if (!taskAutomationSmokeProfile.enabled) await options.registerProductServices?.({'

    expect(bootstrapSource).toContain(staleRecovery)
    expect(bootstrapSource.indexOf(staleRecovery)).toBeLessThan(bootstrapSource.indexOf(productRegistration))
  })

  it('treats proxy application failure as a startup boundary before products and the normal renderer', () => {
    const bootstrapSource = appSource.slice(appSource.indexOf('export async function bootstrapDesktopApp('))
    const proxyApply = 'await applySessionProxySettings((await settingsStore.get()).network)'
    const productRegistration = 'if (!taskAutomationSmokeProfile.enabled) await options.registerProductServices?.({'
    const rendererLoad = 'await loadMainWindowRenderer(mainWindow)'
    const proxyApplyIndex = bootstrapSource.indexOf(proxyApply)
    const productRegistrationIndex = bootstrapSource.indexOf(productRegistration)

    expect(proxyApplyIndex).toBeLessThan(productRegistrationIndex)
    expect(proxyApplyIndex).toBeLessThan(bootstrapSource.indexOf(rendererLoad))
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
    expect(appSource).toContain('IpcChannels.assistantsList')
    expect(appSource).toContain('IpcChannels.assistantsStreamOpen')
    expect(appSource).toContain('IpcChannels.assistantsEditAndResendUserMessage')
    expect(appSource).toContain('IpcChannels.assistantsLibraryListTemplates')
    expect(appSource).toContain('IpcChannels.assistantsLibraryInstallTemplate')
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
    expect(appSource).toContain('createWebSearchIpcHandlers')
    expect(appSource).toContain('IpcChannels.webSearchListProviders')
    expect(appSource).toContain('IpcChannels.webSearchRevealProviderApiKey')
    expect(appSource).toContain('IpcChannels.webSearchCheckProvider')
    expect(appSource).toContain('IpcChannels.webSearchFetchUrls')
    expect(appSource).toContain('IpcChannels.assistantsStreamOpen')
    expect(appSource).toContain('IpcChannels.assistantsEditAndResendUserMessage')
    expect(appSource).toContain('IpcChannels.agentsSendMessage')
    expect(appSource).toContain('IpcChannels.agentsListProductToolPackages')
  })

  it('keeps storage and cache IPC handlers registered without dropping existing seams', () => {
    expect(appSource).toContain('createCacheGovernanceIpcHandlers')
    expect(appSource).toContain("cache-governance.sqlite")
    expect(appSource).toContain('IpcChannels.storageListCaches')
    expect(appSource).toContain('IpcChannels.storageInspectCache')
    expect(appSource).toContain('IpcChannels.storageClearCache')
    expect(appSource).toContain('IpcChannels.storageCompactCache')
    expect(appSource).toContain('IpcChannels.storageListCacheOperations')
    expect(appSource).toContain('IpcChannels.assistantsStreamOpen')
    expect(appSource).toContain('IpcChannels.webSearchFetchUrls')
    expect(appSource).toContain('IpcChannels.agentsSendMessage')
  })

  it('wires renderer lifecycle diagnostics to every main window', () => {
    expect(appSource).toContain("import { wireRendererProcessDiagnostics } from '../window/rendererProcessDiagnostics'")
    expect(appSource).toContain("import { createRendererProcessLog } from '../window/rendererProcessLog'")
    expect(appSource).toContain('wireRendererProcessDiagnostics(window')
    expect(appSource).toContain("'renderer-lifecycle.ndjson'")
  })

  it('owns product service disposal alongside platform runtime disposal', () => {
    expect(appSource).toContain('createProductServiceDisposerRegistry')
    expect(appSource).toContain('registerProductDisposer: productServiceDisposerRegistry.register')
    expect(appSource).toContain('productServiceDisposerRegistry.disposeAll()')
  })

  it('registers the panel workspace channels before the boot window and restores after product sealing', () => {
    const bootstrapSource = appSource.slice(appSource.indexOf('export async function bootstrapDesktopApp('))
    const compose = 'const panelWorkspace = composePanelWorkspace({'
    const registerChannels = 'panelWorkspace.registerChannels()'
    const bootWindow = 'mainWindow = await createMainWindow()'
    const restore = 'await panelWorkspace.start()'
    const productSeal = 'productIpcRegistry.seal(expectedProductIpcMethods(productManifests))'
    const rendererLoad = 'await loadMainWindowRenderer(mainWindow)'

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
    expect(bootstrapSource.indexOf(productSeal)).toBeLessThan(bootstrapSource.indexOf(rendererLoad))
    // 退出走 workspace 有界 flush
    expect(appSource).toContain('await panelWorkspaceForDisposal?.dispose()')
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
    expect(appSource).toContain('IpcChannels.agentsSendMessage')
    expect(appSource).toContain('IpcChannels.assistantsStreamOpen')
    expect(appSource).toContain('IpcChannels.productIpcInvoke')
    expect(appSource).toContain('IpcChannels.webSearchFetchUrls')
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
    expect(appSource).toContain('IpcChannels.agentsSendMessage')
    expect(appSource).toContain('IpcChannels.assistantsStreamOpen')
    expect(appSource).toContain('IpcChannels.productIpcInvoke')
  })

  it('wires exactly one image generation/edit channel behind strict validation and message persistence', () => {
    expect(IpcChannels.modelProvidersGenerateImage).toBe('platform:model-providers-generate-image')
    const block = mainRegistrationBlock(appSource, 'modelProvidersGenerateImage')

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
    expect(appSource).not.toContain('modelProvidersEditImage')
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
    expect(appSource).toContain('IpcChannels.appSaveClipboardImage')
    expect(appSource).toContain("app.getPath('temp')")
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

    const block = mainRegistrationBlock(appSource, 'modelProvidersDetectModels')
    // 运行器在主进程：供应商解析 + 平台 fetch（Key 只在主进程解析）。
    expect(appSource).toContain('resolveProvider: (providerId: string) => providerStore.resolveRuntimeProvider(providerId)')
    expect(appSource).toContain('fetch: () => getPlatformFetch()')
    // 检测**绝不写库**：旧 handler 里的落盘调用不得回来。
    expect(block).not.toContain('addOrUpdateModel')
    // progress = 完整 result（含 protocols / protocolSkipReason / declaredProtocolFailures）；
    // done = (runId, { stopped })。
    expect(appSource).toContain('IpcChannels.modelProvidersDetectionProgress, result')
    expect(appSource).toContain('IpcChannels.modelProvidersDetectionDone, runId, payload')

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
    const block = mainRegistrationBlock(appSource, 'modelProvidersTestConnection')

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
    const block = mainRegistrationBlock(appSource, 'modelProvidersRevealApiKey')

    expect(block).toContain("typeof providerId !== 'string'")
    expect(block).toContain('providerStore.list()')
    expect(block).toContain('providerStore.revealApiKey(providerId)')
    expect(block).toContain('{ apiKey:')
    expect(block).not.toMatch(/console\./)
    expect(block).not.toContain('JSON.stringify')
    // 整个 main handler 文件不得把凭据打印到任何 console（含既有日志语句）。
    expect(appSource).not.toMatch(/console\.[a-z]+\([^)]*apiKey/i)
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
