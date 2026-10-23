import type { InstalledSkill } from '../schemas/skillSchemas'
import type { AgentSkillBinding } from '../store/agentStore'

export type AgentSkillCatalogItem = InstalledSkill & {
  enabledForAgent: boolean
}

export function buildAgentSkillCatalog(
  skills: readonly InstalledSkill[],
  bindings: readonly AgentSkillBinding[],
  agentId: string,
  search = ''
): AgentSkillCatalogItem[] {
  const keyword = search.trim().toLowerCase()
  const enabledBindingIds = new Set(
    bindings.filter((binding) => binding.agentId === agentId && binding.isEnabled).map((binding) => binding.skillId)
  )

  return skills
    .filter((skill) => skill.isEnabled)
    .filter((skill) => {
      if (!keyword) return true
      return `${skill.name} ${skill.description ?? ''} ${skill.folderName} ${skill.sourceTags.join(' ')}`.toLowerCase().includes(keyword)
    })
    .map((skill) => ({
      ...skill,
      enabledForAgent: enabledBindingIds.has(skill.id)
    }))
}
