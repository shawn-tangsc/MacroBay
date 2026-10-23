import { basename } from 'node:path'

import { ToolRegistry } from '../tools/registry'
import type { Tool } from '../schemas/toolSchemas'
import type { InstalledSkill } from '../schemas/skillSchemas'
import type { AgentStoreState } from '../store/agentStore'
import {
  normalizeAgentSkillRuntimeCapabilityKind,
  normalizeAgentSkillRuntimeEntryFile,
  type AgentSkillRuntimeCapability,
  type AgentSkillRuntimeEntry,
  type AgentSkillsRuntimeSnapshot
} from './skillRuntimeSchemas'

type SkillsRuntimeServiceDependencies = {
  getSkillTools?: (skill: InstalledSkill) => string[]
  getSkillCapabilities?: (skill: InstalledSkill) => AgentSkillRuntimeCapability[]
  invokeSkillTool?: (input: AgentSkillRuntimeToolInvokeHostInput) => Promise<AgentSkillRuntimeToolInvokeResult> | AgentSkillRuntimeToolInvokeResult
  toolRegistry?: ToolRegistry
}

export type AgentSkillRuntimeToolInvokeInput = {
  agentId: string
  sessionId?: string
  toolId: string
  input?: unknown
  signal?: AbortSignal
}

export type AgentSkillRuntimeToolInvokeHostInput = {
  agentId: string
  sessionId?: string
  skill: InstalledSkill
  toolId: string
  toolName: string
  input?: unknown
  signal?: AbortSignal
}

export type AgentSkillRuntimeToolInvokeResult = {
  output: unknown
  content?: unknown
  structuredContent?: unknown
  isError?: boolean
}

export class SkillsRuntimeService {
  constructor(private readonly deps: SkillsRuntimeServiceDependencies = {}) {}

  getAgentRuntime(state: AgentStoreState, agentId: string): AgentSkillsRuntimeSnapshot {
    if (!state.agents.some((agent) => agent.id === agentId)) {
      return emptySnapshot(agentId)
    }

    const enabledSkillIds = new Set(
      state.agentSkills
        .filter((binding) => binding.agentId === agentId && binding.isEnabled)
        .map((binding) => binding.skillId)
    )
    if (enabledSkillIds.size === 0) return emptySnapshot(agentId)

    const skills = state.skills
      .filter((skill) => enabledSkillIds.has(skill.id) && skill.isEnabled)
      .map((skill) => {
        const capabilities = normalizeSkillCapabilities(this.deps.getSkillCapabilities?.(skill) ?? [])
        return {
          skillId: skill.id,
          name: skill.name,
          description: skill.description,
          author: skill.author,
          namespace: skill.namespace,
          folderName: skill.folderName,
          source: skill.source,
          tags: [...skill.sourceTags],
          tools: [...new Set((this.deps.getSkillTools?.(skill) ?? []).filter((tool) => tool.trim().length > 0))],
          ...(capabilities.length > 0 ? { capabilities } : {})
        }
      })

    const seenToolIds = new Set<string>()
    const toolIds: string[] = []
    for (const skill of skills) {
      for (const toolName of skill.tools) {
        const toolId = buildSkillRuntimeToolId(skill, toolName)
        if (seenToolIds.has(toolId)) continue
        seenToolIds.add(toolId)
        toolIds.push(toolId)
      }
    }

    return {
      agentId,
      skills,
      toolIds
    }
  }

  syncAgentTools(state: AgentStoreState, agentId: string): AgentSkillsRuntimeSnapshot {
    const snapshot = this.getAgentRuntime(state, agentId)
    const toolRegistry = this.deps.toolRegistry
    if (!toolRegistry) return snapshot

    const activeSourceIds = new Set<string>()

    for (const skill of snapshot.skills) {
      const sourceId = buildSkillRuntimeSourceId(agentId, skill.skillId)
      activeSourceIds.add(sourceId)
      toolRegistry.registerTools(sourceId, skill.tools.map((toolName) => toSkillRuntimeTool(skill, toolName)))
    }

    const knownSourceIds = state.agentSkills
      .filter((binding) => binding.agentId === agentId)
      .map((binding) => buildSkillRuntimeSourceId(agentId, binding.skillId))

    for (const sourceId of knownSourceIds) {
      if (activeSourceIds.has(sourceId)) continue
      toolRegistry.unregisterSource(sourceId)
    }

    return snapshot
  }

  async invokeSkillTool(
    state: AgentStoreState,
    input: AgentSkillRuntimeToolInvokeInput
  ): Promise<AgentSkillRuntimeToolInvokeResult> {
    const resolved = this.resolveEnabledSkillTool(state, input.agentId, input.toolId)
    if (!resolved) {
      throw new Error(`Skill runtime tool "${input.toolId}" is not enabled for agent "${input.agentId}".`)
    }
    if (!this.deps.invokeSkillTool) {
      throw new Error('Skill runtime tool host is not wired yet.')
    }

    return this.deps.invokeSkillTool({
      agentId: input.agentId,
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      skill: resolved.skill,
      toolId: input.toolId,
      toolName: resolved.toolName,
      ...(input.input !== undefined ? { input: input.input } : {}),
      ...(input.signal ? { signal: input.signal } : {})
    })
  }

  private resolveEnabledSkillTool(
    state: AgentStoreState,
    agentId: string,
    toolId: string
  ): { skill: InstalledSkill; toolName: string } | null {
    if (!state.agents.some((agent) => agent.id === agentId)) return null

    const enabledSkillIds = new Set(
      state.agentSkills
        .filter((binding) => binding.agentId === agentId && binding.isEnabled)
        .map((binding) => binding.skillId)
    )
    if (enabledSkillIds.size === 0) return null

    for (const skill of state.skills) {
      if (!skill.isEnabled || !enabledSkillIds.has(skill.id)) continue
      const toolNames = [...new Set((this.deps.getSkillTools?.(skill) ?? []).filter((tool) => tool.trim().length > 0))]
      for (const toolName of toolNames) {
        if (buildSkillRuntimeToolId(toSkillRuntimeEntry(skill, toolNames), toolName) === toolId) {
          return { skill, toolName }
        }
      }
    }
    return null
  }
}

function emptySnapshot(agentId: string): AgentSkillsRuntimeSnapshot {
  return {
    agentId,
    skills: [],
    toolIds: []
  }
}

function buildSkillRuntimeSourceId(agentId: string, skillId: string): string {
  return `skill:${agentId}:${skillId}`
}

function buildSkillRuntimeToolId(skill: AgentSkillRuntimeEntry, toolName: string): string {
  const normalizedFolder = skill.folderName.trim().replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase()
  const normalizedTool = toolName.trim().replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase()
  return `skill__${normalizedFolder || 'skill'}__${normalizedTool || 'tool'}`
}

function toSkillRuntimeTool(skill: AgentSkillRuntimeEntry, toolName: string): Tool {
  const baseDescription = `${skill.name} capability`
  const description = skill.description?.trim() ? `${baseDescription}: ${skill.description.trim()}` : baseDescription
  return {
    id: buildSkillRuntimeToolId(skill, toolName),
    name: toolName,
    description,
    origin: 'internal',
    approval: 'auto',
    sourceId: skill.skillId,
    sourceName: skill.name
  }
}

function toSkillRuntimeEntry(skill: InstalledSkill, tools: string[]): AgentSkillRuntimeEntry {
  return {
    skillId: skill.id,
    name: skill.name,
    description: skill.description,
    author: skill.author,
    namespace: skill.namespace,
    folderName: skill.folderName,
    source: skill.source,
    tags: [...skill.sourceTags],
    tools
  }
}

function normalizeSkillCapabilities(capabilities: readonly AgentSkillRuntimeCapability[]): AgentSkillRuntimeCapability[] {
  const seen = new Set<string>()
  const normalized: AgentSkillRuntimeCapability[] = []

  for (const capability of capabilities) {
    const capabilityId = capability.capabilityId.trim()
    const title = capability.title.trim()
    if (!capabilityId || !title || seen.has(capabilityId)) continue
    seen.add(capabilityId)
    const sourcePath = normalizeOptionalText(capability.sourcePath)
    const entryFile =
      normalizeAgentSkillRuntimeEntryFile(capability.entryFile) ??
      normalizeAgentSkillRuntimeEntryFile(sourcePath ? basename(sourcePath) : null)
    normalized.push({
      capabilityId,
      kind: normalizeAgentSkillRuntimeCapabilityKind((capability as { kind?: string | null }).kind),
      title,
      summary: normalizeOptionalText(capability.summary),
      sourcePath,
      ...(entryFile ? { entryFile } : {}),
      bodyPreview: normalizeOptionalText(capability.bodyPreview),
      bodyPreviewTruncated: Boolean(capability.bodyPreviewTruncated)
    })
  }

  return normalized
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

export { buildSkillRuntimeSourceId, buildSkillRuntimeToolId }
