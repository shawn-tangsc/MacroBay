import type { IpcMain } from 'electron'

import type { AgentStoreState } from '@platform/ai/agent-platform/store/agentStore'
import { refreshAgentMcpTools, type AgentMcpRefreshDependencies } from '../agentMcpRefresh'
import { registerAgentToolsIpc } from '../ipc/agentToolsIpc'

/**
 * 智能体**工具**那一半 IPC 的装配（16 个 handler）。
 *
 * 这一片搬走的不只是 6 个键，还有 `refreshMcpTools` 里那 4 行内联构造——它原先在 `app.ts`
 * 里现场拼三份依赖，是装配区里唯一带嵌套对象的一处。拼法现在只在这里出现一次。
 *
 * 状态读法逐条（和 `model` 那片同一格式，搬家最容易丢的是这类隐式约定）：
 *
 * | 端口 | 谁提供 | 什么时候读 | 为什么是这个时机 |
 * |---|---|---|---|
 * | `getState` | 组合根（`agentStore`） | 每次 handler 调用 | 技能/MCP 改动后要立刻看到新状态，不缓存 |
 * | `skillService` | 组合根 | 每次安装/卸载 | 服务无状态，持有实例即可 |
 * | `skillSearchService` | 组合根 | 每次搜索 | 索引随状态变，实例内部自己维护 |
 * | `refreshMcpTools` | **本模块拼**，依赖由调用方给 | 按 serverId 触发 | MCP 运行时的刷新要拿「当前状态 → 刷新 → 写回」一条链，链在这里拼一次 |
 * | `replaceStateAfterSkillMutation` | 组合根 | 技能增删后 | 状态替换只有一个入口，不在这里另写一份 |
 *
 * 一条**不许在这里判断**的事：**哪些工具该被暴露**由技能/MCP 注册表决定，不在这里过滤——
 * 这里只负责把调用接到那个判断上。
 */
export type AgentToolsCompositionPorts = Readonly<{
  agentIpcHandlers: ReturnType<typeof import('../agentIpcHandlers').createAgentIpcHandlers>
  getState: () => Promise<AgentStoreState>
  skillService: ReturnType<typeof import('../../../ai/agent-platform/skills/skillService').createSkillService>
  skillSearchService: ReturnType<
    typeof import('../../../ai/agent-platform/skills/skillSearchService').createSkillSearchService
  >
  /** 刷新 MCP 单个服务器工具的依赖（形状归 `agentMcpRefresh`，不在这里另抄一份）。 */
  mcpRefreshDependencies: AgentMcpRefreshDependencies
  replaceAgentStateAfterSkillMutation: (
    previousState: AgentStoreState,
    nextState: AgentStoreState
  ) => Promise<unknown>
}>

export function composeAgentToolsIpc(
  ipcMain: Pick<IpcMain, 'handle'>,
  ports: AgentToolsCompositionPorts
): void {
  registerAgentToolsIpc(ipcMain, {
    agentIpcHandlers: ports.agentIpcHandlers,
    getState: ports.getState,
    skillService: ports.skillService,
    skillSearchService: ports.skillSearchService,
    // MCP 刷新的「读 → 刷 → 写回」链只在这里拼一次；`app.ts` 只给三个动作。
    refreshMcpTools: (serverId) => refreshAgentMcpTools(ports.mcpRefreshDependencies, serverId),
    replaceStateAfterSkillMutation: (previousState, nextState) =>
      ports.replaceAgentStateAfterSkillMutation(previousState, nextState)
  })
}
