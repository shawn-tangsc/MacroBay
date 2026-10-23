import type { AgentSkillRuntimeEntry } from '../../../skills/skillRuntimeSchemas'

export function buildClaudeCodeSkillContext(skills: readonly AgentSkillRuntimeEntry[]): string | null {
  const normalizedSkills = skills
    .map((skill) => normalizeSkill(skill))
    .filter((skill) => skill.name.length > 0)

  if (normalizedSkills.length === 0) return null

  return ['Enabled skills:', '', ...normalizedSkills.map((skill) => formatSkillContextLine(skill))].join('\n')
}

export function buildClaudeCodeSystemPromptAppend(
  baseInstructions: string | null | undefined,
  skillContext: string | null | undefined
): string | undefined {
  const sections = [normalizeText(baseInstructions), normalizeText(skillContext)].filter((value): value is string => value !== null)
  if (sections.length === 0) return undefined
  return sections.join('\n\n')
}

type NormalizedSkillContextEntry = {
  name: string
  description: string | null
  author: string | null
  namespace: string | null
  source: string
  tags: string[]
  tools: string[]
  capabilities: NormalizedSkillCapabilityContextEntry[]
}

type NormalizedSkillCapabilityContextEntry = {
  title: string
  summary: string | null
  sourcePath: string | null
  bodyPreview: string | null
}

function normalizeSkill(skill: AgentSkillRuntimeEntry): NormalizedSkillContextEntry {
  return {
    name: skill.name.trim(),
    description: normalizeText(skill.description),
    author: normalizeText(skill.author),
    namespace: normalizeText(skill.namespace),
    source: skill.source.trim(),
    tags: [...new Set((skill.tags ?? []).map((tag) => tag.trim()).filter((tag) => tag.length > 0))],
    tools: [...new Set(skill.tools.map((tool) => tool.trim()).filter((tool) => tool.length > 0))],
    capabilities: normalizeCapabilities(skill)
  }
}

function formatSkillContextLine(skill: NormalizedSkillContextEntry): string {
  const segments = [
    formatNameAndDescription(skill),
    `Declared tools: ${skill.tools.length > 0 ? skill.tools.join(', ') : 'none'}`,
    ...(skill.tags.length > 0 ? [`Tags: ${skill.tags.join(', ')}`] : []),
    ...(skill.author ? [`Author: ${skill.author}`] : []),
    `Source: ${formatSkillSource(skill)}`,
    ...(skill.capabilities.length > 0 ? [`Capabilities: ${skill.capabilities.map(formatCapability).join('; ')}`] : [])
  ]

  return `- ${segments.join('. ')}.`
}

function normalizeCapabilities(skill: AgentSkillRuntimeEntry): NormalizedSkillCapabilityContextEntry[] {
  return (skill.capabilities ?? [])
    .map((capability) => ({
      title: normalizeText(capability.title) ?? '',
      summary: normalizeText(capability.summary),
      sourcePath: normalizeText(capability.sourcePath),
      bodyPreview: normalizeText(capability.bodyPreview)
    }))
    .filter((capability) => capability.title.length > 0)
}

function formatCapability(capability: NormalizedSkillCapabilityContextEntry): string {
  const headline = capability.summary
    ? `${capability.title} - ${trimTrailingPunctuation(capability.summary)}`
    : capability.title
  const segments = [
    headline,
    ...(capability.sourcePath ? [`File: ${capability.sourcePath}`] : []),
    ...(capability.bodyPreview ? [`Notes: ${trimTrailingPunctuation(capability.bodyPreview)}`] : [])
  ]

  return segments.join('. ')
}

function formatNameAndDescription(skill: NormalizedSkillContextEntry): string {
  if (!skill.description) return skill.name
  return `${skill.name}: ${trimTrailingPunctuation(skill.description)}`
}

function formatSkillSource(skill: NormalizedSkillContextEntry): string {
  if (!skill.namespace) return skill.source
  return `${skill.source} (${skill.namespace})`
}

function normalizeText(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function trimTrailingPunctuation(value: string): string {
  return value.replace(/[.\s]+$/g, '')
}
