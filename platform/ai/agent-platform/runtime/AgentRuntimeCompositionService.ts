import { normalizeAgentEffort, normalizePermissionMode } from '../schemas/agentSchemas'
import type { AgentEffort } from '../schemas/agentSchemas'
import type { AgentStoreState } from '../store/agentStore'
import { buildAgentToolCatalog } from '../tools/agentToolCatalog'
import { ToolRegistry } from '../tools/registry'
import type { Tool } from '../schemas/toolSchemas'
import type { McpRuntimeService, McpRuntimeSnapshot } from '../mcp/McpRuntimeService'
import {
  buildSkillRuntimeSourceId,
  type SkillsRuntimeService
} from '../skills/SkillsRuntimeService'
import type { ProductAgentToolsRuntimeSnapshot } from '../productTools/productAgentToolSchemas'
import type { ProductAgentToolRuntimeService } from '../productTools/ProductAgentToolRuntimeService'
import { buildProductAgentToolSourceId } from '../productTools/ProductAgentToolRegistry'
import type { AgentSkillsRuntimeSnapshot } from '../skills/skillRuntimeSchemas'
import {
  TaskManagementToolRuntimeService,
  type TaskManagementToolsRuntimeSnapshot
} from './tasks/TaskManagementToolRuntimeService'
import { DEFAULT_SYSTEM_WORKSPACE_PATH, type AgentWorkspaceType } from '../schemas/workspaceSchemas'
import type { McpServerEntity } from '../schemas/mcpServerSchemas'
import type { EffectiveAgentModel } from './effectiveAgentModel'

export type AgentRuntimeComposition = {
  agentId: string
  sessionId: string
  agentType: AgentStoreState['agents'][number]['type']
  instructions: string | null
  modelId: string | null
  modelName: string | null
  permissionMode: ReturnType<typeof normalizePermissionMode>
  effort?: AgentEffort | null
  workspacePath: string | null
  workspaceType: AgentWorkspaceType | null
  environment: Record<string, string>
  tools: {
    all: Tool[]
    enabled: Tool[]
    disabled: Tool[]
  }
  mcp: McpRuntimeSnapshot & {
    servers: McpServerEntity[]
  }
  skills: AgentSkillsRuntimeSnapshot
  productTools?: ProductAgentToolsRuntimeSnapshot
  taskManagement?: TaskManagementToolsRuntimeSnapshot
}

type AgentRuntimeCompositionInput = {
  state: AgentStoreState
  agentId: string
  sessionId: string
}

type AgentRuntimeCompositionServiceDependencies = {
  toolRegistry: ToolRegistry
  mcpRuntime: Pick<McpRuntimeService, 'getSnapshotForServerIds'>
  skillsRuntime: Pick<SkillsRuntimeService, 'getAgentRuntime'>
  productToolsRuntime?: Pick<ProductAgentToolRuntimeService, 'getAgentRuntime'>
  taskManagementRuntime?: Pick<TaskManagementToolRuntimeService, 'getAgentRuntime'>
  /**
   * 智能体没有显式绑定模型时使用的模型（默认智能体模型）。
   * 由 `effectiveAgentModel` 实现；缺省 = 保持 `agent.model` 原值（老行为）。
   */
  resolveEffectiveModel?: (
    agent: AgentStoreState['agents'][number]
  ) => Promise<EffectiveAgentModel | null>
}

export class AgentRuntimeCompositionService {
  constructor(private readonly deps: AgentRuntimeCompositionServiceDependencies) {}

  async compose(input: AgentRuntimeCompositionInput): Promise<AgentRuntimeComposition> {
    const agent = input.state.agents.find((item) => item.id === input.agentId)
    if (!agent) {
      throw new Error(`Agent "${input.agentId}" was not found.`)
    }

    const session = input.state.sessions.find((item) => item.id === input.sessionId)
    if (!session) {
      throw new Error(`Session "${input.sessionId}" was not found.`)
    }
    if (session.agentId !== agent.id) {
      throw new Error(`Session "${input.sessionId}" does not belong to agent "${input.agentId}".`)
    }

    const effectiveModel = (await this.deps.resolveEffectiveModel?.(agent)) ?? null

    const toolCatalog = buildAgentToolCatalog({
      agent,
      mcpServers: input.state.mcpServers,
      mcpToolsByServerId: input.state.mcpToolsByServerId
    })
    const enabledMcpServerIds = agent.mcps ?? []
    const skills = this.deps.skillsRuntime.getAgentRuntime(input.state, agent.id)
    const productTools = this.deps.productToolsRuntime?.getAgentRuntime(input.state, agent.id) ?? emptyProductToolsSnapshot(agent.id)
    const taskManagement = (this.deps.taskManagementRuntime ?? defaultTaskManagementRuntime).getAgentRuntime(input.state, agent.id)
    const registryTools = this.deps.toolRegistry.listBySources(
      buildRuntimeToolSourceIds(agent.id, enabledMcpServerIds, skills, productTools)
    )

    return {
      agentId: agent.id,
      sessionId: session.id,
      agentType: agent.type,
      instructions: agent.instructions?.trim() || null,
      modelId: effectiveModel?.model ?? agent.model,
      modelName: effectiveModel?.modelName ?? agent.modelName,
      permissionMode: normalizePermissionMode(agent.configuration?.permission_mode),
      effort: normalizeAgentEffort(agent.configuration?.effort),
      workspacePath: resolveRuntimeWorkspacePath(session.workspace),
      workspaceType: session.workspace?.type ?? null,
      environment: { ...(agent.configuration?.env_vars ?? {}) },
      tools: {
        all: mergeRegistryTools(toolCatalog.all, registryTools),
        enabled: mergeRegistryTools(toolCatalog.enabled, registryTools.filter((tool) => !toolCatalog.disabled.some((item) => item.id === tool.id))),
        disabled: toolCatalog.disabled
      },
      mcp: {
        ...this.deps.mcpRuntime.getSnapshotForServerIds(enabledMcpServerIds),
        servers: input.state.mcpServers
          .filter((server) => enabledMcpServerIds.includes(server.id))
          .map((server) => ({
            ...server,
            args: server.args ? [...server.args] : undefined,
            env: server.env ? { ...server.env } : undefined,
            headers: server.headers ? { ...server.headers } : undefined,
            tags: server.tags ? [...server.tags] : undefined,
            disabledTools: server.disabledTools ? [...server.disabledTools] : undefined,
            disabledAutoApproveTools: server.disabledAutoApproveTools
              ? [...server.disabledAutoApproveTools]
              : undefined
          }))
      },
      skills,
      ...(productTools.toolIds.length > 0 || productTools.packages.length > 0 ? { productTools } : {}),
      ...(taskManagement.toolNames.length > 0 ? { taskManagement } : {})
    }
  }
}

const defaultTaskManagementRuntime = new TaskManagementToolRuntimeService()

function resolveRuntimeWorkspacePath(
  workspace: AgentStoreState['sessions'][number]['workspace'] | undefined
): string | null {
  if (!workspace) return null
  const path = workspace.path.trim()
  if (path) return path
  return workspace.type === 'system' ? DEFAULT_SYSTEM_WORKSPACE_PATH : null
}

function emptyProductToolsSnapshot(agentId: string): ProductAgentToolsRuntimeSnapshot {
  return {
    agentId,
    packages: [],
    toolIds: [],
    toolNames: []
  }
}

function buildRuntimeToolSourceIds(
  agentId: string,
  mcpServerIds: readonly string[],
  skills: AgentSkillsRuntimeSnapshot,
  productTools: ProductAgentToolsRuntimeSnapshot
): string[] {
  return [
    ...mcpServerIds.map((serverId) => `mcp:${serverId}`),
    ...skills.skills.map((skill) => buildSkillRuntimeSourceId(agentId, skill.skillId)),
    ...productTools.packages
      .filter((pkg) => pkg.permissionMode !== 'disabled' && pkg.status === 'available')
      .map((pkg) => buildProductAgentToolSourceId(agentId, pkg.productId))
  ]
}

function mergeRegistryTools(primary: readonly Tool[], registryTools: readonly Tool[]): Tool[] {
  const seen = new Set<string>()
  const merged: Tool[] = []

  for (const tool of [...primary, ...registryTools]) {
    if (seen.has(tool.id)) continue
    seen.add(tool.id)
    merged.push({ ...tool })
  }

  return merged
}
