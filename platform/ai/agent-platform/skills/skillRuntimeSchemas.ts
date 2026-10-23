export const agentSkillRuntimeCapabilityKinds = ['entry-file-summary', 'supporting-file-summary'] as const
export type AgentSkillRuntimeCapabilityKind = (typeof agentSkillRuntimeCapabilityKinds)[number]

export const agentSkillRuntimeEntryFiles = ['SKILL.md', 'skill.md'] as const
export type AgentSkillRuntimeEntryFile = (typeof agentSkillRuntimeEntryFiles)[number]

export type AgentSkillRuntimeCapability = {
  capabilityId: string
  kind: AgentSkillRuntimeCapabilityKind
  title: string
  summary?: string | null
  sourcePath?: string | null
  entryFile?: AgentSkillRuntimeEntryFile | null
  bodyPreview?: string | null
  bodyPreviewTruncated?: boolean
}

export type AgentSkillRuntimeEntry = {
  skillId: string
  name: string
  description?: string | null
  author?: string | null
  namespace?: string | null
  folderName: string
  source: string
  tags?: string[]
  tools: string[]
  capabilities?: AgentSkillRuntimeCapability[]
}

export type AgentSkillsRuntimeSnapshot = {
  agentId: string
  skills: AgentSkillRuntimeEntry[]
  toolIds: string[]
}

export type { AgentSkillsRuntimeCatalog, AgentSkillRuntimeCatalogEntry, AgentSkillRuntimeToolDescriptor } from './skillRuntimeInspector'

export function cloneAgentSkillRuntimeCapability(capability: AgentSkillRuntimeCapability): AgentSkillRuntimeCapability {
  return {
    ...capability,
    ...(capability.entryFile !== undefined ? { entryFile: capability.entryFile } : {}),
    ...(capability.bodyPreviewTruncated !== undefined ? { bodyPreviewTruncated: capability.bodyPreviewTruncated } : {})
  }
}

export function cloneAgentSkillRuntimeEntry(skill: AgentSkillRuntimeEntry): AgentSkillRuntimeEntry {
  return {
    ...skill,
    ...(skill.tags ? { tags: [...skill.tags] } : {}),
    tools: [...skill.tools],
    ...(skill.capabilities
      ? {
          capabilities: skill.capabilities.map((capability) => cloneAgentSkillRuntimeCapability(capability))
        }
      : {})
  }
}

export function normalizeAgentSkillRuntimeEntryFile(
  value: string | null | undefined
): AgentSkillRuntimeEntryFile | null {
  const trimmed = value?.trim()
  if (!trimmed) return null
  return agentSkillRuntimeEntryFiles.find((entryFile) => entryFile === trimmed) ?? null
}

export function normalizeAgentSkillRuntimeCapabilityKind(
  value: string | null | undefined
): AgentSkillRuntimeCapabilityKind {
  const trimmed = value?.trim()
  return agentSkillRuntimeCapabilityKinds.find((kind) => kind === trimmed) ?? 'entry-file-summary'
}
