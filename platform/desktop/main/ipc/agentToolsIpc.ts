import type { IpcMain, IpcMainInvokeEvent } from 'electron'

import type {
  SkillInstallFromDirectoryOptions,
  SkillInstallFromZipOptions,
  SkillInstallOptions,
  SkillToggleOptions
} from '../../../ai/agent-platform/schemas/skillSchemas'
import type { AgentStoreState } from '../../../ai/agent-platform/store/agentStore'
import { IpcChannels } from '../../ipc/channels'

/**
 * 智能体域的工具那一半（16 个 handler）：MCP 工具刷新、技能读写与安装、产品工具包绑定与调用轨迹。
 * `app.ts` 只留装配与一行接线。
 *
 * 端口按实测闭包给（6 个）；跨域动作（MCP 刷新的依赖装配、技能写入后的状态重放）都收成端口，
 * 新模块不抓 `mainWindow`、不碰 `mcpRuntimeService`。
 */
export type AgentToolsIpcPorts = Readonly<{
  agentIpcHandlers: ReturnType<typeof import('../agentIpcHandlers').createAgentIpcHandlers>
  getState: () => Promise<AgentStoreState>
  skillService: ReturnType<typeof import('../../../ai/agent-platform/skills/skillService').createSkillService>
  skillSearchService: ReturnType<
    typeof import('../../../ai/agent-platform/skills/skillSearchService').createSkillSearchService
  >
  /** MCP 刷新的依赖装配留在 app.ts，这里只按 serverId 触发。 */
  refreshMcpTools: (serverId: string) => Promise<unknown>
  replaceStateAfterSkillMutation: (previousState: AgentStoreState, nextState: AgentStoreState) => Promise<unknown>
}>

export function registerAgentToolsIpc(
  ipcMain: Pick<IpcMain, 'handle'>,
  ports: AgentToolsIpcPorts
): void {
  const {
    agentIpcHandlers,
    getState,
    skillService,
    skillSearchService,
    refreshMcpTools,
    replaceStateAfterSkillMutation
  } = ports

ipcMain.handle(IpcChannels.agentsRefreshMcpTools, async (_event: IpcMainInvokeEvent, serverId: string) =>
  refreshMcpTools(serverId)
)
ipcMain.handle(IpcChannels.agentsSkillsList, async (_event: IpcMainInvokeEvent, query?: { agentId?: string; search?: string }) =>
  skillService.list(await getState(), query)
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
  const previousState = await getState()
  const result = await skillService.install(previousState, options)
  await replaceStateAfterSkillMutation(previousState, result.state)
  return result.skill
})
ipcMain.handle(IpcChannels.agentsSkillsInstallFromZip, async (_event: IpcMainInvokeEvent, options: SkillInstallFromZipOptions) => {
  const previousState = await getState()
  const result = await skillService.installFromZip(previousState, options)
  await replaceStateAfterSkillMutation(previousState, result.state)
  return result.skill
})
ipcMain.handle(
  IpcChannels.agentsSkillsInstallFromDirectory,
  async (_event: IpcMainInvokeEvent, options: SkillInstallFromDirectoryOptions) => {
    const previousState = await getState()
    const result = await skillService.installFromDirectory(previousState, options)
    await replaceStateAfterSkillMutation(previousState, result.state)
    return result.skill
  }
)
ipcMain.handle(IpcChannels.agentsSkillsUninstall, async (_event: IpcMainInvokeEvent, skillId: string) => {
  const previousState = await getState()
  const nextState = await skillService.uninstall(previousState, skillId)
  await replaceStateAfterSkillMutation(previousState, nextState)
  return true
})
ipcMain.handle(IpcChannels.agentsSkillsToggle, async (_event: IpcMainInvokeEvent, options: SkillToggleOptions) => {
  const previousState = await getState()
  const result = await skillService.toggle(previousState, options)
  await replaceStateAfterSkillMutation(previousState, result.state)
  return result.skill
})
ipcMain.handle(IpcChannels.agentsSkillsReadFile, async (_event: IpcMainInvokeEvent, skillId: string, filename: string) =>
  skillService.readFile(await getState(), skillId, filename)
)
ipcMain.handle(IpcChannels.agentsSkillsListFiles, async (_event: IpcMainInvokeEvent, skillId: string) =>
  skillService.listFiles(await getState(), skillId)
)
ipcMain.handle(IpcChannels.agentsSkillsListLocal, (_event: IpcMainInvokeEvent, workdir: string) => skillService.listLocal(workdir))

}
