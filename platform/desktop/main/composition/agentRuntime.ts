import { app } from 'electron'
import { join } from 'node:path'
import { AgentSessionRuntimeService } from '../../../ai/agent-platform/runtime/AgentSessionRuntimeService'
import { createAgentRuntimeConsoleTraceRecorder } from '../../../ai/agent-platform/runtime/AgentRuntimeOpenTelemetryTraceRecorder'
import { AgentRuntimeCompositionService } from '../../../ai/agent-platform/runtime/AgentRuntimeCompositionService'
import { resolveEffectiveAgentModel } from '../../../ai/agent-platform/runtime/effectiveAgentModel'
import { TaskManagementToolRuntimeService } from '../../../ai/agent-platform/runtime/tasks'
import { RuntimeDriverRegistry } from '../../../ai/agent-platform/runtime/RuntimeDriverRegistry'
import { ToolApprovalRegistry } from '../../../ai/agent-platform/runtime/policy'
import { McpRuntimeService } from '../../../ai/agent-platform/mcp'
import { createSkillSearchService } from '../../../ai/agent-platform/skills/skillSearchService'
import { createSkillService } from '../../../ai/agent-platform/skills/skillService'
import { SkillsRuntimeService } from '../../../ai/agent-platform/skills/SkillsRuntimeService'
import { ToolRegistry } from '../../../ai/agent-platform/tools'
import { syncInUseModelPatrolSchedule } from '../../../ai/providers/registerInUseModelPatrolJob'
import { ProductAgentToolHandlerRegistration } from '../../../ai/agent-platform/productTools/productAgentToolBootstrapContracts'
import { ProductAgentToolRegistry, ProductAgentToolRuntimeService } from '../../../ai/agent-platform/productTools'
import { createSqliteProductAgentToolTraceRepository } from '../../../ai/agent-platform/productTools/createSqliteProductAgentToolTraceRepository'
import { reportPanelWorkspaceFlush } from '../workspace/panelWorkspaceStartupReport'
import { refreshAgentMcpTools } from '../agentMcpRefresh'
import { createMcpRuntimeServerHostFactory } from '../mcpRuntimeServerHostFactory'
import { createSkillRuntimeCapabilityResolver, createSkillRuntimeToolsResolver } from '../skillRuntimeCapabilities'
import { createSkillRuntimeToolHost } from '../skillRuntimeToolHost'
import { replaceAgentStateForConstruction } from './agentStateBridge'
import type { createPlatformCore } from './platformCore'
import type { createRepositories } from './repositories'
import { getAgentTaskExecutionCoordinator, setAgentTaskExecutionCoordinator, getAgentTaskRunController, setAgentTaskRunController, getJobRuntimeForDisposal, setJobRuntimeForDisposal, getPanelWorkspaceForDisposal, setPanelWorkspaceForDisposal, getProductIpcRegistryForDisposal, setProductIpcRegistryForDisposal, getDisposeTaskAutomationMaintenance, setDisposeTaskAutomationMaintenance, getDisposeJobRunRetention, setDisposeJobRunRetention, getDisposeChannelMaintenanceJobs, setDisposeChannelMaintenanceJobs, getInstalledProductManifestIds, setInstalledProductManifestIds, getAgentTaskExecutionCoordinatorOrNull } from './slots'

export type AgentRuntimePorts = Readonly<{
  userDataPath: string
  tempPath: string
  core: ReturnType<typeof createPlatformCore>
  repositories: ReturnType<typeof createRepositories>
  hooks: {
    getAgentTaskExecutionCoordinator: typeof getAgentTaskExecutionCoordinator
    getAgentTaskExecutionCoordinatorOrNull: typeof getAgentTaskExecutionCoordinatorOrNull
    setAgentTaskExecutionCoordinator: typeof setAgentTaskExecutionCoordinator
    getAgentTaskRunController: typeof getAgentTaskRunController
    setAgentTaskRunController: typeof setAgentTaskRunController
    getJobRuntimeForDisposal: typeof getJobRuntimeForDisposal
    setJobRuntimeForDisposal: typeof setJobRuntimeForDisposal
    getPanelWorkspaceForDisposal: typeof getPanelWorkspaceForDisposal
    setPanelWorkspaceForDisposal: typeof setPanelWorkspaceForDisposal
    getProductIpcRegistryForDisposal: typeof getProductIpcRegistryForDisposal
    setProductIpcRegistryForDisposal: typeof setProductIpcRegistryForDisposal
    getDisposeTaskAutomationMaintenance: typeof getDisposeTaskAutomationMaintenance
    setDisposeTaskAutomationMaintenance: typeof setDisposeTaskAutomationMaintenance
    getDisposeJobRunRetention: typeof getDisposeJobRunRetention
    setDisposeJobRunRetention: typeof setDisposeJobRunRetention
    getDisposeChannelMaintenanceJobs: typeof getDisposeChannelMaintenanceJobs
    setDisposeChannelMaintenanceJobs: typeof setDisposeChannelMaintenanceJobs
    getInstalledProductManifestIds: typeof getInstalledProductManifestIds
    setInstalledProductManifestIds: typeof setInstalledProductManifestIds
  }
}>

/** 退出清理已开始的标记。历史遗留：当前没有任何赋值点，读取恒为 false（见台账）。 */
export let platformRuntimesDisposed = false

export function createAgentRuntime(ports: AgentRuntimePorts) {
  const { userDataPath, tempPath, core, repositories } = ports
  const {
    settingsStore, shellTimeZone, providerStore, providerSecretVault, appLog, rendererProcessLog, mainWindowHost, taskIpcScheduleValidationOptions, platformDataDirectory, workspaceTestFixtures
  } = core
  const {
    agentDatabase, assistantDatabase, agentRepositories, assistantRepositories, generatedImageStorage, assistantImageMessages,
    channelInboundRepository, channelDeliveryRepository, channelManagementRepository, channelAdapterRegistry, channelAcceptance,
    telegramOffsetRepository, slackRuntimeRepository, larkRuntimeRepository, qqRuntimeRepository, discordRuntimeRepository,
    wechatEnrollmentRepository, wechatRuntimeRepository, jobRunStore, channelCredentialVault, channelManagementService,
    agentStore, inUseModelPatrol, agentServices, generatedImagesDirectory
  } = repositories
  const {
    getAgentTaskExecutionCoordinator,
    getAgentTaskExecutionCoordinatorOrNull,
    setAgentTaskExecutionCoordinator,
    getAgentTaskRunController,
    setAgentTaskRunController,
    getJobRuntimeForDisposal,
    setJobRuntimeForDisposal,
    getPanelWorkspaceForDisposal,
    setPanelWorkspaceForDisposal,
    getProductIpcRegistryForDisposal,
    setProductIpcRegistryForDisposal,
    getDisposeTaskAutomationMaintenance,
    setDisposeTaskAutomationMaintenance,
    getDisposeJobRunRetention,
    setDisposeJobRunRetention,
    getDisposeChannelMaintenanceJobs,
    setDisposeChannelMaintenanceJobs,
    getInstalledProductManifestIds,
    setInstalledProductManifestIds,
  } = ports.hooks

const skillsRoot = join(userDataPath, 'platform', 'agents', 'Skills')
const skillRuntimeCapabilityResolver = createSkillRuntimeCapabilityResolver({
  skillsRoot
})
const skillRuntimeToolsResolver = createSkillRuntimeToolsResolver({
  skillsRoot
})
const skillService = createSkillService({
  paths: {
    skillsRoot,
    installTempRoot: join(tempPath, 'ai-desktop-platform', 'skill-install')
  },
  queries: {
    list: agentRepositories.skills.list
  }
})
const skillSearchService = createSkillSearchService()
const agentSystemWorkspacesRoot = join(userDataPath, 'platform', 'agents', 'workspaces')
const runtimeDriverRegistry = new RuntimeDriverRegistry()
const toolApprovalRegistry = new ToolApprovalRegistry()
const toolRegistry = new ToolRegistry()
const productAgentToolRegistry = new ProductAgentToolRegistry()
const productAgentToolRuntimeService = new ProductAgentToolRuntimeService({
  registry: productAgentToolRegistry,
  toolRegistry,
  traceRepository: createSqliteProductAgentToolTraceRepository(agentDatabase),
  installedProductIds: () => getInstalledProductManifestIds()
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
          replaceAgentState: replaceAgentStateForConstruction
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
  runTask: (input) => getAgentTaskExecutionCoordinator().enqueueManualRun(input)
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
/**
 * P1-06m 退出期编排状态现在由 `lifecycle/quit.ts` 的编排器持有（四个布尔收进一个对象）：
 * `before-quit` 置标记、挂起本轮退出、有界清理后放行一次 `app.quit()`。
 * 派生窗工厂据此在退出期**不再** preventDefault（否则 Electron 的退出关窗相位被取消 ⇒ 进程残留）。
 */

/** 供应商的启用/凭据/增删都会改变「有没有可探目标」，调度要跟着走。 */
function syncInUseModelPatrolScheduleFromState(): void {
  const runtime = getJobRuntimeForDisposal()
  if (!runtime) return
  void syncInUseModelPatrolSchedule(runtime, {
    isReady: async () => {
      const providers = (await providerStore.getState()).providers
      return providers.some((provider) => provider.enabled && Boolean(provider.apiKeyRef))
    }
  })
}
/**
 * 退出清理开始后 product IPC 只回答结构化 unavailable（见 `productIpcInvoker`）。
 * 这里持有同一实例，保证「清理已开始」先于任何产品 DB 关闭被登记。
 */
/** workspace 组合体：只在产品注册 seal 之后建立，用于退出时的有界布局 flush。 */
/**
 * P1-06m：退出第一件事 —— 把 debounce（250ms）窗口内的待写布局**有界落盘**并记录结果。
 * 放在所有其它清理之前：后续清理可能很慢甚至挂住，绝不让它吃掉退出前最后一次布局变更。
 * 组合体尚未建立（禁用态/启动早期）时直接跳过：没有工作区就没有待写可谈。
 */
async function flushPanelWorkspaceLayoutForExit(): Promise<void> {
  const workspace = getPanelWorkspaceForDisposal()
  if (workspace === null) return
  // 绝不抛：flushLayout 内部已把异常收敛成 failed，这里只负责把受控报告落日志
  reportPanelWorkspaceFlush({ report: await workspace.flushLayout() })
}

  return {
    registerProductAgentToolHandler,
    syncInUseModelPatrolScheduleFromState,
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
  }
}
