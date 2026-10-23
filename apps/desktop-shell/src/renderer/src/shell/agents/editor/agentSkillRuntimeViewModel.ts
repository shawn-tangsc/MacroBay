import type {
  AgentSkillRuntimeCatalogEntry,
  AgentSkillRuntimeCapability,
  AgentSkillRuntimeToolDescriptor
} from '@platform/ai/agent-platform/skills/skillRuntimeSchemas'

export type AgentSkillRuntimeViewModel = {
  toolCount: number
  capabilityCount: number
  runtimeTools: AgentSkillRuntimeToolDescriptor[]
  capabilities: AgentSkillRuntimeCapability[]
  primarySummary: string | null
  statusKind: 'ready' | 'empty' | 'unavailable'
}

export function buildAgentSkillRuntimeViewModel(
  runtimeEntry: AgentSkillRuntimeCatalogEntry | null | undefined
): AgentSkillRuntimeViewModel {
  if (runtimeEntry == null) {
    return {
      toolCount: 0,
      capabilityCount: 0,
      runtimeTools: [],
      capabilities: [],
      primarySummary: null,
      statusKind: 'unavailable'
    }
  }

  const runtimeTools = runtimeEntry.runtimeTools.map((tool) => ({ ...tool }))
  const capabilities = runtimeEntry.capabilities?.map((capability) => ({ ...capability })) ?? []
  const toolCount = runtimeTools.length
  const capabilityCount = capabilities.length

  return {
    toolCount,
    capabilityCount,
    runtimeTools,
    capabilities,
    primarySummary: capabilities.find((capability) => capability.summary?.trim())?.summary?.trim() ?? null,
    statusKind: toolCount > 0 || capabilityCount > 0 ? 'ready' : 'empty'
  }
}
