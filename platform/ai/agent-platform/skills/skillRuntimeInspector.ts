import type { AgentSkillRuntimeEntry, AgentSkillsRuntimeSnapshot } from './skillRuntimeSchemas'
import { buildSkillRuntimeToolId } from './SkillsRuntimeService'

export type AgentSkillRuntimeToolDescriptor = {
  toolName: string
  toolId: string
}

export type AgentSkillRuntimeCatalogEntry = AgentSkillRuntimeEntry & {
  runtimeTools: AgentSkillRuntimeToolDescriptor[]
}

export type AgentSkillsRuntimeCatalog = {
  agentId: string
  skills: AgentSkillRuntimeCatalogEntry[]
}

export function buildAgentSkillsRuntimeCatalog(
  snapshot: AgentSkillsRuntimeSnapshot
): AgentSkillsRuntimeCatalog {
  return {
    agentId: snapshot.agentId,
    skills: snapshot.skills.map((skill) => ({
      ...skill,
      ...(skill.tags ? { tags: [...skill.tags] } : {}),
      tools: [...skill.tools],
      ...(skill.capabilities
        ? {
            capabilities: skill.capabilities.map((capability) => ({ ...capability }))
          }
        : {}),
      runtimeTools: buildRuntimeTools(skill)
    }))
  }
}

function buildRuntimeTools(skill: AgentSkillRuntimeEntry): AgentSkillRuntimeToolDescriptor[] {
  const seen = new Set<string>()
  const runtimeTools: AgentSkillRuntimeToolDescriptor[] = []

  for (const toolName of skill.tools) {
    const toolId = buildSkillRuntimeToolId(skill, toolName)
    if (seen.has(toolId)) continue
    seen.add(toolId)
    runtimeTools.push({ toolName, toolId })
  }

  return runtimeTools
}
